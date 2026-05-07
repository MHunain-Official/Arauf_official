const express = require('express');
const router = express.Router();
const db = require('../src/config/db');

// Cache for checking whether ledger_entries has `entry_type` column
let _hasEntryTypeCache = null;
async function hasEntryTypeColumn() {
  if (_hasEntryTypeCache !== null) return _hasEntryTypeCache;
  try {
    const [cols] = await db.query("SHOW COLUMNS FROM ledger_entries LIKE 'entry_type'");
    _hasEntryTypeCache = Array.isArray(cols) && cols.length > 0;
  } catch (e) {
    _hasEntryTypeCache = false;
  }
  return _hasEntryTypeCache;
}

const NON_EDITABLE_ENTRY_TYPES = new Set([
  'invoice',
  'invoice_tax',
  'po_invoice',
  'po_invoice_tax',
  'payment_tax',
  'manual_tax'
]);

const normalizeBillNoForLookup = (billNo) => {
  const normalized = String(billNo || '').trim();
  if (!normalized) return '';
  return normalized.startsWith('TAX-') ? normalized.slice(4) : normalized;
};

const isStandaloneManualEntry = async (connection, entry) => {
  const normalizedType = String(entry.entry_type || '').toLowerCase().trim();
  const billNo = String(entry.bill_no || '').trim();
  const desc = String(entry.description || '').toLowerCase();
  const ref = normalizeBillNoForLookup(entry.bill_no);
  if (!ref) return true;

  const [invoiceRows] = await connection.query(
    `SELECT id FROM invoice WHERE LOWER(invoice_number) = LOWER(?) LIMIT 1`,
    [ref]
  );
  if (invoiceRows.length > 0) return false;

  const [poRows] = await connection.query(
    `SELECT id FROM po_invoices WHERE LOWER(invoice_number) = LOWER(?) LIMIT 1`,
    [ref]
  );
  const linkedToInvoiceOrPO = invoiceRows.length > 0 || poRows.length > 0;
  if (linkedToInvoiceOrPO) return false;

  const isTaxLike = billNo.startsWith('TAX-') || desc.includes('sales tax') || desc.includes('tax payment');
  if (isTaxLike) {
    // Allow tax rows only when they belong to standalone manual bill groups.
    return true;
  }

  if (normalizedType && NON_EDITABLE_ENTRY_TYPES.has(normalizedType)) {
    return false;
  }

  return true;
};

const recalculateCustomerBalances = async (connection, customerId) => {
  const [rows] = await connection.query(
    `SELECT entry_id, debit_amount, credit_amount
     FROM ledger_entries
     WHERE customer_id = ?
     ORDER BY entry_date ASC, sequence ASC, entry_id ASC`,
    [customerId]
  );

  let runningBalance = 0;
  for (const row of rows) {
    const debit = Number(row.debit_amount) || 0;
    const credit = Number(row.credit_amount) || 0;
    runningBalance += debit - credit;
    await connection.query(
      `UPDATE ledger_entries SET balance = ? WHERE entry_id = ?`,
      [Number(runningBalance.toFixed(2)), row.entry_id]
    );
  }
};

// Helper function to calculate balance
const calculateBalance = async (customerId, currentEntryId = null) => {
  try {
    let query = `
      SELECT COALESCE(SUM(debit_amount - credit_amount), 0) as balance 
      FROM ledger_entries 
      WHERE customer_id = ?
    `;
    const params = [customerId];
    
    if (currentEntryId) {
      query += ' AND entry_id < ?';
      params.push(currentEntryId);
    }
    
    const [result] = await db.query(query, params);
    const balance = Number(result[0].balance) || 0;
    return balance;
  } catch (error) {
    console.error('Error calculating balance:', error);
    return 0;
  }
};

// Helper function to get next sequence number
const getNextSequence = async (customerId, entryDate) => {
  try {
    const [result] = await db.query(
      `SELECT COALESCE(MAX(sequence), 0) + 1 as next_seq 
       FROM ledger_entries 
       WHERE customer_id = ? AND entry_date = ?`,
      [customerId, entryDate]
    );
    return result[0].next_seq;
  } catch (error) {
    console.error('Error getting next sequence:', error);
    return 1;
  }
};

