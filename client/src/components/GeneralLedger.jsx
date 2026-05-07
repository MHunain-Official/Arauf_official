import React, { useState, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { generateLedgerPDF } from '../utils/ledgerPdfGenerator';
import { API_ENDPOINTS } from '../config/api';
// Financial Year feature temporarily disabled — comment out import until activated
// import FinancialYearManager from './FinancialYearManager';

const GeneralLedger = () => {
  const NON_EDITABLE_LEDGER_TYPES = new Set([
    'invoice',
    'invoice_tax',
    'po_invoice',
    'po_invoice_tax',
    'payment_tax'
  ]);

  const normalizeRefForLookup = (ref) => {
    const value = String(ref || '').trim();
    if (!value) return '';
    return value.startsWith('TAX-') ? value.slice(4) : value;
  };

  const isStandaloneManualLedgerEntry = (entry, invoiceEntries = []) => {
    if (!entry || !entry.entry_id || !entry.isManualEntry) return false;

    const normalizedType = String(entry.entry_type || entry.entryType || '').toLowerCase().trim();
    if (normalizedType && NON_EDITABLE_LEDGER_TYPES.has(normalizedType)) return false;

    const rawRef = String(entry.billNo || entry.bill_no || '').trim();
    const normalizedRef = normalizeRefForLookup(rawRef);
    if (rawRef.startsWith('TAX-')) return false;
    const desc = String(entry.description || entry.particulars || '').toLowerCase();
    if (desc.includes('sales tax') || desc.includes('tax payment')) return false;
    if (!normalizedRef || normalizedRef === '-') return true;

    const linkedInvoiceExists = (invoiceEntries || []).some((row) => {
      if (row?.isManualEntry) return false;
      const candidate = normalizeRefForLookup(row.billNo || row.bill_no || row.invoiceId);
      return candidate && candidate.toLowerCase() === normalizedRef.toLowerCase();
    });
    return !linkedInvoiceExists;
  };

  const isTaxLikeEntry = (entry) => {
    const bill = String(entry?.billNo || entry?.bill_no || '').trim();
    const desc = String(entry?.description || entry?.particulars || '').toLowerCase();
    return bill.startsWith('TAX-') || desc.includes('sales tax') || desc.includes('tax payment');
  };

  const isPrimaryEditableRow = (entry, allEntries = []) => {
    if (!entry?.canEdit) return false;
    if (isTaxLikeEntry(entry)) return false;

    const debit = parseFloat(entry.debit) || parseFloat(entry.debit_amount) || 0;
    const credit = parseFloat(entry.credit) || parseFloat(entry.credit_amount) || 0;
    if (debit > 0) return true;

    if (credit > 0) {
      const ref = normalizeRefForLookup(entry.billNo || entry.bill_no);
      if (!ref) return true;
      const hasDebitSibling = (allEntries || []).some((row) => {
        if (!row?.canEdit) return false;
        if (isTaxLikeEntry(row)) return false;
        const rowRef = normalizeRefForLookup(row.billNo || row.bill_no);
        const rowDebit = parseFloat(row.debit) || parseFloat(row.debit_amount) || 0;
        return rowRef === ref && rowDebit > 0;
      });
      return !hasDebitSibling;
    }

    return false;
  };

  const [activeTab, setActiveTab] = useState(null); // Will be set to first customer
  const [currentDate] = useState(new Date().toISOString().split('T')[0]);
  const [customers, setCustomers] = useState([]);
  const [ledgerData, setLedgerData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  // Financial Year state (disabled for now)
  // const [showFinancialYearManager, setShowFinancialYearManager] = useState(false);
  // const [selectedFinancialYear, setSelectedFinancialYear] = useState(null); // Filter by FY
  // const [financialYears, setFinancialYears] = useState([]); // List of FYs for customer
  const [viewingInvoiceId, setViewingInvoiceId] = useState(null); // Track invoice being viewed
  const [isTableExpanded, setIsTableExpanded] = useState(false); // Toggle table expand/collapse
  const [taxReturnSettings, setTaxReturnSettings] = useState({
    taxReturnPeriodFrom: '2024-07-01',
    taxReturnPeriodTo: '2025-10-30'
  });
  const [settingsFormData, setSettingsFormData] = useState({
    taxReturnPeriodFrom: '2024-07-01',
    taxReturnPeriodTo: '2025-10-30',
    companyName: 'A-Rauf Textile',
    fiscalYearStart: '2024-07-01',
    fiscalYearEnd: '2025-06-30',
    currency: 'PKR',
    decimalPlaces: '2',
    dateFormat: 'DD/MM/YYYY',
    defaultPaymentMode: 'Cash',
    autoBalance: true,
    daysCalculation: true,
    allowFutureDates: false
  });
  const [newEntry, setNewEntry] = useState({
    date: '',
    particulars: '',
    description: '',
    mtr: '',
    rate: '',
    billNo: '',
    paymentMode: 'Cash',
    chequeNo: '',
    dueDate: '',
    entryType: 'debit', // 'debit' or 'credit'
    salesTaxRate: 0,
    isPaid: true, // true = create both invoice+payment; false = invoice (pending) only
  });

  // New state for line items (structured approach)
  const [lineItems, setLineItems] = useState([
    { id: 1, description: '', quantity: 0, rate: 0, type: 'material', amount: 0, taxRate: 0 }
  ]);
  const [useLineItems, setUseLineItems] = useState(false); // Toggle between old and new approach
  const [pendingMatchEntry, setPendingMatchEntry] = useState(null); // Pending debit entry matched by Bill #
  const [editingEntryId, setEditingEntryId] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();

  const resetEntryForm = () => {
    setEditingEntryId(null);
    setNewEntry({
      date: '',
      particulars: '',
      description: '',
      mtr: '',
      rate: '',
      billNo: '',
      paymentMode: 'Cash',
      chequeNo: '',
      dueDate: '',
      entryType: 'debit',
      salesTaxRate: 0,
      isPaid: true,
    });
    setLineItems([{ id: 1, description: '', quantity: 0, rate: 0, type: 'material', amount: 0, taxRate: 0 }]);
    setPendingMatchEntry(null);
  };

  // Load settings from localStorage on mount
  useEffect(() => {
    const savedSettings = localStorage.getItem('ledgerSettings');
    if (savedSettings) {
      try {
        const settings = JSON.parse(savedSettings);
        setTaxReturnSettings({
          taxReturnPeriodFrom: settings.taxReturnPeriodFrom || '2024-07-01',
          taxReturnPeriodTo: settings.taxReturnPeriodTo || '2025-10-30'
        });
        // Also load into form data
        setSettingsFormData({
          taxReturnPeriodFrom: settings.taxReturnPeriodFrom || '2024-07-01',
          taxReturnPeriodTo: settings.taxReturnPeriodTo || '2025-10-30',
          companyName: settings.companyName || 'A-Rauf Textile',
          fiscalYearStart: settings.fiscalYearStart || '2024-07-01',
          fiscalYearEnd: settings.fiscalYearEnd || '2025-06-30',
          currency: settings.currency || 'PKR',
          decimalPlaces: settings.decimalPlaces || '2',
          dateFormat: settings.dateFormat || 'DD/MM/YYYY',
          defaultPaymentMode: settings.defaultPaymentMode || 'Cash',
          autoBalance: settings.autoBalance !== false,
          daysCalculation: settings.daysCalculation !== false,
          allowFutureDates: settings.allowFutureDates === true
        });
      } catch (err) {
        console.error('Error loading ledger settings:', err);
      }
    }
  }, []);


  // -------------------------------------------

  // Fetch customers and ledger data from backend
  useEffect(() => {
    setLoading(true);
    
    const fetchData = async () => {
      try {
        // Fetch customers
        const customerResponse = await fetch(`${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'}/v1/customertable`);
        if (!customerResponse.ok) throw new Error('Failed to fetch customers');
        const customerData = await customerResponse.json();
        
        setCustomers(customerData || []);
        
        // Auto-select first customer if available
        if (customerData && customerData.length > 0) {
          const params = new URLSearchParams(location.search);
          const requestedId = params.get('customerId');
          
          if (requestedId && customerData.find(c => String(c.customer_id) === String(requestedId))) {
            setActiveTab(String(requestedId));
          } else {
            setActiveTab(String(customerData[0].customer_id));
          }
        }
        
        setError(null);
      } catch (err) {
        console.error('Error fetching customers:', err);
        setError('Failed to load customers');
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [location.search]);

  // Fetch ledger entries for selected customer from both invoices and ledger_entries table
  useEffect(() => {
    if (!activeTab) return;
    
    setLoading(true);
    
    const fetchLedgerData = async () => {
      try {
        // Fetch invoices and PO invoices from ledger-data endpoint
        console.log(`[GeneralLedger] 📡 Fetching ledger-data for customer: ${activeTab}`);
        
        // Build URL with date filter parameters if provided
        let url = `${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'}/ledger-data/${activeTab}`;
        const params = new URLSearchParams();
        if (fromDate) params.append('fromDate', fromDate);
        if (toDate) params.append('toDate', toDate);
        if (params.toString()) url += `?${params.toString()}`;
        
        const invoiceResponse = await fetch(url);
        if (!invoiceResponse.ok) throw new Error('Failed to fetch invoice data');
        
        const invoiceData = await invoiceResponse.json();
        console.log(`[GeneralLedger] 📦 Invoice API response:`, invoiceData);
        
        const invoices = invoiceData.success ? (invoiceData.data || []) : [];
        console.log(`[GeneralLedger] 📊 Parsed ${invoices.length} invoices from response`);
        
        // Fetch manually added ledger entries
        let manualEntries = [];
        try {
          const entriesResponse = await fetch(`${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'}/ledger-entries/customer/${activeTab}`);
          if (entriesResponse.ok) {
            const entriesData = await entriesResponse.json();
            if (entriesData.success && entriesData.data && entriesData.data.entries) {
              // Map database field names to match invoice format
              manualEntries = entriesData.data.entries.map(entry => ({
                date: entry.entry_date,
                particulars: entry.description || 'Manual Entry',
                description: entry.description || '',
                mtr: entry.mtr !== null && entry.mtr !== undefined ? parseFloat(entry.mtr) : null,
                rate: entry.rate !== null && entry.rate !== undefined ? parseFloat(entry.rate) : null,
                billNo: entry.bill_no || '-',
                paymentMode: entry.payment_mode || null,
                payment_mode: entry.payment_mode || null,  // Add both camelCase and snake_case for table compatibility
                chequeNo: entry.cheque_no || null,
                cheque_no: entry.cheque_no || null,  // Add both camelCase and snake_case for table compatibility
                invoiceId: entry.entry_id,
                dueDate: entry.due_date,
                totalAmount: (parseFloat(entry.debit_amount) || 0) + (parseFloat(entry.credit_amount) || 0),
                subtotal: (parseFloat(entry.debit_amount) || 0) + (parseFloat(entry.credit_amount) || 0),
                debit: parseFloat(entry.debit_amount) || 0,
                credit: parseFloat(entry.credit_amount) || 0,
                type: 'Manual Entry',
                status: entry.status || 'pending',
                taxRate: parseFloat(entry.sales_tax_rate) || 0,
                taxAmount: parseFloat(entry.sales_tax_amount) || 0,
                balance: parseFloat(entry.balance) || 0,
                isManualEntry: true,  // Mark as manual entry so Edit/Delete buttons show
                entry_id: entry.entry_id,  // Keep original ID for backend operations
                entry_type: entry.entry_type || 'manual'
              }));
              console.log(`[GeneralLedger] ✅ Loaded ${manualEntries.length} manual ledger entries from database`);
              console.log(`[GeneralLedger] 📋 Mapped manual entries:`, manualEntries);
              manualEntries.forEach((entry, idx) => {
                console.log(`[GeneralLedger] Entry ${idx}: payment_mode="${entry.payment_mode}", paymentMode="${entry.paymentMode}", cheque_no="${entry.cheque_no}"`);
              });
            }
          }
        } catch (e) {
          console.warn('[GeneralLedger] Could not fetch manual ledger entries:', e.message);
        }
        
        // Combine both sources - invoices + manually added entries
        const combinedEntries = [...invoices, ...manualEntries].map((entry) => ({
          ...entry,
          canEdit: isStandaloneManualLedgerEntry(entry, invoices)
        }));
        
        console.log(`[GeneralLedger] ✅ Received ${invoices.length} invoice entries + ${manualEntries.length} manual entries = ${combinedEntries.length} total for customer ${activeTab}`);
        console.log(`[GeneralLedger] 📋 Combined entries:`, combinedEntries);
        
        setLedgerData(prev => ({
          ...prev,
          [activeTab]: combinedEntries
        }));
        
        setError(null);
      } catch (err) {
        console.error('[GeneralLedger] Error fetching ledger data:', err);
        setError('Failed to load ledger data');
        // Set empty array on error
        setLedgerData(prev => ({
          ...prev,
          [activeTab]: []
        }));
      } finally {
        setLoading(false);
      }
    };
    
    fetchLedgerData();
  }, [activeTab, fromDate, toDate]);

  // No need to save to localStorage - all data comes from database

  // Lookup existing pending debit entry for a given Bill #
  const lookupPendingEntry = (billNo) => {
    if (!billNo || !String(billNo).trim()) {
      setPendingMatchEntry(null);
      return;
    }
    if (String(billNo).trim().toUpperCase().startsWith('TAX-')) {
      setPendingMatchEntry(null);
      return;
    }
    const entries = ledgerData[activeTab] || [];
    const match = entries.find(entry => {
      const entryBillNo = String(entry.billNo || entry.bill_no || '').trim();
      if (entryBillNo.toUpperCase().startsWith('TAX-')) return false;
      const debit = parseFloat(entry.debit) || parseFloat(entry.debit_amount) || 0;
      const credit = parseFloat(entry.credit) || parseFloat(entry.credit_amount) || 0;
      const status = String(entry.status || '').toLowerCase();
      return (
        entryBillNo === String(billNo).trim() &&
        debit > 0 &&
        credit === 0 &&
        status !== 'paid' &&
        entry.entry_id
      );
    });
    setPendingMatchEntry(match || null);
  };

  // Mark a pending debit entry as paid by updating its status (backend auto-creates credit entry)
  const handleMarkAsPaid = async () => {
    if (!pendingMatchEntry || !pendingMatchEntry.entry_id) {
      alert('No pending invoice found to mark as paid.');
      return;
    }
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'}/ledger-entries/entry/${pendingMatchEntry.entry_id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: pendingMatchEntry.particulars || pendingMatchEntry.description || '',
            status: 'paid',
            dueDate: pendingMatchEntry.dueDate || null,
            paymentMode: newEntry.paymentMode || 'Cash',
            chequeNo: newEntry.chequeNo || null
          })
        }
      );
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to mark as paid');
      }
      alert('✅ Invoice marked as paid! A credit entry has been created automatically.');
      setPendingMatchEntry(null);
      resetEntryForm();
      setShowAddModal(false);
      setTimeout(() => window.location.reload(), 500);
    } catch (err) {
      console.error('[GeneralLedger] ❌ Error marking as paid:', err);
      alert(`⚠️ Error: ${err.message}`);
    }
  };

  // Handle Add Entry submission
  const handleAddEntry = async () => {
    // Basic required fields
    if (!newEntry.date) {
      alert('Please select an Entry Date');
      return;
    }

    const entriesToAdd = [];
    const isDebit = newEntry.entryType === 'debit';
    const salesTaxRate = parseFloat(newEntry.salesTaxRate) || 0;

    // isPaidTx: CREDIT entries always create both sides; DEBIT entries create both only when isPaid=true
    const isPaidTx = !isDebit || newEntry.isPaid !== false;

    // Common fields
    const billNo = newEntry.billNo || null;
    const entryDueDate = newEntry.dueDate || null;
    const entryDesc = newEntry.description || billNo || `Entry-${Date.now()}`;

    if (useLineItems) {
      // Validate line items
      if (!lineItems || lineItems.length === 0) {
        alert('Please add at least one line item');
        return;
      }

      for (let i = 0; i < lineItems.length; i++) {
        const it = lineItems[i];
        if (!it.description || String(it.description).trim() === '') {
          alert(`Please add a description for item ${i + 1}`);
          return;
        }
        if ((Number(it.quantity) || 0) <= 0) {
          alert(`Please enter a quantity greater than 0 for item ${i + 1}`);
          return;
        }
        if ((Number(it.rate) || 0) <= 0) {
          alert(`Please enter a rate greater than 0 for item ${i + 1}`);
          return;
        }
      }

      // Compute totals from line items
      const totalFromItems = getLineItemsTotal();
      // In multi-item mode tax is per-line-item, not from global salesTaxRate
      const salesTaxAmount = lineItems.reduce((sum, item) => {
        const amt = item.amount || ((Number(item.quantity) || 0) * (Number(item.rate) || 0));
        return sum + amt * (Number(item.taxRate) || 0) / 100;
      }, 0);
      const effectiveTaxRate = totalFromItems > 0 ? Math.round((salesTaxAmount / totalFromItems) * 1000) / 10 : 0;
      const materialAmount = totalFromItems;

      // Derive description from line items when no overall description is provided
      const multiItemSummary = lineItems.length === 1
        ? lineItems[0].description
        : lineItems.map(it => String(it.description || '').trim()).filter(Boolean).join(' | ');
      const itemsEntryDesc = newEntry.description || multiItemSummary || billNo || `Entry-${Date.now()}`;

      // 1. DEBIT entry (Invoice/Sale) — always created
      const debitDesc = isDebit ? itemsEntryDesc : `Invoice - ${itemsEntryDesc}`;
      entriesToAdd.push({
        date: newEntry.date,
        particulars: debitDesc,
        description: debitDesc,
        itemsDetails: serializeLineItems(),
        mtr: null,
        rate: null,
        billNo: billNo,
        cash: 0, online: 0, cheque: 0,
        chequeNo: newEntry.chequeNo || null,
        debit: materialAmount,
        credit: 0,
        balance: 0,
        days: 0,
        dueDate: entryDueDate,
        has_multiple_items: true,
        isManualEntry: true,
        _isTaxEntry: false,
        _hasLineItems: true,
      });

      // 2. CREDIT entry (Payment Received) — created only when isPaidTx
      if (isPaidTx) {
        const creditDesc = isDebit ? 'Payment Received' : itemsEntryDesc;
        entriesToAdd.push({
          date: newEntry.date,
          particulars: creditDesc,
          description: creditDesc,
          itemsDetails: null,
          mtr: null,
          rate: null,
          billNo: billNo,
          cash: newEntry.paymentMode === 'Cash' ? materialAmount : 0,
          online: newEntry.paymentMode === 'Online' ? materialAmount : 0,
          cheque: newEntry.paymentMode === 'Cheque' ? materialAmount : 0,
          chequeNo: newEntry.chequeNo || null,
          debit: 0,
          credit: materialAmount,
          balance: 0,
          days: 0,
          dueDate: null,
          has_multiple_items: false,
          isManualEntry: true,
          _isTaxEntry: false,
          _hasLineItems: false,
        });
      }

      // Keep tax as separate entries using TAX-<Bill#>
      if (salesTaxAmount > 0) {
        const taxBillNo = billNo ? `TAX-${billNo}` : null;
        const taxLabel = `Sales Tax @ ${effectiveTaxRate > 0 ? effectiveTaxRate : 0}%`;
        entriesToAdd.push({
          date: newEntry.date,
          particulars: taxLabel,
          description: taxLabel,
          itemsDetails: null,
          mtr: null,
          rate: null,
          billNo: taxBillNo,
          cash: 0, online: 0, cheque: 0,
          chequeNo: null,
          debit: salesTaxAmount,
          credit: 0,
          balance: 0,
          days: 0,
          dueDate: entryDueDate,
          has_multiple_items: false,
          isManualEntry: true,
          _isTaxEntry: true,
          _hasLineItems: false,
        });

        if (isPaidTx) {
          entriesToAdd.push({
            date: newEntry.date,
            particulars: `Tax Payment @ ${effectiveTaxRate > 0 ? effectiveTaxRate : 0}%`,
            description: `Tax Payment @ ${effectiveTaxRate > 0 ? effectiveTaxRate : 0}%`,
            itemsDetails: null,
            mtr: null,
            rate: null,
            billNo: taxBillNo,
            cash: 0, online: 0, cheque: 0,
            chequeNo: null,
            debit: 0,
            credit: salesTaxAmount,
            balance: 0,
            days: 0,
            dueDate: null,
            has_multiple_items: false,
            isManualEntry: true,
            _isTaxEntry: true,
            _hasLineItems: false,
          });
        }
      }

    } else {
      // SINGLE MATERIAL MODE
      if (!newEntry.mtr || Number(newEntry.mtr) <= 0) {
        alert('Please enter Quantity (Mtr) greater than 0');
        return;
      }

      if (!newEntry.rate || Number(newEntry.rate) <= 0) {
        alert('Please enter Rate greater than 0');
        return;
      }

      const materialAmount = (Number(newEntry.mtr) || 0) * (Number(newEntry.rate) || 0);
      const salesTaxAmount = (materialAmount * salesTaxRate) / 100;

      const debitDesc = isDebit ? entryDesc : `Invoice - ${entryDesc}`;
      entriesToAdd.push({
        date: newEntry.date,
        particulars: debitDesc,
        description: debitDesc,
        mtr: Number(newEntry.mtr),
        rate: Number(newEntry.rate),
        billNo: billNo,
        cash: 0, online: 0, cheque: 0,
        chequeNo: newEntry.chequeNo || null,
        debit: materialAmount,
        credit: 0,
        balance: 0,
        days: 0,
        dueDate: entryDueDate,
        has_multiple_items: false,
        isManualEntry: true,
        _isTaxEntry: false,
        _hasLineItems: false,
      });

      if (isPaidTx) {
        const creditDesc = isDebit ? 'Payment Received' : entryDesc;
        entriesToAdd.push({
          date: newEntry.date,
          particulars: creditDesc,
          description: creditDesc,
          mtr: null,
          rate: null,
          billNo: billNo,
          cash: newEntry.paymentMode === 'Cash' ? materialAmount : 0,
          online: newEntry.paymentMode === 'Online' ? materialAmount : 0,
          cheque: newEntry.paymentMode === 'Cheque' ? materialAmount : 0,
          chequeNo: newEntry.chequeNo || null,
          debit: 0,
          credit: materialAmount,
          balance: 0,
          days: 0,
          dueDate: null,
          has_multiple_items: false,
          isManualEntry: true,
          _isTaxEntry: false,
          _hasLineItems: false,
        });
      }

      if (salesTaxAmount > 0) {
        const taxBillNo = billNo ? `TAX-${billNo}` : null;
        entriesToAdd.push({
          date: newEntry.date,
          particulars: `Sales Tax @ ${salesTaxRate}%`,
          description: `Sales Tax @ ${salesTaxRate}%`,
          mtr: null,
          rate: null,
          billNo: taxBillNo,
          cash: 0, online: 0, cheque: 0,
          chequeNo: null,
          debit: salesTaxAmount,
          credit: 0,
          balance: 0,
          days: 0,
          dueDate: entryDueDate,
          has_multiple_items: false,
          isManualEntry: true,
          _isTaxEntry: true,
          _hasLineItems: false,
        });
        if (isPaidTx) {
          entriesToAdd.push({
            date: newEntry.date,
            particulars: `Tax Payment @ ${salesTaxRate}%`,
            description: `Tax Payment @ ${salesTaxRate}%`,
            mtr: null,
            rate: null,
            billNo: taxBillNo,
            cash: 0, online: 0, cheque: 0,
            chequeNo: null,
            debit: 0,
            credit: salesTaxAmount,
            balance: 0,
            days: 0,
            dueDate: null,
            has_multiple_items: false,
            isManualEntry: true,
            _isTaxEntry: true,
            _hasLineItems: false,
          });
        }
      }
    }

    // Save entries to backend API
    try {
      console.log('[GeneralLedger] Saving entries to backend:', entriesToAdd);
      
      // Build the payload — all entries are explicit (no server-side auto tax creation)
      const entriesToPost = entriesToAdd.map(entry => {
        const isTaxEntry = entry._isTaxEntry === true;
        const hasLineItemsEntry = entry._hasLineItems === true;

        // Send line items only for the main debit entry (invoice)
        const backendLineItems = (useLineItems && hasLineItemsEntry)
          ? lineItems.map(item => ({
              description: item.description,
              quantity: Number(item.quantity) || 0,
              rate: Number(item.rate) || 0,
              type: item.type || 'material',
              taxRate: Number(item.taxRate) || 0
            }))
          : [];

        return {
          entryDate: entry.date,
          description: entry.particulars,
          billNo: entry.billNo,
          entryType: isTaxEntry ? 'manual_tax' : (entry.debit > 0 ? 'manual' : 'payment'),
          paymentMode: newEntry.paymentMode,
          chequeNo: entry.chequeNo,
          debitAmount: entry.debit,
          creditAmount: entry.credit,
          dueDate: entry.dueDate,
          // Pending status only for a lone debit invoice (isDebit + not isPaid)
          status: (entry.credit > 0 || isPaidTx) ? 'paid' : 'unpaid',
          salesTaxRate: isTaxEntry ? 0 : (parseFloat(newEntry.salesTaxRate) || 0),
          salesTaxAmount: 0,  // all entries are explicit; disable server auto-tax
          useLineItems: !!(useLineItems && hasLineItemsEntry),
          mtr: entry.mtr,
          rate: entry.rate,
          isTaxEntry: isTaxEntry,
          lineItems: backendLineItems.length > 0 ? backendLineItems : undefined,
        };
      });

      console.log('[GeneralLedger] 📤 Posting to backend with payload:', entriesToPost);

      // Send all entries in a single request
      const response = await fetch(`${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'}/ledger-entries/customer/${activeTab}/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: entriesToPost })
      });

      if (!response.ok) {
        // If bulk endpoint doesn't exist, fall back to individual inserts
        console.warn('[GeneralLedger] Bulk endpoint not available, falling back to individual inserts');
        
        for (let entry of entriesToPost) {
          const singleResponse = await fetch(`${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'}/ledger-entries/customer/${activeTab}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry)
          });

          if (!singleResponse.ok) {
            const errData = await singleResponse.json();
            throw new Error(errData.error || 'Failed to save entry');
          }

          const result = await singleResponse.json();
          console.log('[GeneralLedger] ✅ Entry saved to backend:', result);
        }
      } else {
        const result = await response.json();
        console.log('[GeneralLedger] ✅ Bulk entries saved to backend:', result);
      }

      alert('✅ Entries saved successfully!');
    } catch (err) {
      console.error('[GeneralLedger] ❌ Error saving entries to backend:', err);
      alert(`⚠️ Error saving to backend: ${err.message}\n\nEntries saved locally. Check server connection.`);
    }

    // Add all entries to ledger data
    setLedgerData(prev => ({
      ...prev,
      [activeTab]: [...(prev[activeTab] || []), ...entriesToAdd]
    }));

    // Reset form and close modal
    resetEntryForm();
    setShowAddModal(false);

    // Auto-refresh ledger data after 500ms to show the new entry
    setTimeout(() => {
      console.log('[GeneralLedger] 🔄 Auto-refreshing ledger data after new entry...');
      window.location.reload();  // Refresh the page to fetch latest data from backend
    }, 500);
  };

  // Filter ledger data by date range and recalculate balances
  const filteredLedgerData = useMemo(() => {
    let data = ledgerData[activeTab] || [];
    
    // Filter by date range if provided
    if (fromDate && toDate) {
      data = data.filter(entry => {
        const entryDate = new Date(entry.date);
        const from = new Date(fromDate);
        const to = new Date(toDate);
        return entryDate >= from && entryDate <= to;
      });
    }
    
    // Sort by date: oldest first (ASC), newest last (DESC)
    data = data.sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      return dateA - dateB;  // Ascending order: older dates first, newer dates last
    });
    
    // Recalculate balances based on filtered entries
    // ALWAYS show debit as DEBIT and credit as CREDIT, regardless of status
    // Status only affects the visual indicator, not which column the amount appears in
    let runningBalance = 0;
    return data.map(entry => {
      // Get actual debit/credit values with fallbacks for different field names
      const debitValue = parseFloat(entry.debit) || parseFloat(entry.debit_amount) || 0;
      const creditValue = parseFloat(entry.credit) || parseFloat(entry.credit_amount) || 0;
      
      // Display debit and credit in their correct columns (never move them based on status)
      const displayDebit = debitValue > 0 ? debitValue : null;
      const displayCredit = creditValue > 0 ? creditValue : null;
      
      return {
        ...entry,
        // Override debit/credit for display purposes
        _displayDebit: displayDebit,
        _displayCredit: displayCredit,
        balance: (runningBalance += ((displayDebit || 0) - (displayCredit || 0)))
      };
    });
  }, [ledgerData, activeTab, fromDate, toDate]);

  // Calculate summary statistics including payment methods
  const summary = useMemo(() => {
    const data = filteredLedgerData;
    // Use corrected display values for totals (handle null values)
    const totalDebit = data.reduce((sum, entry) => sum + (entry._displayDebit !== null ? parseFloat(entry._displayDebit) || 0 : 0), 0);
    const totalCredit = data.reduce((sum, entry) => sum + (entry._displayCredit !== null ? parseFloat(entry._displayCredit) || 0 : 0), 0);
    
    // Calculate net balance: Total Debit - Total Credit
    const netBalance = totalDebit - totalCredit;
    
    // Get last entry's balance if available, otherwise use calculated net balance
    const currentBalance = data.length > 0 ? netBalance : 0;
    
    const overdueEntries = data.filter(entry => 
      entry.dueDate && new Date(entry.dueDate) < new Date() && (parseFloat(entry.balance) || 0) > 0
    ).length;
    
    const averageDays = data.filter(entry => entry.days !== null).reduce((sum, entry) => sum + (parseFloat(entry.days) || 0), 0) / 
                       data.filter(entry => entry.days !== null).length || 0;

    // Payment method totals
    const totalCash = data.reduce((sum, entry) => sum + (parseFloat(entry.cash) || 0), 0);
    const totalOnline = data.reduce((sum, entry) => sum + (parseFloat(entry.online) || 0), 0);
    const totalCheque = data.reduce((sum, entry) => sum + (parseFloat(entry.cheque) || 0), 0);

    return {
      totalDebit,
      totalCredit,
      currentBalance,
      netBalance,
      overdueEntries,
      totalEntries: data.length,
      averageDays: Math.round(averageDays),
      totalCash,
      totalOnline,
      totalCheque
    };
  }, [filteredLedgerData]);

  const formatCurrency = (amount) => {
    if (amount === null || amount === undefined || isNaN(amount)) return 'Rs 0';
    const numAmount = parseFloat(amount) || 0;
    return new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: 'PKR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(numAmount);
  };

  // ===== PAYMENT STATUS CALCULATION =====
  const getPaymentStatus = (entry) => {
    // Draft status - no invoice number or status is draft
    if (!entry.invoiceId || entry.status === 'Draft' || entry.billNo === '-') {
      return { status: 'draft', label: '• Draft', color: 'bg-slate-100 text-slate-700', badge: 'bg-slate-200' };
    }

    // Paid status - check status field OR credit equals or exceeds debit
    if (entry.status === 'Paid' || entry.status === 'paid' || (entry.credit || 0) >= (entry.debit || 0)) {
      return { status: 'paid', label: '✓ Paid', color: 'bg-green-100 text-green-800', badge: 'bg-green-200' };
    }

    // Pending/Overdue status - based on due date
    if (entry.dueDate && entry.debit > 0) {
      const dueDate = new Date(entry.dueDate);
      const today = new Date(currentDate);
      const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));

      if (daysOverdue > 0) {
        return { status: 'overdue', label: `Overdue by ${daysOverdue}d`, color: 'bg-red-100 text-red-800', badge: 'bg-red-200', daysOverdue };
      } else if (daysOverdue === 0) {
        return { status: 'due-today', label: 'Due Today', color: 'bg-orange-100 text-orange-800', badge: 'bg-orange-200' };
      }
    }

    // Pending status - not yet due
    return { status: 'pending', label: 'Pending', color: 'bg-blue-100 text-blue-700', badge: 'bg-blue-200' };
  };

  // ===== LINE ITEMS HELPER FUNCTIONS =====
  
  // Add a new line item
  const addLineItem = () => {
    const newId = Math.max(...lineItems.map(item => item.id || 0), 0) + 1;
    setLineItems([
      ...lineItems,
      { id: newId, description: '', quantity: 0, rate: 0, type: 'material', amount: 0, taxRate: 0 }
    ]);
  };

  // Remove a line item
  const removeLineItem = (id) => {
    if (lineItems.length === 1) {
      alert('At least one item is required');
      return;
    }
    setLineItems(lineItems.filter(item => item.id !== id));
  };

  // Update a line item
  const updateLineItem = (id, field, value) => {
    setLineItems(lineItems.map(item => {
      if (item.id === id) {
        const updated = { ...item, [field]: value };
        // Auto-calculate amount
        if (field === 'quantity' || field === 'rate') {
          updated.amount = (Number(updated.quantity) || 0) * (Number(updated.rate) || 0);
        }
        return updated;
      }
      return item;
    }));
  };

  // Calculate total from line items
  const getLineItemsTotal = () => {
    return lineItems.reduce((total, item) => {
      // Calculate amount from quantity * rate as fallback if amount field is missing
      const itemAmount = item.amount || ((Number(item.quantity) || 0) * (Number(item.rate) || 0));
      return total + itemAmount;
    }, 0);
  };

  // Get items grouped by type
  const getItemsByType = () => {
    return lineItems.reduce((acc, item) => {
      if (!acc[item.type]) acc[item.type] = [];
      acc[item.type].push(item);
      return acc;
    }, {});
  };

  // Serialize line items for storage
  const serializeLineItems = () => {
    return lineItems
      .map(item => `${item.description}|||${item.quantity}|||${item.rate}|||${item.type}`)
      .join(':::');
  };

  const formatDate = (dateString) => {
    if (!dateString || dateString === 'Invalid Date') return '-';
    try {
      const date = new Date(dateString);
      if (isNaN(date)) return '-';
      return date.toLocaleDateString('en-PK', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (e) {
      return '-';
    }
  };

  // Extract short invoice reference from database ID
  // For manual entries: use billNo directly (same as Bill # input)
  // For invoices: use invoiceId formatted as INV-{id}
  const getShortRef = (billNo, invoiceId, isManualEntry) => {
    if (!billNo && !invoiceId) return '-';
    
    // For manual entries, use billNo directly (the user's input)
    if (isManualEntry) {
      return billNo || '-';
    }
    
    // For invoices, use invoiceId (database ID)
    if (invoiceId) {
      const idStr = invoiceId.toString();
      // If it already starts with "INV-" or "PO", use as-is
      if (idStr.includes('-')) {
        return idStr;
      }
      // Otherwise prepend "INV-"
      return `INV-${idStr}`;
    }
    
    // If billNo is short (like already formatted), use it
    if (billNo && billNo.length < 20) {
      return billNo;
    }
    
    // Fallback to billNo as-is
    return billNo || '-';
  };

  // Handle delete entry and recalculate balances for subsequent entries
  const handleDeleteEntry = async (entryToDelete) => {
    if (!window.confirm('Are you sure you want to delete this entry? This cannot be undone.')) return;

    try {
      const currentEntries = ledgerData[activeTab] || [];
      const deleteEntryId = entryToDelete?.entry_id;

      // Only delete from backend if it's a manual entry with an entry_id
      if (entryToDelete?.isManualEntry && deleteEntryId) {
        console.log(`[GeneralLedger] 🗑️ Deleting entry_id=${deleteEntryId} from backend`);
        
        const deleteResponse = await fetch(
          `${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'}/ledger-entries/entry/${deleteEntryId}`,
          { method: 'DELETE' }
        );

        if (!deleteResponse.ok) {
          const errData = await deleteResponse.json();
          throw new Error(errData.error || 'Failed to delete entry from backend');
        }

        console.log('[GeneralLedger] ✅ Entry deleted from backend');
      }

      // Remove from local state
      const newEntries = currentEntries.filter((item) => String(item.entry_id || '') !== String(deleteEntryId || ''));

      // Recalculate balances from the deletion point onwards
      let runningBalance = 0;
      for (let i = 0; i < newEntries.length; i++) {
        const entry = newEntries[i];
        const debit = parseFloat(entry._displayDebit) || parseFloat(entry.debit) || 0;
        const credit = parseFloat(entry._displayCredit) || parseFloat(entry.credit) || 0;
        runningBalance = runningBalance + debit - credit;
        newEntries[i].balance = runningBalance;
      }

      setLedgerData(prev => ({
        ...prev,
        [activeTab]: newEntries
      }));

      alert('✅ Entry deleted successfully!');
    } catch (err) {
      console.error('[GeneralLedger] ❌ Error deleting entry:', err);
      alert(`⚠️ Error deleting entry: ${err.message}`);
    }
  };

  // Migrate all pending entries to draft status
  const handleMigrateToDraft = async () => {
    if (!window.confirm('Migrate all "pending" status entries to "draft" status? This will update existing manual entries.')) return;

    try {
      const response = await fetch(`${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'}/ledger-entries/admin/migrate-to-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) throw new Error('Failed to migrate entries');

      const result = await response.json();
      alert(`✅ ${result.affectedRows} entries migrated from "pending" to "draft"`);

      // Reload ledger data
      window.location.reload();
    } catch (err) {
      console.error('[GeneralLedger] ❌ Error migrating entries:', err);
      alert(`⚠️ Error migrating entries: ${err.message}`);
    }
  };

  const openEditInAddForm = async (entry) => {
    if (!entry?.entry_id) {
      alert('This entry cannot be edited.');
      return;
    }
    const entryBillNo = String(entry.billNo || entry.bill_no || '').trim();
    if (entryBillNo.toUpperCase().startsWith('TAX-')) {
      alert('Tax references (TAX-) cannot be edited from New Ledger Entry form.');
      return;
    }

    const billNo = (entry.billNo || entry.bill_no || '') === '-' ? '' : (entry.billNo || entry.bill_no || '');
    const normalizedBill = normalizeRefForLookup(billNo);
    const related = (ledgerData[activeTab] || []).filter((row) => {
      if (!row?.entry_id || !row?.isManualEntry) return false;
      return normalizeRefForLookup(row.billNo || row.bill_no) === normalizedBill;
    });
    const hasCreditSibling = related.some((row) => (parseFloat(row.credit) || parseFloat(row.credit_amount) || 0) > 0);

    let detailEntry = entry;
    try {
      const response = await fetch(`${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'}/ledger-entries/entry/${entry.entry_id}`);
      if (response.ok) {
        const payload = await response.json();
        if (payload?.success && payload?.data) {
          detailEntry = { ...entry, ...payload.data };
        }
      }
    } catch (e) {
      console.warn('[GeneralLedger] Failed to fetch detailed entry for edit:', e.message);
    }

    const debit = parseFloat(detailEntry.debit) || parseFloat(detailEntry.debit_amount) || 0;
    const credit = parseFloat(detailEntry.credit) || parseFloat(detailEntry.credit_amount) || 0;
    const amount = debit > 0 ? debit : credit;
    const qty = parseFloat(detailEntry.mtr ?? detailEntry.quantity_mtr) || 0;
    const rate = parseFloat(detailEntry.rate) || 0;
    const amountWithoutTax = qty > 0 && rate > 0 ? qty * rate : amount;
    const taxRate = parseFloat(detailEntry.taxRate ?? detailEntry.sales_tax_rate) || 0;

    setEditingEntryId(entry.entry_id);
    setUseLineItems(Boolean(detailEntry.has_multiple_items && Array.isArray(detailEntry.lineItems) && detailEntry.lineItems.length > 0));
    if (detailEntry.has_multiple_items && Array.isArray(detailEntry.lineItems) && detailEntry.lineItems.length > 0) {
      setLineItems(detailEntry.lineItems.map((item, idx) => ({
        id: idx + 1,
        description: item.description || '',
        quantity: Number(item.quantity) || 0,
        rate: Number(item.rate) || 0,
        type: item.item_type || item.type || 'material',
        amount: Number(item.amount) || ((Number(item.quantity) || 0) * (Number(item.rate) || 0)),
        taxRate: Number(item.tax_rate ?? item.taxRate) || 0
      })));
    }
    setNewEntry({
      date: detailEntry.entry_date ? String(detailEntry.entry_date).split('T')[0] : (detailEntry.date ? String(detailEntry.date).split('T')[0] : ''),
      particulars: detailEntry.particulars || '',
      description: detailEntry.description || detailEntry.particulars || '',
      mtr: qty > 0 ? qty : '',
      rate: rate > 0 ? rate : '',
      billNo,
      paymentMode: detailEntry.payment_mode || detailEntry.paymentMode || 'Cash',
      chequeNo: detailEntry.cheque_no || detailEntry.chequeNo || '',
      dueDate: detailEntry.due_date || detailEntry.dueDate || '',
      entryType: debit >= credit ? 'debit' : 'credit',
      salesTaxRate: taxRate > 0 ? taxRate : (amountWithoutTax > 0 ? (((amount - amountWithoutTax) / amountWithoutTax) * 100).toFixed(2) : 0),
      isPaid: hasCreditSibling
    });
    setShowAddModal(true);
  };

  const handleEditEntry = (entryToEdit) => {
    if (!entryToEdit || !isPrimaryEditableRow(entryToEdit, ledgerData[activeTab] || [])) {
      alert('Please click Edit on the main DEBIT entry. Linked payment/tax rows update automatically.');
      return;
    }

    openEditInAddForm(entryToEdit);
  };

  const handleUpdateEntry = async () => {
    if (!editingEntryId) return;
    if (!newEntry.date) {
      alert('Please select an Entry Date');
      return;
    }

    let subtotalAmount = 0;
    let taxAmount = 0;
    if (useLineItems) {
      subtotalAmount = getLineItemsTotal();
      taxAmount = lineItems.reduce((sum, item) => {
        const amt = item.amount || ((Number(item.quantity) || 0) * (Number(item.rate) || 0));
        return sum + (amt * (Number(item.taxRate) || 0) / 100);
      }, 0);
    } else {
      if (!newEntry.mtr || Number(newEntry.mtr) <= 0 || !newEntry.rate || Number(newEntry.rate) <= 0) {
        alert('Please enter valid quantity and rate');
        return;
      }
      subtotalAmount = (Number(newEntry.mtr) || 0) * (Number(newEntry.rate) || 0);
      taxAmount = (subtotalAmount * (Number(newEntry.salesTaxRate) || 0)) / 100;
    }

      const ref = normalizeRefForLookup(newEntry.billNo);
    const candidates = (ledgerData[activeTab] || []).filter((row) => {
      if (!row?.entry_id || !row?.isManualEntry) return false;
      if (ref) return normalizeRefForLookup(row.billNo || row.bill_no) === ref;
      return String(row.entry_id) === String(editingEntryId);
    });
    const targets = candidates.length > 0 ? candidates : (ledgerData[activeTab] || []).filter((row) => String(row.entry_id) === String(editingEntryId));

    try {
      for (const row of targets) {
        const rowBill = String(row.billNo || row.bill_no || '');
        const isTaxRow = rowBill.startsWith('TAX-') || isTaxLikeEntry(row);
        const existingDebit = parseFloat(row.debit) || parseFloat(row.debit_amount) || 0;
        const existingCredit = parseFloat(row.credit) || parseFloat(row.credit_amount) || 0; 
        const isCreditRow = existingCredit > 0 && existingDebit === 0;
        const txType = targets.length === 1 ? newEntry.entryType : (existingDebit > 0 ? 'debit' : 'credit');
        const rowAmount = isTaxRow ? taxAmount : subtotalAmount;
        if (rowAmount <= 0) continue;

        const response = await fetch(
          `${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'}/ledger-entries/entry/${row.entry_id}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              entryDate: newEntry.date,
              description: isTaxRow
                ? (isCreditRow ? `Tax Payment @ ${newEntry.salesTaxRate || 0}%` : `Sales Tax @ ${newEntry.salesTaxRate || 0}%`)
                : (txType === 'credit' ? (row.particulars || row.description || 'Payment Received') : (newEntry.description || row.particulars || row.description || '')),
              billNo: rowBill || null, // locked in edit mode
              transactionType: txType,
              debitAmount: rowAmount,
              creditAmount: rowAmount,
              useLineItems: !isTaxRow && !!useLineItems,
              mtr: !isTaxRow && !useLineItems ? Number(newEntry.mtr || 0) : null,
              rate: !isTaxRow && !useLineItems ? Number(newEntry.rate || 0) : null,
              lineItems: !isTaxRow && useLineItems
                ? lineItems.map(item => ({
                    description: item.description,
                    quantity: Number(item.quantity) || 0,
                    rate: Number(item.rate) || 0,
                    type: item.type || 'material',
                    taxRate: Number(item.taxRate) || 0
                  }))
                : undefined,
              salesTaxRate: Number(newEntry.salesTaxRate || 0),
              dueDate: row.due_date || row.dueDate || null,
              status: row.status || 'unpaid', // locked in edit mode
              paymentMode: row.payment_mode || row.paymentMode || 'Cash', // locked in edit mode
              chequeNo: row.cheque_no || row.chequeNo || null // locked in edit mode
            })
          }
        );
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to update entry');
        }
      }

      alert('✅ Entry updated successfully!');
      setShowAddModal(false);
      resetEntryForm();
      setTimeout(() => window.location.reload(), 300);
    } catch (err) {
      console.error('[GeneralLedger] ❌ Error updating entry:', err);
      alert(`⚠️ Error updating entry: ${err.message}`);
    }
  };

  const getDaysColor = (days) => {
    if (days === null || days === undefined) return 'text-gray-400';
    if (days > 90) return 'text-red-600 font-semibold';
    if (days > 60) return 'text-orange-600';
    if (days > 30) return 'text-yellow-600';
    return 'text-green-600';
  };

  // Handle saving settings modal
  const handleSaveSettings = () => {
    const toSave = {
      taxReturnPeriodFrom: settingsFormData.taxReturnPeriodFrom,
      taxReturnPeriodTo: settingsFormData.taxReturnPeriodTo,
      companyName: settingsFormData.companyName,
      fiscalYearStart: settingsFormData.fiscalYearStart,
      fiscalYearEnd: settingsFormData.fiscalYearEnd,
      currency: settingsFormData.currency,
      decimalPlaces: settingsFormData.decimalPlaces,
      dateFormat: settingsFormData.dateFormat,
      defaultPaymentMode: settingsFormData.defaultPaymentMode,
      autoBalance: settingsFormData.autoBalance,
      daysCalculation: settingsFormData.daysCalculation,
      allowFutureDates: settingsFormData.allowFutureDates
    };
    localStorage.setItem('ledgerSettings', JSON.stringify(toSave));
    
    // Update tax return settings for timeline
    setTaxReturnSettings({
      taxReturnPeriodFrom: settingsFormData.taxReturnPeriodFrom,
      taxReturnPeriodTo: settingsFormData.taxReturnPeriodTo
    });
    
    setShowSettingsModal(false);
  };

  const handleResetSettings = () => {
    if (window.confirm('Reset all settings to defaults?')) {
      const defaultSettings = {
        taxReturnPeriodFrom: '2024-07-01',
        taxReturnPeriodTo: '2025-10-30',
        companyName: 'A-Rauf Textile',
        fiscalYearStart: '2024-07-01',
        fiscalYearEnd: '2025-06-30',
        currency: 'PKR',
        decimalPlaces: '2',
        dateFormat: 'DD/MM/YYYY',
        defaultPaymentMode: 'Cash',
        autoBalance: true,
        daysCalculation: true,
        allowFutureDates: false
      };
      setSettingsFormData(defaultSettings);
      localStorage.setItem('ledgerSettings', JSON.stringify(defaultSettings));
      setTaxReturnSettings({
        taxReturnPeriodFrom: defaultSettings.taxReturnPeriodFrom,
        taxReturnPeriodTo: defaultSettings.taxReturnPeriodTo
      });
    }
  };

  const getStatusColor = (dueDate, balance) => {
    if (!dueDate || balance <= 0) return 'bg-gray-50';
    const due = new Date(dueDate);
    const today = new Date();
    if (due < today) return 'bg-red-50 border-l-4 border-l-red-500';
    if ((due - today) / (1000 * 60 * 60 * 24) <= 7) return 'bg-yellow-50 border-l-4 border-l-yellow-500';
    return 'bg-green-50 border-l-4 border-l-green-500';
  };

  const getDaysBadge = (days) => {
    if (days === null || days === undefined) return (
      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
        N/A
      </span>
    );

    let bgColor = 'bg-green-100 text-green-800';
    if (days > 90) bgColor = 'bg-red-100 text-red-800';
    else if (days > 60) bgColor = 'bg-orange-100 text-orange-800';
    else if (days > 30) bgColor = 'bg-yellow-100 text-yellow-800';

    return (
      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${bgColor}`}>
        {days} days
      </span>
    );
  };

  const PaymentMethodCell = ({ cash, online, cheque }) => {
    const hasValue = cash || online || cheque;
    
    if (!hasValue) return <span className="text-gray-400">-</span>;

    return (
      <div className="space-y-1">
        {cash && (
          <div className="flex items-center text-xs">
            <div className="w-2 h-2 bg-green-500 rounded-full mr-1"></div>
            <span className="text-green-700 font-medium">{formatCurrency(cash)}</span>
          </div>
        )}
        {online && (
          <div className="flex items-center text-xs">
            <div className="w-2 h-2 bg-blue-500 rounded-full mr-1"></div>
            <span className="text-blue-700 font-medium">{formatCurrency(online)}</span>
          </div>
        )}
        {cheque && (
          <div className="flex items-center text-xs">
            <div className="w-2 h-2 bg-purple-500 rounded-full mr-1"></div>
            <span className="text-purple-700 font-medium">{formatCurrency(cheque)}</span>
          </div>
        )}
      </div>
    );
  };

  // Loading state
  if (loading && customers.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 font-semibold">Loading ledger data...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 flex items-center justify-center">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md">
          <div className="flex items-center gap-3 mb-3">
            <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 className="text-red-800 font-bold text-lg">Error Loading Data</h3>
          </div>
          <p className="text-red-700">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 p-4 sm:p-6 md:p-8">
      <div className="mx-auto max-w-7xl">
        {/* === HEADER === */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate(-1)}
                className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 shadow-sm hover:shadow-md transition-all duration-200"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div>
                  <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">General Ledger</h1>
                  <p className="text-slate-500 text-sm mt-1 font-medium">
                    Account Statement • {new Date(currentDate).toLocaleDateString('en-PK', { year: 'numeric', month: 'long', day: 'numeric' })}
                    {(fromDate || toDate) && (
                      <span className="ml-3 text-blue-600 font-semibold">
                        📅 {fromDate ? new Date(fromDate).toLocaleDateString('en-PK', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'Start'} 
                        {' → '} 
                        {toDate ? new Date(toDate).toLocaleDateString('en-PK', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'End'}
                      </span>
                    )}
                  </p>
                  {/* Customer name - prominent under title */}
                  {((customers || []).find(c => String(c.customer_id) === String(activeTab))) ? (
                    (() => {
                      const cust = (customers || []).find(c => String(c.customer_id) === String(activeTab));
                      return (
                        <div className="mt-2">
                          <div className="text-sm text-slate-500">Customer</div>
                          <div className="flex items-baseline gap-3">
                            <h2 className="text-xl md:text-2xl font-extrabold text-slate-900">{cust.customer_name || cust.customer || 'Unknown'}</h2>
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    null
                  )}
                </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowFilterPanel(!showFilterPanel)}
                className={`inline-flex items-center justify-center w-10 h-10 rounded-lg transition-all duration-200 border shadow-sm ${
                  showFilterPanel ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:shadow-md'
                }`}
                title="Filter"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
              </button>
            </div>
          </div>

        </div>

        {/* === SUMMARY CARDS === */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm hover:shadow-md transition-all duration-200 group">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-600 text-xs font-bold uppercase tracking-wider mb-2">Total Debit</p>
                <p className="text-2xl md:text-3xl font-bold text-slate-900">{formatCurrency(summary.totalDebit)}</p>
              </div>
              <div className="w-14 h-14 bg-red-50 rounded-xl flex items-center justify-center group-hover:bg-red-100 transition-colors duration-200">
                <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4m0 0L3 5m0 0v8m0-8l4 4" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm hover:shadow-md transition-all duration-200 group">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-600 text-xs font-bold uppercase tracking-wider mb-2">Total Credit</p>
                <p className="text-2xl md:text-3xl font-bold text-slate-900">{formatCurrency(summary.totalCredit)}</p>
              </div>
              <div className="w-14 h-14 bg-green-50 rounded-xl flex items-center justify-center group-hover:bg-green-100 transition-colors duration-200">
                <svg className="w-7 h-7 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7H5v12a1 1 0 001 1h12a1 1 0 001-1V7m0 0V5a2 2 0 012 2v2m0 0h2a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7m0 0h14" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm hover:shadow-md transition-all duration-200 group">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-600 text-xs font-bold uppercase tracking-wider mb-2">Balance</p>
                <p className="text-2xl md:text-3xl font-bold text-blue-600">{formatCurrency(summary.currentBalance)}</p>
              </div>
              <div className="w-14 h-14 bg-blue-50 rounded-xl flex items-center justify-center group-hover:bg-blue-100 transition-colors duration-200">
                <svg className="w-7 h-7 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm hover:shadow-md transition-all duration-200 group">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-600 text-xs font-bold uppercase tracking-wider mb-2">Avg Days Out</p>
                <p className="text-2xl md:text-3xl font-bold text-slate-900">{summary.averageDays}</p>
              </div>
              <div className="w-14 h-14 bg-purple-50 rounded-xl flex items-center justify-center group-hover:bg-purple-100 transition-colors duration-200">
                <svg className="w-7 h-7 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* === LEDGER TABLE === */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Table Header Action */}
          <div className="px-6 py-5 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-slate-50 to-slate-50">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Ledger Entries</h2>
              <p className="text-xs text-slate-500 mt-1">Showing {filteredLedgerData.length} transaction{filteredLedgerData.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => generateLedgerPDF(filteredLedgerData, customers.find(c => String(c.customer_id) === String(activeTab)), fromDate, toDate, settingsFormData)}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-md hover:shadow-lg transition-all duration-200"
                title="Download PDF"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2m0 0v-8m0 8H3m6-8h6" />
                </svg>
                PDF
              </button>
              {/* Financial Year button disabled for now
              <button
                onClick={() => setShowFinancialYearManager(true)}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-bold shadow-md hover:shadow-lg transition-all duration-200"
                title="Financial Year Manager"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                FY
              </button>
              */}
              <button
                onClick={() => setShowFilterPanel(!showFilterPanel)}
                className={`inline-flex items-center justify-center w-10 h-10 rounded-lg transition-all duration-200 border shadow-sm ${
                  showFilterPanel ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:shadow-md'
                }`}
                title="Filter"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
              </button>
              <button
                onClick={() => setIsTableExpanded(!isTableExpanded)}
                className="px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium transition-all duration-200 flex items-center gap-2 text-sm"
                title={isTableExpanded ? "Collapse table" : "Expand table"}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {isTableExpanded ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                  )}
                </svg>
                {isTableExpanded ? 'Collapse' : 'Expand'}
              </button>
              {!showFilterPanel && (
                <button
                  onClick={() => setShowAddModal(true)}
                  className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-bold transition-all duration-200 shadow-md hover:shadow-lg flex items-center gap-2 text-sm"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                  </svg>
                  New Entry
                </button>
              )}
            </div>
          </div>

          {/* Filter Panel - Under Ledger Entries Header */}
          {showFilterPanel && (
            <div className="px-6 py-4 border-b border-slate-200 bg-blue-50">
              <label className="block text-xs font-semibold text-slate-700 mb-3 uppercase tracking-wider">📅 Date Range</label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="px-3 py-2.5 rounded-lg bg-white text-gray-900 border border-slate-300 hover:border-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm"
                  placeholder="From"
                />
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="px-3 py-2.5 rounded-lg bg-white text-gray-900 border border-slate-300 hover:border-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm"
                  placeholder="To"
                />
                <button
                  onClick={() => {
                    setFromDate('');
                    setToDate('');
                  }}
                  className="px-4 py-2.5 rounded-lg bg-slate-300 hover:bg-slate-400 text-slate-700 font-medium transition-all text-sm border border-slate-400"
                >
                  Clear
                </button>
                <button
                  onClick={() => setShowAddModal(true)}
                  className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-bold transition-all text-sm flex items-center justify-center gap-2 shadow-md hover:shadow-lg"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Entry
                </button>
              </div>
            </div>
          )}

          {/* Balance Legend Box */}
          <div className="mb-4 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-l-4 border-blue-500 rounded-lg shadow-sm">
            <div className="flex items-start gap-4">
              <div className="flex-1">
                <h3 className="text-sm font-bold text-slate-800 mb-2">Balance Legend:</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-green-500"></div>
                    <span className="text-sm text-slate-700"><strong>Positive Balance:</strong> Customer owes us money</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500"></div>
                    <span className="text-sm text-slate-700"><strong>Negative Balance:</strong> We owe the customer money (overpayment/credit)</span>
                  </div>
                </div>
              </div>
              <svg className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
          </div>

          {/* Scrollable Table */}
          <div className={`w-full ${isTableExpanded ? 'max-h-[70vh] overflow-y-auto' : ''}`}>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gradient-to-r from-slate-800 to-slate-900 border-b-2 border-slate-300 sticky top-0">
                  <th className="px-6 py-4 text-left font-bold text-white whitespace-nowrap text-xs uppercase tracking-wider">Date</th>
                  <th className="px-6 py-4 text-left font-bold text-white text-xs uppercase tracking-wider">Description</th>
                  {isTableExpanded && (
                    <>
                      <th className="px-6 py-4 text-center font-bold text-white whitespace-nowrap text-xs uppercase tracking-wider">Qty</th>
                      <th className="px-6 py-4 text-center font-bold text-white whitespace-nowrap text-xs uppercase tracking-wider">Rate</th>
                    </>
                  )}
                  <th className="px-6 py-4 text-center font-bold text-white whitespace-nowrap text-xs uppercase tracking-wider">Ref #</th>
                  <th className="px-6 py-4 text-center font-bold text-white whitespace-nowrap text-xs uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-center font-bold text-white whitespace-nowrap text-xs uppercase tracking-wider">Payment</th>
                  <th className="px-6 py-4 text-right font-bold text-white whitespace-nowrap text-xs uppercase tracking-wider">Debit</th>
                  <th className="px-6 py-4 text-right font-bold text-white whitespace-nowrap text-xs uppercase tracking-wider">Credit</th>
                  <th className="px-8 py-4 text-right font-bold text-white whitespace-nowrap text-xs uppercase tracking-wider min-w-[140px]">Balance</th>
                  {isTableExpanded && (
                    <th className="px-6 py-4 text-center font-bold text-white whitespace-nowrap text-xs uppercase tracking-wider">Days</th>
                  )}
                  <th className="px-6 py-4 text-center font-bold text-white whitespace-nowrap text-xs uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredLedgerData.length > 0 ? (
                  filteredLedgerData.map((entry, index) => {
                    const paymentStatus = getPaymentStatus(entry);
                    const isUnpaid = paymentStatus.status !== 'paid' && paymentStatus.status !== 'draft';
                    const isOverdue = paymentStatus.status === 'overdue';
                    
                    return (
                      <tr 
                        key={index} 
                        className={`transition-all duration-300 border-l-4 ${
                          isOverdue
                            ? 'bg-white hover:bg-slate-50 border-l-red-600'
                            : isUnpaid
                            ? 'bg-white hover:bg-slate-50 border-l-slate-400'
                            : 'bg-white hover:bg-slate-50 border-l-slate-300'
                        }`}
                      >
                        <td className="px-6 py-4 text-slate-800 whitespace-nowrap text-sm font-semibold">{formatDate(entry.date)}</td>
                      <td className="px-6 py-4 text-slate-700 text-sm">
                        {(() => {
                          // Build items array from itemsDetails (preferred) or description (legacy)
                          const items = entry.itemsDetails
                            ? entry.itemsDetails.split(':::').map((s) => {
                                const parts = s.split('|||');
                                return {
                                  desc: parts[0] || '',
                                  qty: parts[1] ? Number(parts[1]) : null,
                                  rate: parts[2] ? Number(parts[2]) : null,
                                  type: parts[3] || 'material',
                                  amount: (parts[1] && parts[2]) ? Number(parts[1]) * Number(parts[2]) : 0
                                };
                              })
                            : entry.description
                            ? entry.description.split(', ').map((d) => ({ desc: d, qty: null, rate: null, type: 'material', amount: 0 }))
                            : [];

                          if (items.length === 0) return <span className="text-slate-500">{entry.description || entry.type || '-'}</span>;

                          // Get type badge colors
                          const getTypeBadge = (type) => {
                            const badges = {
                              material: 'bg-blue-100 text-blue-700',
                              service: 'bg-purple-100 text-purple-700',
                              labor: 'bg-orange-100 text-orange-700',
                              accessory: 'bg-pink-100 text-pink-700',
                              other: 'bg-slate-100 text-slate-700'
                            };
                            return badges[type] || 'bg-slate-100 text-slate-700';
                          };

                          // Single item - simple display
                          if (items.length === 1) {
                            return (
                              <div className="flex flex-col gap-1">
                                <div className="font-semibold text-slate-900">{items[0].desc}</div>
                                {items[0].qty != null && (
                                  <div className="text-xs text-slate-500">
                                    {items[0].qty} × {formatCurrency(items[0].rate)} = {formatCurrency(items[0].amount)}
                                  </div>
                                )}
                              </div>
                            );
                          }

                          // Multiple items - numbered list display
                          return (
                            <div className="w-full">
                              <div className="space-y-2">
                                {items.map((item, idx) => (
                                  <div key={idx} className="flex items-start gap-2">
                                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-300 text-slate-700 text-xs font-bold flex-shrink-0 text-center" style={{fontSize: '0.65rem'}}>
                                      {idx + 1}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                      <div className="text-sm font-medium text-slate-800">{item.desc}</div>
                                    </div>
                                  </div>
                                ))}
                                <div className="border-t border-slate-200 pt-2 mt-2">
                                  <div className="text-xs text-slate-600 font-semibold">
                                    Total: {formatCurrency(items.reduce((sum, item) => sum + item.amount, 0))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </td>
                      {isTableExpanded && (
                        <>
                          <td className="px-6 py-4 text-center text-slate-700 text-sm font-medium">{entry.mtr ? entry.mtr.toLocaleString() : '-'}</td>
                          <td className="px-6 py-4 text-center text-slate-700 text-sm font-medium">{entry.rate ? entry.rate.toLocaleString() : '-'}</td>
                        </>
                      )}
                      <td className="px-6 py-4 text-center text-slate-900 text-sm font-bold">{getShortRef(entry.billNo, entry.invoiceId, entry.isManualEntry)}</td>
                      
                      {/* Payment Status Column */}
                      <td className="px-6 py-4 text-center">
                        {/* For paid DEBIT entries: show only PAID badge */}
                        {entry.status === 'paid' && entry._displayDebit && entry._displayDebit > 0 ? (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-700 border border-amber-300">
                            PAID
                          </span>
                        ) : (
                          /* For all other entries: show status label */
                          <span className={`inline-flex items-center px-3 py-1.5 rounded text-xs font-medium ${paymentStatus.color}`}>
                            {paymentStatus.label}
                          </span>
                        )}
                      </td>
                      
                      <td className="px-6 py-4 text-center">
                        <span className={`inline-flex items-center px-3 py-1.5 rounded text-xs font-medium ${
                          (entry.payment_mode || entry.paymentMode) && (entry.payment_mode || entry.paymentMode) !== 'Pending' ? 'bg-green-100 text-green-700' : (entry.cash > 0 ? 'bg-slate-200 text-slate-700' : entry.online > 0 ? 'bg-slate-200 text-slate-700' : entry.cheque > 0 ? 'bg-slate-200 text-slate-700' : 'bg-slate-100 text-slate-600')
                        }`}>
                          {entry.payment_mode && entry.payment_mode !== 'Pending' ? (
                            `via ${entry.payment_mode}${entry.payment_mode === 'Cheque' && (entry.chequeNo || entry.cheque_no) ? ` (${entry.chequeNo || entry.cheque_no})` : ''}`
                          ) : entry.paymentMode && entry.paymentMode !== 'Pending' ? (
                            `via ${entry.paymentMode}${entry.paymentMode === 'Cheque' && (entry.chequeNo || entry.cheque_no) ? ` (${entry.chequeNo || entry.cheque_no})` : ''}`
                          ) : (
                            entry.cash > 0 ? 'via Cash' : entry.online > 0 ? 'via Online' : entry.cheque > 0 ? `via Cheque${entry.chequeNo ? ` (${entry.chequeNo})` : ''}` : '-'
                          )}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right font-semibold text-slate-900">
                        {entry._displayDebit !== null && entry._displayDebit > 0 ? formatCurrency(entry._displayDebit) : '-'}
                      </td>
                      <td className="px-6 py-4 text-right font-semibold text-slate-900">
                        {entry._displayCredit !== null && entry._displayCredit > 0 ? formatCurrency(entry._displayCredit) : '-'}
                      </td>
                      <td className="px-8 py-4 text-right font-bold text-slate-900 bg-slate-100 rounded-lg min-w-[140px]">{formatCurrency(entry.balance)}</td>
                      {isTableExpanded && (
                        <td className={`px-6 py-4 text-center font-semibold text-sm text-slate-700`}>
                          {entry.days ? `${entry.days}d` : '-'}
                        </td>
                      )}
                      
                      <td className="px-6 py-4">
                        {(() => {
                          const canPrimaryEdit = isPrimaryEditableRow(entry, ledgerData[activeTab] || []);
                          return (
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleEditEntry(entry)}
                            disabled={!canPrimaryEdit}
                            className={`px-3 py-1.5 rounded text-xs font-semibold transition-all ${
                              canPrimaryEdit
                                ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                            }`}
                            title={canPrimaryEdit ? 'Edit entry' : 'Edit from the main debit row'}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteEntry(entry)}
                            disabled={!canPrimaryEdit}
                            className={`px-3 py-1.5 rounded text-xs font-semibold transition-all ${
                              canPrimaryEdit
                                ? 'bg-red-100 text-red-700 hover:bg-red-200'
                                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                            }`}
                            title={canPrimaryEdit ? 'Delete entry' : 'Delete from the main debit row'}
                          >
                            Delete
                          </button>
                        </div>
                          );
                        })()}
                      </td>
                    </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan="14" className="px-6 py-16 text-center">
                      <svg className="w-16 h-16 mx-auto mb-4 opacity-30 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <p className="font-semibold text-slate-600 text-lg">No ledger entries found</p>
                      <p className="text-slate-500 text-sm mt-1">Try adjusting your filters or add new entries</p>
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot className="bg-gradient-to-r from-slate-800 to-slate-900 text-white border-t-2 border-slate-300">
                <tr className="font-bold">
                  <td colSpan="4" className="px-6 py-5 text-right text-sm uppercase tracking-wide">Totals:</td>
                  {isTableExpanded && <td colSpan="2"></td>}
                  <td colSpan="1"></td>
                  <td className="px-6 py-5 text-right text-lg">{formatCurrency(summary.totalDebit)}</td>
                  <td className="px-6 py-5 text-right text-lg">{formatCurrency(summary.totalCredit)}</td>
                  <td className="px-6 py-5 text-right text-lg">{formatCurrency(summary.netBalance)}</td>
                  {isTableExpanded && <td colSpan="1"></td>}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* === ADD ENTRY MODAL === */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[95vh] overflow-y-auto">
              {/* Header */}
              <div className="sticky top-0 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-8 py-6 flex items-center justify-between border-b border-slate-700">
                <div>
                  <h2 className="text-2xl font-bold text-white">{editingEntryId ? 'Edit Ledger Entry' : 'New Ledger Entry'}</h2>
                  <p className="text-slate-400 text-sm mt-1">{editingEntryId ? 'Update existing transaction' : 'Record a new transaction'}</p>
                </div>
                <button
                  onClick={() => { setShowAddModal(false); resetEntryForm(); }}
                  className="w-9 h-9 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-slate-300 hover:text-white transition-all"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Body */}
              <div className="p-8">
                {/* Entry Mode Selector */}
                <div className="mb-8">
                  <div className="flex items-center gap-3 mb-4">
                    <h3 className="text-base font-bold text-slate-900">Entry Mode</h3>
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Select how to record</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      onClick={() => {
                        if (editingEntryId) return;
                        setUseLineItems(false);
                        setLineItems([{ id: 1, description: '', quantity: 0, rate: 0, type: 'material', amount: 0 }]);
                      }}
                      className={`p-4 rounded-lg border-2 transition-all text-left ${
                        !useLineItems
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="font-bold text-slate-900">Single Entry</div>
                      <p className="text-xs text-slate-600 mt-1">Simple transaction record</p>
                    </button>
                    <button
                      onClick={() => {
                        if (editingEntryId) return;
                        setUseLineItems(true);
                        setLineItems([{ id: 1, description: '', quantity: 0, rate: 0, type: 'material', amount: 0 }]);
                      }}
                      className={`p-4 rounded-lg border-2 transition-all text-left ${
                        useLineItems
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="font-bold text-slate-900">Multiple Items</div>
                      <p className="text-xs text-slate-600 mt-1">Add multiple descriptions/rates</p>
                    </button>
                  </div>
                </div>

                {/* Basic Info Section */}
                <div className="bg-slate-50 rounded-lg p-6 mb-6 border border-slate-200">
                  <h3 className="text-sm font-bold text-slate-900 mb-4 uppercase tracking-wider">Transaction Details</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">Date</label>
                      <input
                        type="date"
                        value={newEntry.date}
                        onChange={(e) => setNewEntry({ ...newEntry, date: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all font-medium text-slate-900 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">Invoice Number</label>
                      <input
                        type="text"
                        placeholder="INV-1001 / REF-01"
                        value={newEntry.billNo}
                        onChange={(e) => {
                          if (editingEntryId) return;
                          setNewEntry({ ...newEntry, billNo: e.target.value });
                          lookupPendingEntry(e.target.value);
                        }}
                        disabled={!!editingEntryId}
                        className={`w-full px-4 py-2.5 rounded-lg border border-slate-300 transition-all font-medium ${
                          editingEntryId
                            ? 'bg-slate-100 text-slate-500 cursor-not-allowed'
                            : 'focus:border-blue-500 focus:ring-2 focus:ring-blue-100 text-slate-900 bg-white placeholder-slate-400'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">Payment Deadline</label>
                      <input
                        type="date"
                        value={newEntry.dueDate || ''}
                        onChange={(e) => setNewEntry({ ...newEntry, dueDate: e.target.value })}
                        disabled={!!editingEntryId}
                        className={`w-full px-4 py-2.5 rounded-lg border border-slate-300 transition-all font-medium ${
                          editingEntryId
                            ? 'bg-slate-100 text-slate-500 cursor-not-allowed'
                            : 'focus:border-blue-500 focus:ring-2 focus:ring-blue-100 text-slate-900 bg-white'
                        }`}
                      />
                    </div>
                  </div>
                  {/* Pending Invoice Match Banner */}
                  {pendingMatchEntry && (
                    <div className="mt-4 p-4 bg-amber-50 border border-amber-300 rounded-lg">
                      <div className="flex items-start gap-3">
                        <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div className="flex-1">
                          <p className="font-semibold text-amber-800 text-sm">Pending Invoice Found</p>
                          <p className="text-amber-700 text-xs mt-1">
                            Bill # <strong>{pendingMatchEntry.billNo || pendingMatchEntry.bill_no}</strong> &mdash; Amount: <strong>{formatCurrency(parseFloat(pendingMatchEntry.debit) || parseFloat(pendingMatchEntry.debit_amount) || 0)}</strong> &mdash; Date: {formatDate(pendingMatchEntry.date)}
                          </p>
                          <p className="text-amber-600 text-xs mt-0.5">{pendingMatchEntry.particulars || pendingMatchEntry.description || 'Pending Invoice'}</p>
                          <p className="text-amber-700 text-xs mt-2 font-medium">
                            ✨ Use the <strong>"Mark as Paid"</strong> button below to settle this invoice. A credit entry will be created automatically.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Mode-Specific Content */}
                {useLineItems ? (
                  // Multiple Items Section
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Line Items</h3>
                      </div>
                      <button
                        onClick={addLineItem}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-all flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add Item
                      </button>
                    </div>

                    {/* Description box - only visible in multi-item mode */}
                    <div className="mb-4 bg-slate-50 p-4 rounded-lg border border-slate-200">
                      <label className="block text-sm font-semibold text-slate-700 mb-2">
                        Description <span className="font-normal text-slate-400 text-xs">(optional — auto-filled from items in multi-item mode)</span>
                      </label>
                      <input
                        type="text"
                        placeholder="e.g., Cotton Fabric Purchase, Monthly Services..."
                        value={newEntry.description}
                        onChange={(e) => setNewEntry({ ...newEntry, description: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all font-medium text-slate-900 bg-white placeholder-slate-400"
                      />
                    </div>

                    <div className="space-y-3 max-h-[65vh] overflow-y-auto">
                      {lineItems.map((item, idx) => (
                        <div key={item.id} className="bg-white border border-slate-200 rounded-lg p-4 hover:border-slate-300 transition-all">
                          {/* Description field - full width */}
                          <div className="mb-3">
                            <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase">Description / Reference</label>
                            <textarea
                              placeholder="e.g., Invoice INV-001, Reference details, Material description, etc."
                              value={item.description}
                              onChange={(e) => updateLineItem(item.id, 'description', e.target.value)}
                              rows="2"
                              className="w-full px-3 py-2 border border-slate-300 rounded bg-white text-slate-900 text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all resize-none"
                            />
                          </div>
                          
                          {/* Input fields in grid */}
                          <div className="grid grid-cols-1 md:grid-cols-6 gap-3 mb-3">
                            <div>
                              <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase">Qty</label>
                              <input
                                type="number"
                                placeholder="0"
                                value={item.quantity}
                                onChange={(e) => updateLineItem(item.id, 'quantity', e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded bg-white text-slate-900 text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase">Rate</label>
                              <input
                                type="number"
                                placeholder="0"
                                value={item.rate}
                                onChange={(e) => updateLineItem(item.id, 'rate', e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded bg-white text-slate-900 text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase">Tax %</label>
                              <input
                                type="number"
                                placeholder="0"
                                value={item.taxRate || 0}
                                onChange={(e) => updateLineItem(item.id, 'taxRate', e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded bg-white text-slate-900 text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase">Amount</label>
                              <div className="px-3 py-2 bg-slate-100 rounded text-sm font-bold text-slate-900 border border-slate-300">
                                {formatCurrency(item.amount)}
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase">Total + Tax</label>
                              <div className="px-3 py-2 bg-blue-100 rounded text-sm font-bold text-blue-900 border border-blue-300">
                                {formatCurrency(item.amount * (1 + (item.taxRate || 0) / 100))}
                              </div>
                            </div>
                            <div className="flex flex-col">
                              <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase">Action</label>
                              <div className="flex items-center gap-2 h-full">
                                {lineItems.length > 1 && (
                                  <button
                                    onClick={() => removeLineItem(item.id)}
                                    className="px-3 py-2 bg-red-100 hover:bg-red-200 text-red-600 rounded transition-all font-semibold text-sm w-full"
                                    title="Remove"
                                  >
                                    <svg className="w-4 h-4 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Summary Box */}
                    <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg p-4 mt-4 text-white">
                      <div className="grid grid-cols-4 gap-4">
                        <div>
                          <p className="text-xs font-semibold opacity-90">Items</p>
                          <p className="text-2xl font-bold">{lineItems.length}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold opacity-90">Subtotal</p>
                          <p className="text-2xl font-bold">{formatCurrency(getLineItemsTotal())}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold opacity-90">Tax</p>
                          <p className="text-2xl font-bold">{formatCurrency(lineItems.reduce((s, item) => { const amt = item.amount || ((Number(item.quantity)||0)*(Number(item.rate)||0)); return s + amt*(Number(item.taxRate)||0)/100; }, 0))}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold opacity-90">Total (incl. Tax)</p>
                          <p className="text-2xl font-bold">{formatCurrency(getLineItemsTotal() + lineItems.reduce((s, item) => { const amt = item.amount || ((Number(item.quantity)||0)*(Number(item.rate)||0)); return s + amt*(Number(item.taxRate)||0)/100; }, 0))}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  // Single Entry Section
                  <div className="bg-slate-50 rounded-lg p-6 mb-6 border border-slate-200">
                    <h3 className="text-sm font-bold text-slate-900 mb-4 uppercase tracking-wider">Material Details</h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Description</label>
                        <textarea
                          placeholder="e.g., Cotton Fabric"
                          value={newEntry.description}
                          onChange={(e) => setNewEntry({ ...newEntry, description: e.target.value })}
                          rows="2"
                          className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all font-medium text-slate-900 bg-white placeholder-slate-400 resize-none"
                        />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                        <div className="md:col-span-1">
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase">Invoice Number</label>
                          <input
                            type="text"
                            placeholder="INV-1001"
                            value={newEntry.billNo}
                            onChange={(e) => {
                              if (editingEntryId) return;
                              setNewEntry({ ...newEntry, billNo: e.target.value });
                              lookupPendingEntry(e.target.value);
                            }}
                            disabled={!!editingEntryId}
                            className={`w-full px-3 py-2 border border-slate-300 rounded text-sm font-medium transition-all ${
                              editingEntryId
                                ? 'bg-slate-100 text-slate-500 cursor-not-allowed'
                                : 'bg-white text-slate-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-100'
                            }`}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase">Qty</label>
                          <input
                            type="number"
                            placeholder="0"
                            value={newEntry.mtr}
                            onChange={(e) => setNewEntry({ ...newEntry, mtr: e.target.value })}
                            className="w-full px-3 py-2 border border-slate-300 rounded bg-white text-slate-900 text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase">Rate</label>
                          <input
                            type="number"
                            placeholder="0"
                            value={newEntry.rate}
                            onChange={(e) => setNewEntry({ ...newEntry, rate: e.target.value })}
                            className="w-full px-3 py-2 border border-slate-300 rounded bg-white text-slate-900 text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase">Tax %</label>
                          <input
                            type="number"
                            placeholder="0"
                            value={newEntry.salesTaxRate}
                            onChange={(e) => setNewEntry({ ...newEntry, salesTaxRate: e.target.value })}
                            className="w-full px-3 py-2 border border-slate-300 rounded bg-white text-slate-900 text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase">Amount</label>
                          <div className="px-3 py-2 bg-slate-100 rounded text-sm font-bold text-slate-900 border border-slate-300">
                            {formatCurrency((Number(newEntry.mtr) || 0) * (Number(newEntry.rate) || 0))}
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase">Total + Tax</label>
                          <div className="px-3 py-2 bg-blue-100 rounded text-sm font-bold text-blue-900 border border-blue-300">
                            {formatCurrency(((Number(newEntry.mtr) || 0) * (Number(newEntry.rate) || 0)) * (1 + (Number(newEntry.salesTaxRate) || 0) / 100))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Transaction Type Section */}
                <div className="bg-slate-50 rounded-lg p-6 mb-6 border border-slate-200">
                  <h3 className="text-sm font-bold text-slate-900 mb-4 uppercase tracking-wider">Transaction Type</h3>
                  {editingEntryId && (
                    <p className="text-xs text-slate-500 mb-3">Locked in edit mode. You can only change Date and Material Details.</p>
                  )}
                  <div className="space-y-3">
                    <label className="flex items-center cursor-pointer p-3 rounded-lg hover:bg-white transition-all border-2 border-transparent hover:border-red-200" 
                      onClick={() => { if (!editingEntryId) setNewEntry({ ...newEntry, entryType: 'debit' }); }}>
                      <input
                        type="checkbox"
                        checked={newEntry.entryType === 'debit'}
                        onChange={() => { if (!editingEntryId) setNewEntry({ ...newEntry, entryType: 'debit' }); }}
                        disabled={!!editingEntryId}
                        className="w-5 h-5 rounded border-slate-300 text-red-600 cursor-pointer"
                      />
                      <div className="ml-3">
                        <div className="font-bold text-slate-900 text-lg">📥 Debit</div>
                        <p className="text-xs text-slate-600">Amount In / Invoice - Customer owes us</p>
                      </div>
                    </label>
                    <label className="flex items-center cursor-pointer p-3 rounded-lg hover:bg-white transition-all border-2 border-transparent hover:border-green-200" 
                      onClick={() => { if (!editingEntryId) setNewEntry({ ...newEntry, entryType: 'credit' }); }}>
                      <input
                        type="checkbox"
                        checked={newEntry.entryType === 'credit'}
                        onChange={() => { if (!editingEntryId) setNewEntry({ ...newEntry, entryType: 'credit' }); }}
                        disabled={!!editingEntryId}
                        className="w-5 h-5 rounded border-slate-300 text-green-600 cursor-pointer"
                      />
                      <div className="ml-3">
                        <div className="font-bold text-slate-900 text-lg">📤 Credit</div>
                        <p className="text-xs text-slate-600">Amount Out / Payment - We owe customer</p>
                      </div>
                    </label>
                  </div>

                  {/* Payment Status — only for Debit entries */}
                  {newEntry.entryType === 'debit' && (
                    <div className="mt-4 pt-4 border-t border-slate-200">
                      <p className="text-xs font-bold text-slate-700 mb-3 uppercase tracking-wider">Payment Status</p>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="isPaid"
                            checked={newEntry.isPaid !== false}
                            onChange={() => { if (!editingEntryId) setNewEntry({ ...newEntry, isPaid: true }); }}
                            disabled={!!editingEntryId}
                            className="w-4 h-4 text-green-600"
                          />
                          <span className="text-sm font-semibold text-green-700">💰 Paid — creates invoice + payment</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="isPaid"
                            checked={newEntry.isPaid === false}
                            onChange={() => { if (!editingEntryId) setNewEntry({ ...newEntry, isPaid: false }); }}
                            disabled={!!editingEntryId}
                            className="w-4 h-4 text-amber-600"
                          />
                          <span className="text-sm font-semibold text-amber-700">📋 Pending — invoice only (unpaid)</span>
                        </label>
                      </div>
                    </div>
                  )}
                </div>

                {/* Payment Section */}
                <div className="bg-slate-50 rounded-lg p-6 border border-slate-200">
                  <h3 className="text-sm font-bold text-slate-900 mb-4 uppercase tracking-wider">Payment Details</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">Payment Mode</label>
                      <select
                        value={newEntry.paymentMode || 'Cash'}
                        onChange={(e) => {
                          if (editingEntryId) return;
                          const mode = e.target.value;
                          setNewEntry({ 
                            ...newEntry, 
                            paymentMode: mode,
                            chequeNo: (mode === 'Cheque' || mode === 'Online') ? newEntry.chequeNo : ''
                          });
                        }}
                        disabled={!!editingEntryId}
                        className={`w-full px-4 py-2.5 rounded-lg border-2 border-slate-300 transition-all font-medium ${
                          editingEntryId ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : 'focus:border-blue-500 focus:ring-2 focus:ring-blue-100 text-slate-900 bg-white'
                        }`}
                      >
                        <option value="Cash">💵 Cash - Direct Payment</option>
                        <option value="Online">🌐 Online - Bank Transfer</option>
                        <option value="Cheque">✓ Cheque - Cheque Payment</option>
                      </select>
                    </div>
                    {(newEntry.paymentMode === 'Cheque' || newEntry.paymentMode === 'Online') && (
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">
                          {newEntry.paymentMode === 'Online' ? 'Transaction ID' : 'Cheque Number'} (Last 5 Digits)
                        </label>
                        <input
                          type="text"
                          placeholder="e.g., 12345"
                          value={newEntry.chequeNo || ''}
                          onChange={(e) => {
                            if (editingEntryId) return;
                            const value = e.target.value.replace(/\D/g, '').slice(0, 5);
                            setNewEntry({ ...newEntry, chequeNo: value });
                          }}
                          maxLength="5"
                          disabled={!!editingEntryId}
                          className={`w-full px-4 py-2.5 rounded-lg border-2 border-slate-300 transition-all font-medium ${
                            editingEntryId ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : 'focus:border-blue-500 focus:ring-2 focus:ring-blue-100 text-slate-900 bg-white placeholder-slate-400'
                          }`}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="sticky bottom-0 bg-slate-50 border-t border-slate-200 px-8 py-4 flex justify-end gap-3">
                <button
                  onClick={() => { setShowAddModal(false); resetEntryForm(); }}
                  className="px-6 py-2.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-900 font-semibold transition-all"
                >
                  Cancel
                </button>
                {!editingEntryId && pendingMatchEntry && (
                  <button
                    onClick={() => openEditInAddForm(pendingMatchEntry)}
                    className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white font-semibold transition-all shadow-md hover:shadow-lg flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Edit Matched Entry
                  </button>
                )}
                {!editingEntryId && pendingMatchEntry && (
                  <button
                    onClick={handleMarkAsPaid}
                    className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-semibold transition-all shadow-md hover:shadow-lg flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Mark as Paid
                  </button>
                )}
                <button
                  onClick={editingEntryId ? handleUpdateEntry : handleAddEntry}
                  className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold transition-all shadow-md hover:shadow-lg flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                  </svg>
                  {editingEntryId ? 'Save Changes' : 'Add Entry'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* === SETTINGS MODAL === */}
        {/* Financial Year Manager modal disabled until FY feature is active
        {showFinancialYearManager && activeTab && (
          <FinancialYearManager
            customerId={activeTab}
            onClose={() => setShowFinancialYearManager(false)}
          />
        )}
        */}
      </div>
    </div>
  );
};

export default GeneralLedger;