// POST: Create new ledger entry for a customer
router.post('/customer/:customerId', async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const { customerId } = req.params;
    const {
      entryDate,
      description,
      billNo,
      paymentMode,
      chequeNo,
      debitAmount,
      creditAmount,
      dueDate,
      status,
      salesTaxRate,
      salesTaxAmount,
      useLineItems,
      // Single material entry fields
      mtr,
      rate,
      // Multiple line items
      lineItems,
      isTaxEntry  // Flag indicating this entry is already a tax entry
    } = req.body;

    // Validate required fields
    if (!entryDate) {
      return res.status(400).json({ error: 'Entry date is required' });
    }

    if (!debitAmount && !creditAmount) {
      return res.status(400).json({ error: 'Either debit or credit amount is required' });
    }

    // Get the previous balance
    const previousBalance = await calculateBalance(customerId);
    
    // Calculate new balance - ensure all values are numbers
    const debit = Number(debitAmount) || 0;
    const credit = Number(creditAmount) || 0;
    const newBalance = Number(previousBalance) + Number(debit) - Number(credit);
    
    // Validate newBalance is a finite number
    if (!Number.isFinite(newBalance)) {
      console.error('[ledgerEntries] Invalid balance calculation:', { previousBalance, debit, credit, newBalance });
      return res.status(400).json({ error: 'Invalid balance calculation' });
    }

    // Get next sequence for this date
    const sequence = await getNextSequence(customerId, entryDate);
    const numSequence = Number(sequence) || 1;  // Ensure sequence is a number

    // Insert main ledger entry (adapt to whether entry_type column exists)
    const _hasEntryType = await hasEntryTypeColumn();
    let entryResult;
    if (_hasEntryType) {
      [entryResult] = await connection.query(
        `INSERT INTO ledger_entries 
         (customer_id, entry_date, description, bill_no, entry_type, payment_mode, cheque_no, 
          debit_amount, credit_amount, balance, status, due_date, has_multiple_items, 
          sales_tax_rate, sales_tax_amount, sequence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          customerId,
          entryDate,
          description || null,
          billNo || null,
          req.body.entryType || 'manual',
          paymentMode || 'Cash',
          chequeNo || null,
          debit,
          credit,
          Number(newBalance.toFixed(2)),
          status || 'pending',
          dueDate || null,
          useLineItems ? 1 : 0,
          Number(parseFloat(salesTaxRate) || 0),
          Number(parseFloat(salesTaxAmount) || 0),
          numSequence
        ]
      );
    } else {
      [entryResult] = await connection.query(
        `INSERT INTO ledger_entries 
         (customer_id, entry_date, description, bill_no, payment_mode, cheque_no, 
          debit_amount, credit_amount, balance, status, due_date, has_multiple_items, 
          sales_tax_rate, sales_tax_amount, sequence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          customerId,
          entryDate,
          description || null,
          billNo || null,
          paymentMode || 'Cash',
          chequeNo || null,
          debit,
          credit,
          Number(newBalance.toFixed(2)),
          status || 'pending',
          dueDate || null,
          useLineItems ? 1 : 0,
          Number(parseFloat(salesTaxRate) || 0),
          Number(parseFloat(salesTaxAmount) || 0),
          numSequence
        ]
      );
    }

    const entryId = entryResult.insertId;

    // Handle line items or single material entry
    if (useLineItems && lineItems && lineItems.length > 0) {
      // Insert multiple line items
      for (let i = 0; i < lineItems.length; i++) {
        const item = lineItems[i];
        const itemAmount = (parseFloat(item.quantity) || 0) * (parseFloat(item.rate) || 0);
        const taxRate = parseFloat(item.taxRate) || 0;
        const totalWithTax = itemAmount * (1 + taxRate / 100);
        
        await connection.query(
          `INSERT INTO ledger_line_items 
           (entry_id, description, quantity, rate, tax_rate, amount, total_with_tax, item_type, line_sequence)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            entryId,
            item.description || '',
            parseFloat(item.quantity) || 0,
            parseFloat(item.rate) || 0,
            taxRate,
            itemAmount,
            totalWithTax,
            item.type || 'material',
            i + 1
          ]
        );
      }
  } else if (!useLineItems && ((mtr !== undefined && mtr !== null) || (rate !== undefined && rate !== null))) {
      // Insert single material entry
      const singleAmount = (parseFloat(mtr) || 0) * (parseFloat(rate) || 0);
      const taxRate = parseFloat(salesTaxRate) || 0;
      const totalWithTax = singleAmount * (1 + taxRate / 100);
      
      await connection.query(
        `INSERT INTO ledger_single_materials 
         (entry_id, bill_no, quantity_mtr, rate, tax_rate, amount, total_with_tax)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          entryId,
          billNo || null,
          parseFloat(mtr) || 0,
          parseFloat(rate) || 0,
          taxRate,
          singleAmount,
          totalWithTax
        ]
      );
    }

      // If there's sales tax and this is NOT already a tax entry, create a separate tax entry
    if (salesTaxAmount && parseFloat(salesTaxAmount) > 0 && !isTaxEntry) {
      const taxSequence = numSequence + 0.5; // Tax entry comes after main entry
      const taxAmount = Number(salesTaxAmount) || 0;
      const taxBalance = Number(newBalance) + Number(taxAmount);
      
      // Validate tax balance
      if (!Number.isFinite(taxBalance)) {
        console.error('[ledgerEntries] Invalid tax balance calculation:', { newBalance, taxAmount, taxBalance });
        throw new Error('Invalid tax balance calculation');
      }
      
      // Determine tax entry type based on parent entry type
      const parentEntryType = req.body.entryType || 'manual';
      const taxEntryType = parentEntryType === 'invoice' ? 'invoice_tax' : 
                          parentEntryType === 'po_invoice' ? 'po_invoice_tax' :
                          parentEntryType === 'payment' ? 'payment_tax' : 'manual';
      
      const _hasEntryType2 = await hasEntryTypeColumn();
      if (_hasEntryType2) {
        await connection.query(
          `INSERT INTO ledger_entries 
           (customer_id, entry_date, description, bill_no, entry_type, payment_mode, 
            debit_amount, credit_amount, balance, status, has_multiple_items, sequence)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            customerId,
            entryDate,
            `Sales Tax (${salesTaxRate}%) - ${description || billNo || 'Entry'}`,
            billNo || null,
            taxEntryType,
            paymentMode || 'Cash',
            Number(taxAmount),
            0,
            Number(taxBalance.toFixed(2)),
            status || 'pending',
            0,
            Number(taxSequence.toFixed(1))  // Ensure it's a proper decimal
          ]
        );
      } else {
        await connection.query(
          `INSERT INTO ledger_entries 
           (customer_id, entry_date, description, bill_no, payment_mode, 
            debit_amount, credit_amount, balance, status, has_multiple_items, sequence)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            customerId,
            entryDate,
            `Sales Tax (${salesTaxRate}%) - ${description || billNo || 'Entry'}`,
            billNo || null,
            paymentMode || 'Cash',
            Number(taxAmount),
            0,
            Number(taxBalance.toFixed(2)),
            status || 'pending',
            0,
            Number(taxSequence.toFixed(1))
          ]
        );
      }
    }

    await connection.commit();

    // Fetch the created entry with all details
    const [createdEntry] = await connection.query(
      `SELECT * FROM vw_ledger_entries_complete WHERE entry_id = ?`,
      [entryId]
    );

    // Fetch line items if exists
    let items = [];
    if (useLineItems) {
      [items] = await connection.query(
        `SELECT * FROM ledger_line_items WHERE entry_id = ? ORDER BY line_sequence`,
        [entryId]
      );
    }

    res.status(201).json({
      success: true,
      message: 'Ledger entry created successfully',
      data: {
        entry: createdEntry[0],
        lineItems: items
      }
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error creating ledger entry:', error);
    res.status(500).json({ 
      error: 'Failed to create ledger entry',
      details: error.message 
    });
  } finally {
    connection.release();
  }
});

// GET: Fetch all ledger entries for a customer
router.get('/customer/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { fromDate, toDate, status } = req.query;

    let query = `
      SELECT * FROM vw_ledger_entries_complete 
      WHERE customer_id = ?
    `;
    const params = [customerId];

    if (fromDate) {
      query += ' AND entry_date >= ?';
      params.push(fromDate);
    }

    if (toDate) {
      query += ' AND entry_date <= ?';
      params.push(toDate);
    }

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at ASC, entry_date ASC, sequence ASC';

    const [entries] = await db.query(query, params);

    // Fetch line items or single-material details for entries
    const entriesWithItems = await Promise.all(
      entries.map(async (entry) => {
        if (entry.has_multiple_items) {
          const [items] = await db.query(
            `SELECT * FROM ledger_line_items WHERE entry_id = ? ORDER BY line_sequence`,
            [entry.entry_id]
          );
          return { ...entry, lineItems: items };
        }

        // For single material entries, fetch from ledger_single_materials if present
        const [singleRows] = await db.query(
          `SELECT quantity_mtr, rate, tax_rate, amount FROM ledger_single_materials WHERE entry_id = ? LIMIT 1`,
          [entry.entry_id]
        );

        if (singleRows && singleRows.length > 0) {
          const single = singleRows[0];
          // Attach mtr and rate fields so frontend can display them
          return {
            ...entry,
            mtr: single.quantity_mtr !== null ? parseFloat(single.quantity_mtr) : null,
            rate: single.rate !== null ? parseFloat(single.rate) : null,
            singleMaterialAmount: single.amount !== null ? parseFloat(single.amount) : 0
          };
        }

        return entry;
      })
    );

    // Calculate summary
    const summary = {
      totalDebit: entries.reduce((sum, e) => sum + parseFloat(e.debit_amount || 0), 0),
      totalCredit: entries.reduce((sum, e) => sum + parseFloat(e.credit_amount || 0), 0),
      currentBalance: entries.length > 0 ? parseFloat(entries[0].balance || 0) : 0,
      totalEntries: entries.length
    };

    res.json({
      success: true,
      data: {
        entries: entriesWithItems,
        summary
      }
    });

  } catch (error) {
    console.error('Error fetching ledger entries:', error);
    res.status(500).json({ 
      error: 'Failed to fetch ledger entries',
      details: error.message 
    });
  }
});

// DELETE: Remove duplicate PO payment DEBIT entries for a given bill_no
router.delete('/bill/:billNo/payment-debit-duplicates', async (req, res) => {
  const { billNo } = req.params;
  const confirm = req.query.confirm === 'true';
  try {
    // Find payment debit entries that match the pattern "Payment - PO Invoice <billNo>"
    const [toDelete] = await db.query(
      `SELECT entry_id, bill_no, description FROM ledger_entries WHERE bill_no = ? AND description LIKE ? AND debit_amount > 0`,
      [billNo, `Payment - PO Invoice %`]
    );

    if (!toDelete || toDelete.length === 0) {
      return res.json({ success: true, message: 'No duplicate payment DEBIT entries found for this bill_no', deleted: [] });
    }

    // If not confirmed, return what would be deleted
    if (!confirm) {
      return res.json({ success: true, message: 'Found duplicate payment DEBIT entries (not deleted). Set confirm=true to delete.', entries: toDelete });
    }

    // Perform deletion in a transaction
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const deletedIds = [];
      for (const entry of toDelete) {
        // Delete the main payment debit entry
        await connection.query(`DELETE FROM ledger_entries WHERE entry_id = ?`, [entry.entry_id]);
        deletedIds.push(entry.entry_id);

        // Also delete corresponding tax payment debit entry if exists
        const taxBillNo = `TAX-${billNo}`;
        const [taxRows] = await connection.query(`SELECT entry_id FROM ledger_entries WHERE bill_no = ? AND debit_amount > 0`, [taxBillNo]);
        for (const r of taxRows) {
          await connection.query(`DELETE FROM ledger_entries WHERE entry_id = ?`, [r.entry_id]);
          deletedIds.push(r.entry_id);
        }
      }

      await connection.commit();
      return res.json({ success: true, message: 'Deleted duplicate payment DEBIT entries', deleted: deletedIds });
    } catch (err) {
      await connection.rollback();
      console.error("Error deleting duplicate payment entries:", err);
      return res.status(500).json({ success: false, error: err.message });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error(`Error while finding duplicate payment DEBIT entries for ${billNo}:`, error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET: Fetch single ledger entry by ID
router.get('/entry/:entryId', async (req, res) => {
  try {
    const { entryId } = req.params;

    const [entries] = await db.query(
      `SELECT * FROM vw_ledger_entries_complete WHERE entry_id = ?`,
      [entryId]
    );

    if (entries.length === 0) {
      return res.status(404).json({ error: 'Ledger entry not found' });
    }

    const entry = entries[0];

    // Fetch line items if exists
    if (entry.has_multiple_items) {
      const [items] = await db.query(
        `SELECT * FROM ledger_line_items WHERE entry_id = ? ORDER BY line_sequence`,
        [entryId]
      );
      entry.lineItems = items;
    }

    res.json({
      success: true,
      data: entry
    });

  } catch (error) {
    console.error('Error fetching ledger entry:', error);
    res.status(500).json({ 
      error: 'Failed to fetch ledger entry',
      details: error.message 
    });
  }
});

// PUT: Update ledger entry
router.put('/entry/:entryId', async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const { entryId } = req.params;
    const {
      entryDate,
      description,
      billNo,
      debitAmount,
      creditAmount,
      transactionType,
      status,
      dueDate,
      paymentMode,
      chequeNo,
      useLineItems,
      mtr,
      rate,
      lineItems,
      salesTaxRate
    } = req.body;

    // Fetch the current entry BEFORE update to compare status
    const [currentRows] = await connection.query(
      `SELECT * FROM ledger_entries WHERE entry_id = ?`,
      [entryId]
    );
    if (currentRows.length === 0) {
      return res.status(404).json({ error: 'Ledger entry not found' });
    }
    const currentEntry = currentRows[0];
    const canEditAmountAndType = await isStandaloneManualEntry(connection, currentEntry);

    const amountProvided = debitAmount !== undefined || creditAmount !== undefined || transactionType !== undefined;
    if (amountProvided && !canEditAmountAndType) {
      return res.status(403).json({
        error: 'Only standalone manual entries can change amount or transaction type'
      });
    }

    const normalizedTxType = String(transactionType || '').toLowerCase().trim();
    const hasTransactionType = normalizedTxType === 'debit' || normalizedTxType === 'credit';
    const parsedDebitAmount = Number(debitAmount);
    const parsedCreditAmount = Number(creditAmount);

    let nextDebit = Number(currentEntry.debit_amount) || 0;
    let nextCredit = Number(currentEntry.credit_amount) || 0;

    if (hasTransactionType) {
      const amountForType = Number.isFinite(parsedDebitAmount)
        ? parsedDebitAmount
        : (Number.isFinite(parsedCreditAmount)
          ? parsedCreditAmount
          : Math.max(nextDebit, nextCredit, 0));

      if (amountForType <= 0) {
        return res.status(400).json({ error: 'Amount must be greater than zero when changing transaction type' });
      }

      if (normalizedTxType === 'debit') {
        nextDebit = amountForType;
        nextCredit = 0;
      } else {
        nextDebit = 0;
        nextCredit = amountForType;
      }
    } else if (amountProvided) {
      if (Number.isFinite(parsedDebitAmount) && Number.isFinite(parsedCreditAmount) && parsedDebitAmount > 0 && parsedCreditAmount > 0) {
        return res.status(400).json({ error: 'Entry cannot have both debit and credit amounts at the same time' });
      }

      if (Number.isFinite(parsedDebitAmount)) {
        nextDebit = Math.max(parsedDebitAmount, 0);
      }
      if (Number.isFinite(parsedCreditAmount)) {
        nextCredit = Math.max(parsedCreditAmount, 0);
      }

      if (nextDebit > 0 && nextCredit > 0) {
        return res.status(400).json({ error: 'Entry cannot have both debit and credit amounts at the same time' });
      }
      if (nextDebit <= 0 && nextCredit <= 0) {
        return res.status(400).json({ error: 'Either debit amount or credit amount is required' });
      }
    }

    const wasUnpaid = currentEntry.status !== 'paid' && currentEntry.status !== 'Paid';
    const becomingPaid = status === 'paid' || status === 'Paid';
    const isDebitEntry = nextDebit > 0 && nextCredit === 0;

    // Update main entry
    await connection.query(
      `UPDATE ledger_entries 
       SET entry_date = ?, description = ?, bill_no = ?, debit_amount = ?, credit_amount = ?, status = ?, due_date = ?, payment_mode = ?, cheque_no = ?, sales_tax_rate = ?
       WHERE entry_id = ?`,
      [
        entryDate || currentEntry.entry_date,
        description ?? currentEntry.description,
        billNo ?? currentEntry.bill_no,
        nextDebit,
        nextCredit,
        status || currentEntry.status,
        dueDate || null,
        paymentMode || currentEntry.payment_mode || 'Cash',
        chequeNo || null,
        Number(parseFloat(salesTaxRate) || currentEntry.sales_tax_rate || 0),
        entryId
      ]
    );

    // Keep item details in sync when editing from General Ledger form
    if (canEditAmountAndType) {
      if (useLineItems === true && Array.isArray(lineItems) && lineItems.length > 0) {
        await connection.query(`DELETE FROM ledger_line_items WHERE entry_id = ?`, [entryId]);
        await connection.query(`DELETE FROM ledger_single_materials WHERE entry_id = ?`, [entryId]);
        for (let i = 0; i < lineItems.length; i++) {
          const item = lineItems[i];
          const itemAmount = (parseFloat(item.quantity) || 0) * (parseFloat(item.rate) || 0);
          const taxRate = parseFloat(item.taxRate) || 0;
          const totalWithTax = itemAmount * (1 + taxRate / 100);
          await connection.query(
            `INSERT INTO ledger_line_items
             (entry_id, description, quantity, rate, tax_rate, amount, total_with_tax, item_type, line_sequence)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              entryId,
              item.description || '',
              parseFloat(item.quantity) || 0,
              parseFloat(item.rate) || 0,
              taxRate,
              itemAmount,
              totalWithTax,
              item.type || 'material',
              i + 1
            ]
          );
        }
        await connection.query(`UPDATE ledger_entries SET has_multiple_items = 1 WHERE entry_id = ?`, [entryId]);
      } else if (useLineItems === false && (mtr !== undefined || rate !== undefined)) {
        const qty = parseFloat(mtr) || 0;
        const unitRate = parseFloat(rate) || 0;
        const taxRate = Number(parseFloat(salesTaxRate) || currentEntry.sales_tax_rate || 0);
        const amount = qty * unitRate;
        const totalWithTax = amount * (1 + taxRate / 100);

        await connection.query(`DELETE FROM ledger_line_items WHERE entry_id = ?`, [entryId]);
        await connection.query(`DELETE FROM ledger_single_materials WHERE entry_id = ?`, [entryId]);
        await connection.query(
          `INSERT INTO ledger_single_materials
           (entry_id, bill_no, quantity_mtr, rate, tax_rate, amount, total_with_tax)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [entryId, billNo ?? currentEntry.bill_no, qty, unitRate, taxRate, amount, totalWithTax]
        );
        await connection.query(`UPDATE ledger_entries SET has_multiple_items = 0 WHERE entry_id = ?`, [entryId]);
      }
    }

    // If a DEBIT entry just became 'paid', auto-create CREDIT payment entry
    // (mirrors how the invoice system works)
    if (wasUnpaid && becomingPaid && isDebitEntry) {
      const customerId = currentEntry.customer_id;
      const billNo = currentEntry.bill_no;
      const entryDate = currentEntry.entry_date;
      const debitAmount = parseFloat(currentEntry.debit_amount) || 0;

      // Check if a credit payment entry already exists for this bill
      const [existingPayment] = await connection.query(
        `SELECT entry_id FROM ledger_entries 
         WHERE customer_id = ? AND bill_no = ? AND credit_amount > 0`,
        [customerId, billNo]
      );

      if (!existingPayment || existingPayment.length === 0) {
        // Calculate running balance BEFORE adding payment
        const [balRes] = await connection.query(
          `SELECT COALESCE(SUM(debit_amount - credit_amount), 0) as currentBalance
           FROM ledger_entries WHERE customer_id = ?`,
          [customerId]
        );
        const currentBalance = Number(balRes[0].currentBalance) || 0;
        const paymentBalance = currentBalance - debitAmount;

        const [seqRes] = await connection.query(
          `SELECT COALESCE(MAX(sequence), 0) + 1 as next_seq
           FROM ledger_entries WHERE customer_id = ? AND entry_date = ?`,
          [customerId, entryDate]
        );
        const paySeq = Number(seqRes[0].next_seq) || 1;

        const _hasEntryTypePut = await hasEntryTypeColumn();
        if (_hasEntryTypePut) {
          await connection.query(
            `INSERT INTO ledger_entries
             (customer_id, entry_date, description, bill_no, entry_type, payment_mode,
              debit_amount, credit_amount, balance, status, has_multiple_items, sequence)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [customerId, entryDate, 'Payment Received', billNo, 'payment',
             paymentMode || currentEntry.payment_mode || 'Cash',
             0, debitAmount, paymentBalance, 'paid', 0, paySeq]
          );
        } else {
          await connection.query(
            `INSERT INTO ledger_entries
             (customer_id, entry_date, description, bill_no, payment_mode,
              debit_amount, credit_amount, balance, status, has_multiple_items, sequence)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [customerId, entryDate, 'Payment Received', billNo,
             paymentMode || currentEntry.payment_mode || 'Cash',
             0, debitAmount, paymentBalance, 'paid', 0, paySeq]
          );
        }

        // If a tax DEBIT entry exists for this bill, also create CREDIT tax payment and update its status
        const taxBillNo = billNo ? `TAX-${billNo}` : null;
        if (taxBillNo) {
          const [taxRows] = await connection.query(
            `SELECT * FROM ledger_entries WHERE customer_id = ? AND bill_no = ? AND debit_amount > 0`,
            [customerId, taxBillNo]
          );

          if (taxRows.length > 0) {
            const taxEntry = taxRows[0];
            const taxAmount = parseFloat(taxEntry.debit_amount) || 0;

            // Update tax entry status to paid
            await connection.query(
              `UPDATE ledger_entries SET status = 'paid' WHERE entry_id = ?`,
              [taxEntry.entry_id]
            );

            // Check no credit tax payment already exists
            const [existingTaxPay] = await connection.query(
              `SELECT entry_id FROM ledger_entries WHERE customer_id = ? AND bill_no = ? AND credit_amount > 0`,
              [customerId, taxBillNo]
            );

            if (!existingTaxPay || existingTaxPay.length === 0) {
              const taxBalance = paymentBalance - taxAmount;
              const [taxSeqRes] = await connection.query(
                `SELECT COALESCE(MAX(sequence), 0) + 1 as next_seq
                 FROM ledger_entries WHERE customer_id = ? AND entry_date = ?`,
                [customerId, entryDate]
              );
              const taxPaySeq = Number(taxSeqRes[0].next_seq) || 1;

              if (_hasEntryTypePut) {
                await connection.query(
                  `INSERT INTO ledger_entries
                   (customer_id, entry_date, description, bill_no, entry_type, payment_mode,
                    debit_amount, credit_amount, balance, status, has_multiple_items, sequence)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [customerId, entryDate, `Tax Payment`, taxBillNo, 'payment_tax',
                   paymentMode || currentEntry.payment_mode || 'Cash',
                   0, taxAmount, taxBalance, 'paid', 0, taxPaySeq]
                );
              } else {
                await connection.query(
                  `INSERT INTO ledger_entries
                   (customer_id, entry_date, description, bill_no, payment_mode,
                    debit_amount, credit_amount, balance, status, has_multiple_items, sequence)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [customerId, entryDate, `Tax Payment`, taxBillNo,
                   paymentMode || currentEntry.payment_mode || 'Cash',
                   0, taxAmount, taxBalance, 'paid', 0, taxPaySeq]
                );
              }
            }
          }
        }
      }
    }

    await recalculateCustomerBalances(connection, currentEntry.customer_id);

    await connection.commit();

    // Fetch updated entry
    const [updatedEntry] = await connection.query(
      `SELECT * FROM vw_ledger_entries_complete WHERE entry_id = ?`,
      [entryId]
    );

    res.json({
      success: true,
      message: 'Ledger entry updated successfully',
      data: updatedEntry[0]
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error updating ledger entry:', error);
    res.status(500).json({ 
      error: 'Failed to update ledger entry',
      details: error.message 
    });
  } finally {
    connection.release();
  }
});

// DELETE: Delete ledger entry
router.delete('/entry/:entryId', async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const { entryId } = req.params;

    // Get entry details before deletion
    const [entries] = await connection.query(
      `SELECT customer_id, entry_date FROM ledger_entries WHERE entry_id = ?`,
      [entryId]
    );

    if (entries.length === 0) {
      return res.status(404).json({ error: 'Ledger entry not found' });
    }

    const { customer_id, entry_date } = entries[0];

    // Delete entry (cascades to line_items and single_materials)
    await connection.query(
      `DELETE FROM ledger_entries WHERE entry_id = ?`,
      [entryId]
    );

    // Recalculate balances for subsequent entries
    await connection.query(
      `UPDATE ledger_entries e1
       SET balance = (
         SELECT COALESCE(SUM(e2.debit_amount - e2.credit_amount), 0)
         FROM ledger_entries e2
         WHERE e2.customer_id = e1.customer_id
         AND (e2.entry_date < e1.entry_date OR (e2.entry_date = e1.entry_date AND e2.entry_id <= e1.entry_id))
       )
       WHERE customer_id = ? AND (entry_date > ? OR (entry_date = ? AND entry_id > ?))`,
      [customer_id, entry_date, entry_date, entryId]
    );

    await connection.commit();

    res.json({
      success: true,
      message: 'Ledger entry deleted successfully'
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error deleting ledger entry:', error);
    res.status(500).json({ 
      error: 'Failed to delete ledger entry',
      details: error.message 
    });
  } finally {
    connection.release();
  }
});

// POST: Create multiple ledger entries in a single transaction (BULK)
router.post('/customer/:customerId/bulk', async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const { customerId } = req.params;
    const { entries: entriesToAdd } = req.body;

    if (!Array.isArray(entriesToAdd) || entriesToAdd.length === 0) {
      return res.status(400).json({ error: 'No entries provided' });
    }

    const createdEntries = [];

    // Calculate the true running balance for this customer ONCE before the loop
    // Use SUM(debit - credit) — correct running total, not MAX(balance) which is wrong
    const [initBalResult] = await connection.query(
      `SELECT COALESCE(SUM(debit_amount - credit_amount), 0) as currentBalance
       FROM ledger_entries
       WHERE customer_id = ?`,
      [customerId]
    );
    let runningBalance = Number(initBalResult[0].currentBalance) || 0;

    // Process all entries in sequence
    for (let entryData of entriesToAdd) {
      const {
        entryDate,
        description,
        billNo,
        paymentMode,
        chequeNo,
        debitAmount,
        creditAmount,
        dueDate,
        status,
        salesTaxRate,
        salesTaxAmount,
        useLineItems,
        mtr,
        rate,
        lineItems,
        isTaxEntry  // Flag indicating if this is a tax entry
      } = entryData;

      // Validate required fields
      if (!entryDate) {
        throw new Error('Entry date is required');
      }

      if (!debitAmount && !creditAmount) {
        throw new Error('Either debit or credit amount is required');
      }

      // Calculate new balance using running total (updated after each insert)
      const debit = Number(debitAmount) || 0;
      const credit = Number(creditAmount) || 0;
      const newBalance = runningBalance + debit - credit;
      runningBalance = newBalance; // maintain for next entry in this batch
      
      if (!Number.isFinite(newBalance)) {
        throw new Error('Invalid balance calculation');
      }

      // Get next sequence for this date
      const [seqResult] = await connection.query(
        `SELECT COALESCE(MAX(sequence), 0) + 1 as next_seq 
         FROM ledger_entries 
         WHERE customer_id = ? AND entry_date = ?`,
        [customerId, entryDate]
      );
      const sequence = Number(seqResult[0].next_seq) || 1;

      // Insert ledger entry (handle databases without entry_type)
      const _hasEntryTypeBulk = await hasEntryTypeColumn();
      let entryResult;
      if (_hasEntryTypeBulk) {
        [entryResult] = await connection.query(
          `INSERT INTO ledger_entries 
           (customer_id, entry_date, description, bill_no, entry_type, payment_mode, cheque_no, 
            debit_amount, credit_amount, balance, status, due_date, has_multiple_items, 
            sales_tax_rate, sales_tax_amount, sequence)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            customerId,
            entryDate,
            description || null,
            billNo || null,
            entryData.entryType || 'manual',
            paymentMode || 'Cash',
            chequeNo || null,
            debit,
            credit,
            Number(newBalance.toFixed(2)),
            status || 'pending',
            dueDate || null,
            useLineItems ? 1 : 0,
            Number(parseFloat(salesTaxRate) || 0),
            Number(parseFloat(salesTaxAmount) || 0),
            sequence
          ]
        );
      } else {
        [entryResult] = await connection.query(
          `INSERT INTO ledger_entries 
           (customer_id, entry_date, description, bill_no, payment_mode, cheque_no, 
            debit_amount, credit_amount, balance, status, due_date, has_multiple_items, 
            sales_tax_rate, sales_tax_amount, sequence)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            customerId,
            entryDate,
            description || null,
            billNo || null,
            paymentMode || 'Cash',
            chequeNo || null,
            debit,
            credit,
            Number(newBalance.toFixed(2)),
            status || 'pending',
            dueDate || null,
            useLineItems ? 1 : 0,
            Number(parseFloat(salesTaxRate) || 0),
            Number(parseFloat(salesTaxAmount) || 0),
            sequence
          ]
        );
      }

      const entryId = entryResult.insertId;

      // Handle line items or single material entry
      if (useLineItems && lineItems && lineItems.length > 0) {
        for (let i = 0; i < lineItems.length; i++) {
          const item = lineItems[i];
          const itemAmount = (parseFloat(item.quantity) || 0) * (parseFloat(item.rate) || 0);
          const taxRate = parseFloat(item.taxRate) || 0;
          const totalWithTax = itemAmount * (1 + taxRate / 100);
          
          await connection.query(
            `INSERT INTO ledger_line_items 
             (entry_id, description, quantity, rate, tax_rate, amount, total_with_tax, item_type, line_sequence)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              entryId,
              item.description || '',
              parseFloat(item.quantity) || 0,
              parseFloat(item.rate) || 0,
              taxRate,
              itemAmount,
              totalWithTax,
              item.type || 'material',
              i + 1
            ]
          );
        }
      } else if (mtr && rate) {
        // Single material entry
        const amount = parseFloat(mtr) * parseFloat(rate);
        await connection.query(
          `INSERT INTO ledger_single_materials 
           (entry_id, quantity_mtr, rate, tax_rate, amount)
           VALUES (?, ?, ?, ?, ?)`,
          [
            entryId,
            parseFloat(mtr),
            parseFloat(rate),
            Number(parseFloat(salesTaxRate) || 0),
            amount
          ]
        );
      }

      createdEntries.push({
        entryId,
        description,
        newBalance
      });
    }

    await connection.commit();

    res.status(201).json({
      success: true,
      message: `${entriesToAdd.length} ledger entries created successfully in bulk`,
      data: {
        entries: createdEntries
      }
    });

  } catch (error) {
    await connection.rollback();
    console.error('[ledgerEntries] Error creating bulk entries:', error);
    res.status(500).json({ 
      error: 'Failed to create bulk ledger entries',
      details: error.message 
    });
  } finally {
    connection.release();
  }
});

module.exports = router;
