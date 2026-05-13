/* Index.js File  */

// --- Required Modules ---
const express = require("express");
const cors = require("cors");
const path = require("path");
const mysql = require("mysql2");
const bodyParser = require("body-parser");

// --- Initialize Express App ---
const app = express();
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());

// Lightweight logger wrapper. Toggle verbose debug output with DEV_VERBOSE=true
const DEV_VERBOSE =
  process.env.DEV_VERBOSE === "true" || process.env.NODE_ENV !== "production";
const logger = {
  debug: (...args) => {
    if (DEV_VERBOSE) console.debug("[DEBUG]", ...args);
  },
  info: (...args) => {
    console.log("[INFO]", ...args);
  },
  warn: (...args) => {
    console.warn("[WARN]", ...args);
  },
  error: (...args) => {
    console.error("[ERROR]", ...args);
  },
};

// Test endpoint
app.get("/test", (req, res) => {
  res.json({ success: true, message: "Server is working!" });
});

// --- MySQL Database Connection Pool ---
// Using connection pool instead of single connection to handle multiple concurrent requests
const db = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "arauf_crm_main",
});

// Test database connection
logger.info("MySQL Connection Pool initialized");

// Initialize database tables and default user
db.getConnection((err, connection) => {
  if (err) {
    if (err.code === "PROTOCOL_CONNECTION_LOST") {
      logger.error("Database connection was closed.");
    }
    if (err.code === "ER_CON_COUNT_ERROR") {
      logger.error("Database has too many connections.");
    }
    if (err.code === "ER_AUTHENTICATION_PLUGIN_ERROR") {
      logger.error("Database authentication failed.");
    }
    return;
  }

  if (connection) {
    connection.release();
    logger.info("Connected to MySQL database");

    // Create users table if it doesn't exist (simple structure)
    const createUsersTable = `
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      firstName TEXT NOT NULL,
      lastName TEXT NOT NULL,
      email TEXT NOT NULL,
      password TEXT NOT NULL
    )
  `;

    db.query(createUsersTable, (err) => {
      if (err) {
        logger.error("Error creating users table:", err);
      } else {
        logger.info("Users table ready");

        // Insert default user if not exists
        const checkUser = "SELECT * FROM users WHERE email = ?";
        db.query(checkUser, ["digious.Sol@gmail.com"], (err, results) => {
          if (err) {
            logger.error("Error checking user:", err);
          } else if (results.length === 0) {
            const insertUser = `
            INSERT INTO users (firstName, lastName, email, password) 
            VALUES (?, ?, ?, ?)
          `;
            const userValues = [
              "Muhammad",
              "Ahmed",
              "digious.Sol@gmail.com",
              "Pakistan@123",
            ];

            db.query(insertUser, userValues, (err, result) => {
              if (err) {
                logger.error("Error creating default user:", err);
              } else {
                logger.info("Default user created with ID:", result.insertId);
              }
            });
          } else {
            logger.info("Default user already exists");
          }
        });
      }
    });
  }
});

// Create stock table if it doesn't exist
const createStockTable = `
  CREATE TABLE IF NOT EXISTS stock (
    id INT AUTO_INCREMENT PRIMARY KEY,
    item_name VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    quantity DECIMAL(10, 2) NOT NULL,
    unit VARCHAR(50) DEFAULT 'KG',
    price_per_unit DECIMAL(10, 2) DEFAULT 0,
    supplier_name VARCHAR(255),
    supplier_email VARCHAR(255),
    supplier_phone VARCHAR(20),
    purchase_date DATE,
    expiry_date DATE,
    location VARCHAR(255),
    description TEXT,
    status ENUM('Active', 'Inactive', 'Low Stock', 'Discontinued') DEFAULT 'Active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_category (category),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
  )
`;

db.query(createStockTable, (err) => {
  if (err) {
    logger.error("Error creating stock table:", err);
  } else {
    logger.info("Stock table ready");
  }
});

// --- Dashboard Routes ---
const dashboardRoutes = require("./routes/dashboard");
app.use("/api/dashboard", dashboardRoutes);

// --- Ledger Routes ---
const ledgerRoutes = require("./routes/ledger")(db);
app.use("/api/ledger", ledgerRoutes);

// --- Ledger Data Routes (for General Ledger component) ---
const ledgerDataRoutes = require("./routes/ledgerData");
app.use("/api/ledger-data", ledgerDataRoutes);

// --- Ledger Entries Routes (for saving/managing ledger entries) ---
const ledgerEntriesRoutes = require("./routes/ledgerEntries");
app.use("/api/ledger-entries", ledgerEntriesRoutes);

// --- Financial Years Routes (for managing financial year periods) ---
const financialYearsRoutes = require("./routes/financialYears");
app.use("/api/financial-years", financialYearsRoutes);

// --- Financial Reports Routes ---
const financialReportsRoutes = require("./routes/financialReports");
app.use("/api/financial-reports", financialReportsRoutes);

// --- Financial Reports Persistence Routes ---
const financialReportsPersistenceRoutes = require("./routes/financialReportsPersistence");
app.use("/api/financial-reports-storage", financialReportsPersistenceRoutes);

// --- Profile Picture Routes ---
const profilePictureRoutes = require("./routes/profile-picture")(db);
app.use("/api/profile-picture", profilePictureRoutes);

// --- Stock Management Routes ---
const stockRoutes = require("./routes/stock")(db);
app.use("/api/stock", stockRoutes);

// --- User Management Routes ---
const usersRoutes = require("./routes/users")(db);
app.use("/api/users", usersRoutes);

// --- Role Management Routes ---
const rolesRoutes = require("./routes/roles")(db);
app.use("/api/roles", rolesRoutes);

// =============================================================================
// AUTOMATIC LEDGER ENTRY HELPER FUNCTIONS
// =============================================================================

/**
 * Creates automatic ledger entries for invoices and payments
 * @param {Object} params - Entry parameters
 * @param {number} params.customer_id - Customer ID
 * @param {string} params.entry_date - Entry date (YYYY-MM-DD)
 * @param {string} params.description - Entry description
 * @param {string} params.bill_no - Bill/Invoice number
 * @param {string} params.payment_mode - Payment mode (Cash, Cheque, Online, etc.)
 * @param {string|null} params.cheque_no - Cheque/Transaction number
 * @param {number} params.debit_amount - Debit amount (for receivables - unpaid invoices)
 * @param {number} params.credit_amount - Credit amount (for payables or payments received)
 * @param {string} params.status - Entry status (paid, unpaid, draft)
 * @param {string|null} params.due_date - Due date for unpaid invoices
 * @param {number} params.sales_tax_rate - Tax rate percentage
 * @param {number} params.sales_tax_amount - Tax amount
 * @param {string} params.entry_type - Entry type ('invoice', 'po_invoice', 'payment')
 * @param {number|null} params.invoice_id - Related invoice ID (for reference)
 * @param {function} callback - Callback function (err, result)
 */
async function createAutoLedgerEntry(params) {
  try {
    const {
      customer_id,
      entry_date,
      description,
      bill_no,
      payment_mode = "Cash",
      cheque_no = null,
      debit_amount = 0,
      credit_amount = 0,
      status = "unpaid",
      due_date = null,
      sales_tax_rate = 0,
      sales_tax_amount = 0,
      entry_type = "invoice",
      invoice_id = null,
    } = params;

    // Calculate balance (positive = receivable/debit, negative = payable/credit)
    const balance = debit_amount - credit_amount;

    // Get current max sequence for this customer to append new entry
    const getMaxSequenceQuery = `
      SELECT COALESCE(MAX(sequence), 0) as max_seq 
      FROM ledger_entries 
      WHERE customer_id = ?
    `;

    const [seqResults] = await db
      .promise()
      .query(getMaxSequenceQuery, [customer_id]);
    const nextSequence = (seqResults[0]?.max_seq || 0) + 1;

    const insertQuery = `
      INSERT INTO ledger_entries (
        customer_id, entry_date, description, bill_no, entry_type, payment_mode, cheque_no,
        debit_amount, credit_amount, balance, status, due_date,
        sales_tax_rate, sales_tax_amount, sequence, has_multiple_items
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      customer_id,
      entry_date,
      description,
      bill_no,
      entry_type,
      payment_mode,
      cheque_no,
      debit_amount,
      credit_amount,
      balance,
      status,
      due_date,
      sales_tax_rate,
      sales_tax_amount,
      nextSequence,
      0, // has_multiple_items - can be extended later
    ];

    const [result] = await db.promise().query(insertQuery, values);
    logger.info(
      `✅ Auto ledger entry created: ${bill_no} | Type: ${entry_type} | Debit: ${debit_amount} | Credit: ${credit_amount}`,
    );
    return result;
  } catch (err) {
    logger.error("Error creating automatic ledger entry:", err);
    throw err;
  }
}

/**
 * Creates ledger entries for a new invoice (DEBIT - Receivable)
 * This records the unpaid invoice as a debit (amount owed to us by customer)
 * Creates separate entries for: 1) Material/Item amount, 2) Tax amount
 */
async function createLedgerEntriesForInvoice(invoiceData) {
  try {
    const {
      customer_id,
      invoice_number,
      bill_date,
      payment_deadline,
      total_amount,
      subtotal,
      tax_rate = 0,
      tax_amount = 0,
      status = "Pending",
      currency = "PKR",
      items = [],
    } = invoiceData;

    if (!customer_id) {
      logger.warn("⚠️ No customer_id provided for Invoice ledger entry");
      throw new Error("customer_id required for ledger entry");
    }

    const material_amount = subtotal || total_amount - tax_amount;
    const isPaid = status && status.toLowerCase() === "paid";

    // Get the item description for better clarity
    let description = "Invoice";
    if (items && items.length > 0) {
      description = items[0].description || "Invoice";
    }

    // Entry 1: Material/Item amount (DEBIT - customer owes us)
    await createAutoLedgerEntry({
      customer_id,
      entry_date: bill_date,
      description: description,
      bill_no: invoice_number,
      payment_mode: "Pending",
      cheque_no: null,
      debit_amount: material_amount,
      credit_amount: 0,
      status: isPaid ? "paid" : "unpaid",
      due_date: payment_deadline,
      sales_tax_rate: tax_rate,
      sales_tax_amount: 0,
      entry_type: "invoice",
    });

    // Entry 2: Tax amount (DEBIT - if tax exists)
    if (tax_amount > 0) {
      await createAutoLedgerEntry({
        customer_id,
        entry_date: bill_date,
        description: `Sales Tax @ ${tax_rate}%`,
        bill_no: `TAX-${invoice_number}`,
        payment_mode: "Pending",
        cheque_no: null,
        debit_amount: tax_amount,
        credit_amount: 0,
        status: isPaid ? "paid" : "unpaid",
        due_date: payment_deadline,
        sales_tax_rate: 0,
        sales_tax_amount: tax_amount,
        entry_type: "invoice_tax",
      });
      logger.info(
        `📊 Ledger DEBIT entries created for Invoice: ${invoice_number} (Material + Tax)`,
      );
    } else {
      logger.info(
        `📊 Ledger DEBIT entry created for Invoice: ${invoice_number} (Material only)`,
      );
    }

    // If invoice is directly marked as Paid at creation, also create CREDIT (payment) entries
    // so that the balance zeroes out (Debit - Credit = 0)
    if (isPaid) {
      logger.info(
        `💰 Invoice ${invoice_number} created directly as Paid — creating CREDIT entries to zero balance`,
      );

      // Credit Entry 1: Payment for material amount
      await createAutoLedgerEntry({
        customer_id,
        entry_date: bill_date,
        description: `Payment Received`,
        bill_no: invoice_number,
        payment_mode: "Cash",
        cheque_no: null,
        debit_amount: 0,
        credit_amount: material_amount,
        status: "paid",
        due_date: null,
        sales_tax_rate: tax_rate,
        sales_tax_amount: 0,
        entry_type: "payment",
      });

      // Credit Entry 2: Payment for tax amount (if tax exists)
      if (tax_amount > 0) {
        await createAutoLedgerEntry({
          customer_id,
          entry_date: bill_date,
          description: `Tax Payment @ ${tax_rate}%`,
          bill_no: `TAX-${invoice_number}`,
          payment_mode: "Cash",
          cheque_no: null,
          debit_amount: 0,
          credit_amount: tax_amount,
          status: "paid",
          due_date: null,
          sales_tax_rate: 0,
          sales_tax_amount: tax_amount,
          entry_type: "payment_tax",
        });
        logger.info(
          `💰 CREDIT payment entries created for Invoice: ${invoice_number} (Material + Tax) — balance zeroed`,
        );
      } else {
        logger.info(
          `💰 CREDIT payment entry created for Invoice: ${invoice_number} (Material only) — balance zeroed`,
        );
      }
    }

    return { success: true };
  } catch (err) {
    logger.error("Failed to create ledger entries for invoice:", err);
    throw err;
  }
}

/**
 * Creates ledger entries for a new PO Invoice (CREDIT - Payable)
 * This records the unpaid PO invoice as a credit (amount we owe to supplier)
 * Following same double-entry approach as regular invoices (separate entries for material and tax)
 */
async function createLedgerEntriesForPOInvoice(poInvoiceData) {
  try {
    const {
      customer_id,
      invoice_number,
      invoice_date,
      due_date,
      total_amount,
      tax_rate = 0,
      tax_amount = 0,
      status = "Draft",
      currency = "PKR",
      customer_name,
    } = poInvoiceData;

    if (!customer_id) {
      logger.warn("⚠️ No customer_id provided for PO Invoice ledger entry");
      throw new Error("customer_id required for ledger entry");
    }

    const material_amount = total_amount - tax_amount;

    // Entry 1: Material/Item amount (DEBIT - we owe supplier)
    await createAutoLedgerEntry({
      customer_id,
      entry_date: invoice_date,
      description: `PO Invoice - ${customer_name}`,
      bill_no: invoice_number,
      payment_mode: "Pending",
      cheque_no: null,
      debit_amount: material_amount,
      credit_amount: 0,
      status: status === "Paid" ? "paid" : "unpaid",
      due_date: due_date,
      sales_tax_rate: tax_rate,
      sales_tax_amount: 0,
      entry_type: "po_invoice",
    });

    // Entry 2: Tax amount (DEBIT - if tax exists)
    if (tax_amount > 0) {
      await createAutoLedgerEntry({
        customer_id,
        entry_date: invoice_date,
        description: `Sales Tax @ ${tax_rate}%`,
        bill_no: `TAX-${invoice_number}`,
        payment_mode: "Pending",
        cheque_no: null,
        debit_amount: tax_amount,
        credit_amount: 0,
        status: status === "Paid" ? "paid" : "unpaid",
        due_date: due_date,
        sales_tax_rate: 0,
        sales_tax_amount: tax_amount,
        entry_type: "po_invoice_tax",
      });
      logger.info(
        `📊 Ledger entries created for PO Invoice: ${invoice_number} (Material + Tax)`,
      );
    } else {
      logger.info(
        `📊 Ledger entry created for PO Invoice: ${invoice_number} (Material only)`,
      );
    }

    // If PO invoice is directly marked as Paid at creation, also create CREDIT (payment) entries
    // so that the balance zeroes out (Debit - Credit = 0)
    if (status === "Paid") {
      logger.info(
        `💰 PO Invoice ${invoice_number} created directly as Paid — creating CREDIT entries to zero balance`,
      );

      // Credit Entry 1: Payment for material amount
      await createAutoLedgerEntry({
        customer_id,
        entry_date: invoice_date,
        description: `Payment - ${invoice_number}`,
        bill_no: invoice_number,
        payment_mode: "Cash",
        cheque_no: null,
        debit_amount: 0,
        credit_amount: material_amount,
        status: "paid",
        due_date: null,
        sales_tax_rate: tax_rate,
        sales_tax_amount: 0,
        entry_type: "payment",
      });

      // Credit Entry 2: Payment for tax amount (if tax exists)
      if (tax_amount > 0) {
        await createAutoLedgerEntry({
          customer_id,
          entry_date: invoice_date,
          description: `Tax Payment @ ${tax_rate}%`,
          bill_no: `TAX-${invoice_number}`,
          payment_mode: "Cash",
          cheque_no: null,
          debit_amount: 0,
          credit_amount: tax_amount,
          status: "paid",
          due_date: null,
          sales_tax_rate: 0,
          sales_tax_amount: tax_amount,
          entry_type: "payment_tax",
        });
      }
      logger.info(
        `💰 CREDIT entries created for PO Invoice: ${invoice_number} — balance zeroed`,
      );
    }

    return { success: true };
  } catch (err) {
    logger.error("Failed to create ledger entries for PO invoice:", err);
    throw err;
  }
}

/**
 * Helper function to handle invoice payment ledger entries (avoids duplication)
 */
function handleInvoicePaymentIfNeeded(invoiceId, status) {
  if (status === "Paid") {
    // Get customer_id from the invoice
    const getInvoiceQuery =
      "SELECT customer_id, invoice_number, total_amount, subtotal, tax_amount, tax_rate FROM invoice WHERE id = ? LIMIT 1";
    db.query(getInvoiceQuery, [invoiceId], (invErr, invResults) => {
      if (!invErr && invResults && invResults.length > 0) {
        const invoiceData = invResults[0];

        createLedgerEntryForPayment(
          {
            customer_id: invoiceData.customer_id,
            payment_date: new Date().toISOString().split("T")[0],
            description: `Payment Received`,
            reference_no: invoiceData.invoice_number,
            payment_mode: "Cash", // Could be passed in request
            transaction_id: null,
            amount: invoiceData.total_amount,
            subtotal: invoiceData.subtotal,
            tax_amount: invoiceData.tax_amount,
            tax_rate: invoiceData.tax_rate,
            invoice_type: "invoice",
            invoice_number: invoiceData.invoice_number,
          },
          (ledgerErr) => {
            if (ledgerErr) {
              logger.error(
                "Failed to create payment ledger entry for invoice:",
                ledgerErr,
              );
            }
          },
        );
      }
    });
  }
}

/**
 * Creates ledger entry for a payment (async version)
 * For invoices: Creates CREDIT entries for payment received
 * For PO invoices: Creates DEBIT entries (payment) + CREDIT counterpart entries
 */
async function createLedgerEntryForPayment(paymentData) {
  try {
    const {
      customer_id,
      payment_date,
      description,
      reference_no,
      payment_mode,
      transaction_id,
      amount,
      subtotal,
      tax_amount,
      tax_rate,
      invoice_type = "invoice",
      invoice_number,
    } = paymentData;

    if (!customer_id || !amount) {
      throw new Error("customer_id and amount required for payment entry");
    }

    const isReceivable = invoice_type === "invoice";
    const material_amount = subtotal || amount - (tax_amount || 0);
    const tax_amt = tax_amount || 0;

    if (isReceivable) {
      // Check if CREDIT (payment) entries already exist for this invoice
      // (happens when invoice was created directly as Paid)
      const [existingPayments] = await db
        .promise()
        .query(
          `SELECT COUNT(*) as cnt FROM ledger_entries WHERE customer_id = ? AND bill_no = ? AND credit_amount > 0 AND entry_type IN ('payment', 'payment_tax')`,
          [customer_id, invoice_number],
        );
      if (existingPayments[0]?.cnt > 0) {
        logger.info(
          `⏭️ Payment entries already exist for ${invoice_number} — skipping duplicate creation`,
        );
        return { success: true };
      }

      // For INVOICES: Update original DEBIT entries to paid, then create CREDIT payment entries
      const updateQuery = `UPDATE ledger_entries SET status = 'paid' WHERE customer_id = ? AND (bill_no = ? OR bill_no = ?) AND debit_amount > 0 AND status = 'unpaid'`;
      await db
        .promise()
        .query(updateQuery, [
          customer_id,
          invoice_number,
          `TAX-${invoice_number}`,
        ]);
      logger.info(
        `✅ Updated original debit entries to 'paid' for ${invoice_number}`,
      );

      await createAutoLedgerEntry({
        customer_id,
        entry_date: payment_date,
        description: description || `Payment Received`,
        bill_no: invoice_number,
        payment_mode: payment_mode || "Cash",
        cheque_no: transaction_id,
        debit_amount: 0,
        credit_amount: material_amount,
        status: "paid",
        due_date: null,
        sales_tax_rate: tax_rate || 0,
        sales_tax_amount: 0,
        entry_type: "payment",
      });

      if (tax_amt > 0) {
        await createAutoLedgerEntry({
          customer_id,
          entry_date: payment_date,
          description: `Tax Payment @ ${tax_rate || 0}%`,
          bill_no: `TAX-${invoice_number}`,
          payment_mode: payment_mode || "Cash",
          cheque_no: transaction_id,
          debit_amount: 0,
          credit_amount: tax_amt,
          status: "paid",
          due_date: null,
          sales_tax_rate: 0,
          sales_tax_amount: tax_amt,
          entry_type: "payment_tax",
        });
        logger.info(
          `💰 Payment entries created (Material + Tax): ${invoice_number}`,
        );
      } else {
        logger.info(
          `💰 Payment entry created (Material only): ${invoice_number}`,
        );
      }
    } else {
      // For PO INVOICES: Create CREDIT counterpart entries (payment source),
      // then update original DEBIT entries to paid. Do NOT create new DEBIT payment entries
      // to avoid duplication. (Original DEBIT entries represent the payable.)

      // Step 2: Create CREDIT counterpart entries (payment source) - SECOND
      await createAutoLedgerEntry({
        customer_id,
        entry_date: payment_date,
        description: `Payment - ${invoice_number}`,
        bill_no: invoice_number,
        payment_mode: payment_mode || "Cash",
        cheque_no: transaction_id,
        debit_amount: 0,
        credit_amount: material_amount,
        status: "paid",
        due_date: null,
        sales_tax_rate: tax_rate || 0,
        sales_tax_amount: 0,
      });

      if (tax_amt > 0) {
        await createAutoLedgerEntry({
          customer_id,
          entry_date: payment_date,
          description: `Tax Payment @ ${tax_rate || 0}%`,
          bill_no: `TAX-${invoice_number}`,
          payment_mode: payment_mode || "Cash",
          cheque_no: transaction_id,
          debit_amount: 0,
          credit_amount: tax_amt,
          status: "paid",
          due_date: null,
          sales_tax_rate: 0,
          sales_tax_amount: tax_amt,
        });
      }
      logger.info(
        `💳 Counterpart CREDIT entries created for PO invoice payment: ${invoice_number}`,
      );

      // Step 3: Update original DEBIT entries to paid - LAST (don’t create extra DEBIT entries)
      const updateQuery = `UPDATE ledger_entries SET status = 'paid' WHERE customer_id = ? AND (bill_no = ? OR bill_no = ?) AND debit_amount > 0 AND status = 'unpaid'`;
      await db
        .promise()
        .query(updateQuery, [
          customer_id,
          invoice_number,
          `TAX-${invoice_number}`,
        ]);
      logger.info(
        `✅ Updated original debit entries to 'paid' for ${invoice_number}`,
      );
    }

    return { success: true };
  } catch (err) {
    logger.error("Error creating payment ledger entry:", err);
    throw err;
  }
}

// Serve static files from uploads directory
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// --- Expense Routes ---

// Get all expenses with optional filtering
app.get("/api/expenses", (req, res) => {
  const { category, status, vendor, minAmount, maxAmount, startDate, endDate } =
    req.query;

  let query = "SELECT * FROM expenses WHERE 1=1";
  const params = [];

  if (category && category !== "All") {
    query += " AND category = ?";
    params.push(category);
  }

  if (status && status !== "All") {
    query += " AND status = ?";
    params.push(status);
  }

  if (vendor) {
    query += " AND vendor LIKE ?";
    params.push(`%${vendor}%`);
  }

  if (minAmount) {
    query += " AND amount >= ?";
    params.push(parseFloat(minAmount));
  }

  if (maxAmount) {
    query += " AND amount <= ?";
    params.push(parseFloat(maxAmount));
  }

  if (startDate) {
    query += " AND date >= ?";
    params.push(startDate);
  }

  if (endDate) {
    query += " AND date <= ?";
    params.push(endDate);
  }

  query += " ORDER BY date DESC, created_at DESC";

  db.query(query, params, (err, results) => {
    if (err) {
      console.error("Error fetching expenses:", err.message);
      return res
        .status(500)
        .json({ message: "Failed to fetch expenses", error: err.message });
    }
    res.json(results);
  });
});

// Get single expense by ID with its items
app.get("/api/expenses/:id", (req, res) => {
  const { id } = req.params;

  // First get the expense
  const expenseQuery = "SELECT * FROM expenses WHERE id = ?";
  db.query(expenseQuery, [id], (err, expenseResults) => {
    if (err) {
      console.error("Error fetching expense:", err.message);
      return res
        .status(500)
        .json({ message: "Failed to fetch expense", error: err.message });
    }

    if (expenseResults.length === 0) {
      return res.status(404).json({ message: "Expense not found" });
    }

    const expense = expenseResults[0];

    // Get expense items (if table exists)
    const itemsQuery =
      "SELECT * FROM expense_items WHERE expense_id = ? ORDER BY item_no";
    db.query(itemsQuery, [id], (err, itemsResults) => {
      if (err) {
        console.error("Error fetching expense items:", err);
        console.error(
          "Note: If expense_items table doesn't exist, please run database_updates.sql",
        );
        // Still return expense even if items fetch fails
        return res.json({
          ...expense,
          items: [],
          note: "Items table not available",
        });
      }

      // Combine expense with items
      const expenseWithItems = {
        ...expense,
        items: itemsResults || [],
      };

      res.json(expenseWithItems);
    });
  });
});

// Create new expense with multiple items support
app.post("/api/expenses", (req, res) => {
  logger.debug("Received expense creation request:", req.body); // Debug log

  const {
    title,
    date,
    vendor,
    amount,
    category,
    categoryType = "Expense",
    paymentMethod,
    status = "Pending",
    description = "",
    items = [],
  } = req.body;

  // Validate required fields
  if (!title || !date || !vendor || !category || !paymentMethod) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  // Function to ensure category exists
  const ensureCategoryExists = (categoryName, categoryType, callback) => {
    // Skip type names as categories
    if (["Expense", "Income", "Asset", "Liability"].includes(categoryName)) {
      return callback(null);
    }

    // Check if category exists
    const checkQuery = "SELECT id FROM categories WHERE name = ? AND type = ?";
    db.query(checkQuery, [categoryName, categoryType], (err, results) => {
      if (err) return callback(err);

      if (results.length > 0) {
        // Category exists
        return callback(null);
      }

      // Create new category
      const createQuery = `
        INSERT INTO categories (name, description, type, status, created_date)
        VALUES (?, ?, ?, 'Active', CURDATE())
      `;
      db.query(
        createQuery,
        [categoryName, `Auto-created ${categoryType} category`, categoryType],
        callback,
      );
    });
  };

  // For multiple items, calculate total amount from items
  let totalAmount = amount;
  if (items && items.length > 0) {
    totalAmount = items.reduce((sum, item) => sum + (item.amount || 0), 0);
  }

  // Ensure category exists before creating expense
  ensureCategoryExists(category, categoryType, (err) => {
    if (err) {
      console.error("Error ensuring category exists:", err);
      return res
        .status(500)
        .json({ message: "Failed to create category", error: err.message });
    }

    // Create expense directly (transactions not supported with mysql2 pool)
    const query = `
      INSERT INTO expenses (title, date, vendor, amount, category, paymentMethod, status, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const values = [
      title,
      date,
      vendor,
      totalAmount,
      category,
      paymentMethod,
      status,
      description,
    ];

    db.query(query, values, (err, result) => {
      if (err) {
        console.error("Error creating expense:", err.message);
        return res
          .status(500)
          .json({ message: "Failed to create expense", error: err.message });
      }

      const expenseId = result.insertId;
      logger.info("Expense created with ID:", expenseId);

      // Skip expense items for now since table doesn't exist
      // TODO: Create expense_items table if detailed item tracking is needed

      logger.info("Expense created successfully");
      res.status(201).json({
        message: "Expense created successfully",
        expense: {
          id: expenseId,
          title,
          date,
          vendor,
          amount: totalAmount,
          category,
          categoryType,
          paymentMethod,
          status,
          description,
          items_count: items ? items.length : 0,
        },
      });
    });
  }); // Close ensureCategoryExists callback
});

// Update expense
app.put("/api/expenses/:id", (req, res) => {
  const expenseId = req.params.id;
  const {
    title,
    date,
    vendor,
    amount,
    category,
    categoryType = "Expense",
    paymentMethod,
    status,
    description,
  } = req.body;

  // Validate required fields
  if (
    !title ||
    !date ||
    !vendor ||
    !amount ||
    !category ||
    !paymentMethod ||
    !status
  ) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  // Function to ensure category exists (same as in create)
  const ensureCategoryExists = (categoryName, categoryType, callback) => {
    // Skip type names as categories
    if (["Expense", "Income", "Asset", "Liability"].includes(categoryName)) {
      return callback(null);
    }

    // Check if category exists
    const checkQuery = "SELECT id FROM categories WHERE name = ? AND type = ?";
    db.query(checkQuery, [categoryName, categoryType], (err, results) => {
      if (err) return callback(err);

      if (results.length > 0) {
        // Category exists
        return callback(null);
      }

      // Create new category
      const createQuery = `
        INSERT INTO categories (name, description, type, status, created_date)
        VALUES (?, ?, ?, 'Active', CURDATE())
      `;
      db.query(
        createQuery,
        [categoryName, `Auto-created ${categoryType} category`, categoryType],
        callback,
      );
    });
  };

  // Ensure category exists before updating expense
  ensureCategoryExists(category, categoryType, (err) => {
    if (err) {
      console.error("Error ensuring category exists:", err);
      return res
        .status(500)
        .json({ message: "Failed to create category", error: err.message });
    }

    const query = `
    UPDATE expenses 
    SET title = ?, date = ?, vendor = ?, amount = ?, category = ?, paymentMethod = ?, status = ?, description = ?
    WHERE id = ?
  `;
    const values = [
      title,
      date,
      vendor,
      amount,
      category,
      paymentMethod,
      status,
      description,
      expenseId,
    ];

    db.query(query, values, (err, result) => {
      if (err) {
        console.error("Error updating expense:", err.message);
        return res
          .status(500)
          .json({ message: "Failed to update expense", error: err.message });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "Expense not found" });
      }

      // Return the updated expense
      const selectQuery = "SELECT * FROM expenses WHERE id = ?";
      db.query(selectQuery, [expenseId], (err, results) => {
        if (err) {
          console.error("Error fetching updated expense:", err.message);
          return res.status(500).json({
            message: "Expense updated but failed to retrieve details",
            error: err.message,
          });
        }

        res.json({
          message: "Expense updated successfully",
          expense: results[0],
        });
      });
    });
  }); // Close ensureCategoryExists callback
});

// Delete expense
app.delete("/api/expenses/:id", (req, res) => {
  const { id } = req.params;

  // First, get the expense to return details in response
  const selectQuery = "SELECT * FROM expenses WHERE id = ?";
  db.query(selectQuery, [id], (err, results) => {
    if (err) {
      console.error("Error fetching expense for deletion:", err.message);
      return res
        .status(500)
        .json({ message: "Failed to delete expense", error: err.message });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: "Expense not found" });
    }

    const deletedExpense = results[0];

    // Now delete the expense
    const deleteQuery = "DELETE FROM expenses WHERE id = ?";
    db.query(deleteQuery, [id], (err, result) => {
      if (err) {
        console.error("Error deleting expense:", err.message);
        return res
          .status(500)
          .json({ message: "Failed to delete expense", error: err.message });
      }

      res.json({
        message: "Expense deleted successfully",
        expense: deletedExpense,
      });
    });
  });
});

// Bulk delete expenses
app.post("/api/expenses/bulk-delete", (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res
        .status(400)
        .json({ error: "Invalid request: ids must be a non-empty array" });
    }

    const placeholders = ids.map(() => "?").join(",");
    const deleteQuery = `DELETE FROM expenses WHERE id IN (${placeholders})`;

    db.query(deleteQuery, ids, (err, results) => {
      if (err) {
        console.error("Error bulk deleting expenses:", err);
        return res.status(500).json({ error: "Failed to delete expenses" });
      }

      logger.info(`Bulk deleted ${results.affectedRows} expenses`);
      res.json({
        message: "Expenses deleted successfully",
        deletedCount: results.affectedRows,
      });
    });
  } catch (error) {
    console.error("Error in bulk delete:", error);
    res.status(500).json({ error: "Failed to delete expenses" });
  }
});

// Get expense statistics (for dashboard)
app.get("/api/expenses-stats", (req, res) => {
  const queries = [
    "SELECT COUNT(*) as total FROM expenses",
    "SELECT COUNT(*) as pending FROM expenses WHERE status = 'Pending'",
    "SELECT COUNT(*) as paid FROM expenses WHERE status = 'Paid'",
    "SELECT COALESCE(SUM(amount), 0) as totalAmount FROM expenses WHERE status = 'Paid'",
    "SELECT category, COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM expenses GROUP BY category",
  ];

  db.query(queries.join(";"), (err, results) => {
    if (err) {
      console.error("Error fetching expense statistics:", err.message);
      return res.status(500).json({
        message: "Failed to fetch expense statistics",
        error: err.message,
      });
    }

    // Handle empty results gracefully
    const stats = {
      total: results[0] && results[0][0] ? results[0][0].total : 0,
      pending: results[1] && results[1][0] ? results[1][0].pending : 0,
      paid: results[2] && results[2][0] ? results[2][0].paid : 0,
      totalAmount:
        results[3] && results[3][0] ? results[3][0].totalAmount || 0 : 0,
      byCategory: results[4] || [],
    };

    res.json(stats);
  });
});

// Get expenses by date range for charts
app.get("/api/expenses-chart", (req, res) => {
  const { year = new Date().getFullYear() } = req.query;

  const query = `
    SELECT 
      MONTH(date) as month,
      YEAR(date) as year,
      COALESCE(SUM(amount), 0) as total,
      COUNT(*) as count,
      category
    FROM expenses 
    WHERE YEAR(date) = ?
    GROUP BY YEAR(date), MONTH(date), category
    ORDER BY year, month
  `;

  db.query(query, [year], (err, results) => {
    if (err) {
      console.error("Error fetching chart data:", err.message);
      return res
        .status(500)
        .json({ message: "Failed to fetch chart data", error: err.message });
    }

    // Return empty array if no data instead of null
    res.json(results || []);
  });
});

// Get expense chart data for dashboard visualization
app.get("/api/expense-chart-data", (req, res) => {
  const query = `
    SELECT 
      DATE_FORMAT(date, '%b') as month,
      YEAR(date) as year,
      COALESCE(SUM(amount), 0) as amount,
      CASE 
        WHEN COALESCE(SUM(amount), 0) > COALESCE(
          (SELECT COALESCE(SUM(amount), 0) 
           FROM expenses e2 
           WHERE YEAR(e2.date) = YEAR(e1.date) 
           AND MONTH(e2.date) = MONTH(e1.date) - 1
          ), 0) THEN 'up'
        ELSE 'down'
      END as trend
    FROM expenses e1
    WHERE date >= DATE_SUB(NOW(), INTERVAL 2 YEAR)
    GROUP BY YEAR(date), MONTH(date)
    ORDER BY year, MONTH(date)
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching expense chart data:", err);
      return res
        .status(500)
        .json({ error: "Failed to fetch expense chart data" });
    }

    // Return empty array with default structure if no data
    if (!results || results.length === 0) {
      const currentMonth = new Date().toLocaleDateString("en-US", {
        month: "short",
      });
      const currentYear = new Date().getFullYear();
      return res.json([
        {
          month: currentMonth,
          year: currentYear,
          amount: 0,
          trend: "neutral",
        },
      ]);
    }

    res.json(results);
  });
});

// Get expense category statistics
app.get("/api/expense-categories-stats", (req, res) => {
  const query = `
    SELECT 
      c.type as category_type,
      COALESCE(SUM(CASE WHEN e.status = 'Paid' THEN e.amount ELSE 0 END), 0) as paid_amount,
      COALESCE(SUM(CASE WHEN e.status = 'Pending' THEN e.amount ELSE 0 END), 0) as pending_amount,
      COUNT(CASE WHEN e.status = 'Paid' THEN e.id END) as paid_count,
      COUNT(CASE WHEN e.status = 'Pending' THEN e.id END) as pending_count,
      COUNT(e.id) as total_count
    FROM categories c
    LEFT JOIN expenses e ON c.name = e.category AND c.type = (
      SELECT type FROM categories WHERE name = e.category LIMIT 1
    )
    WHERE c.type IN ('Expense', 'Income', 'Asset', 'Liability')
    GROUP BY c.type
    ORDER BY c.type
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching expense category stats:", err.message);
      return res.status(500).json({
        message: "Failed to fetch category statistics",
        error: err.message,
      });
    }

    // Initialize default structure
    const categoryStats = {
      Expense: {
        paid_amount: 0,
        pending_amount: 0,
        paid_count: 0,
        pending_count: 0,
        total_count: 0,
      },
      Income: {
        paid_amount: 0,
        pending_amount: 0,
        paid_count: 0,
        pending_count: 0,
        total_count: 0,
      },
      Asset: {
        paid_amount: 0,
        pending_amount: 0,
        paid_count: 0,
        pending_count: 0,
        total_count: 0,
      },
      Liability: {
        paid_amount: 0,
        pending_amount: 0,
        paid_count: 0,
        pending_count: 0,
        total_count: 0,
      },
    };

    // Fill with actual data
    results.forEach((row) => {
      const type = row.category_type;
      if (categoryStats[type]) {
        categoryStats[type].paid_amount = parseFloat(row.paid_amount) || 0;
        categoryStats[type].pending_amount =
          parseFloat(row.pending_amount) || 0;
        categoryStats[type].paid_count = parseInt(row.paid_count) || 0;
        categoryStats[type].pending_count = parseInt(row.pending_count) || 0;
        categoryStats[type].total_count = parseInt(row.total_count) || 0;
      }
    });

    res.json(categoryStats);
  });
});

// Get all customers
app.get("/api/v1/customertable", (req, res) => {
  db.query(
    "SELECT * FROM customertable ORDER BY created_at DESC",
    (err, results) => {
      if (err) {
        console.error("Error fetching customers:", err.message);
        return res
          .status(500)
          .json({ message: "Failed to fetch customers", error: err.message });
      }
      // Return empty array if no customers exist instead of null
      res.json(results || []);
    },
  );
});

// Create a new customer
app.post("/api/v1/customertable", (req, res) => {
  const { customer, company, date, phone, address, email, stn, ntn } = req.body;

  // Validate required fields
  if (!customer || !date || !phone || !address || !email || !stn || !ntn) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  // Check for exact duplicate (all fields match)
  const duplicateCheck = `
    SELECT customer_id FROM customertable 
    WHERE customer = ? AND email = ? AND phone = ? 
    AND address = ? AND stn = ? AND ntn = ?
    AND (company = ? OR (company IS NULL AND ? IS NULL))
  `;

  db.query(
    duplicateCheck,
    [customer, email, phone, address, stn, ntn, company, company],
    (err, duplicates) => {
      if (err) {
        console.error("Error checking for duplicates:", err.message);
        return res.status(500).json({
          message: "Failed to check for duplicates",
          error: err.message,
        });
      }

      if (duplicates.length > 0) {
        return res.status(409).json({
          message:
            "Duplicate customer: A customer with identical information already exists",
        });
      }

      // No duplicate found, proceed with insert
      const query = `
      INSERT INTO customertable (customer, company, date, phone, address, email, stn, ntn)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
      const values = [customer, company, date, phone, address, email, stn, ntn];

      db.query(query, values, (err, result) => {
        if (err) {
          console.error("Error creating customer:", err.message);
          return res
            .status(500)
            .json({ message: "Failed to create customer", error: err.message });
        }

        // Return the newly created customer
        const selectQuery = "SELECT * FROM customertable WHERE customer_id = ?";
        db.query(selectQuery, [result.insertId], (err, results) => {
          if (err) {
            console.error("Error fetching created customer:", err.message);
            return res.status(500).json({
              message: "Customer created but failed to retrieve details",
              error: err.message,
            });
          }

          res.status(201).json({
            message: "Customer created successfully",
            customer: results[0],
          });
        });
      });
    },
  );
});

// Update a customer
app.put("/api/v1/customertable/:id", (req, res) => {
  const customerId = req.params.id;
  const { customer, company, date, phone, address, email, stn, ntn } = req.body;

  // Validate required fields
  if (!customer || !date || !phone || !address || !email || !stn || !ntn) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  // Check for exact duplicate (excluding current record)
  const duplicateCheck = `
    SELECT customer_id FROM customertable 
    WHERE customer_id != ? 
    AND customer = ? AND email = ? AND phone = ? 
    AND address = ? AND stn = ? AND ntn = ?
    AND (company = ? OR (company IS NULL AND ? IS NULL))
  `;

  db.query(
    duplicateCheck,
    [customerId, customer, email, phone, address, stn, ntn, company, company],
    (err, duplicates) => {
      if (err) {
        console.error("Error checking for duplicates:", err.message);
        return res.status(500).json({
          message: "Failed to check for duplicates",
          error: err.message,
        });
      }

      if (duplicates.length > 0) {
        return res.status(409).json({
          message:
            "Duplicate customer: A customer with identical information already exists",
        });
      }

      // No duplicate found, proceed with update
      const query = `
      UPDATE customertable
      SET customer = ?, company = ?, date = ?, phone = ?, address = ?, email = ?, stn = ?, ntn = ?
      WHERE customer_id = ?
    `;
      const values = [
        customer,
        company,
        date,
        phone,
        address,
        email,
        stn,
        ntn,
        customerId,
      ];

      db.query(query, values, (err, result) => {
        if (err) {
          console.error("Error updating customer:", err.message);
          return res
            .status(500)
            .json({ message: "Failed to update customer", error: err.message });
        }

        if (result.affectedRows === 0) {
          return res.status(404).json({ message: "Customer not found" });
        }

        // Return the updated customer
        const selectQuery = "SELECT * FROM customertable WHERE customer_id = ?";
        db.query(selectQuery, [customerId], (err, results) => {
          if (err) {
            console.error("Error fetching updated customer:", err.message);
            return res.status(500).json({
              message: "Customer updated but failed to retrieve details",
              error: err.message,
            });
          }

          res.json({
            message: "Customer updated successfully",
            customer: results[0],
          });
        });
      });
    },
  );
});

// Delete a customer
app.delete("/api/v1/customertable/:id", (req, res) => {
  const { id } = req.params;

  // First, get the customer to return details in response
  const selectQuery = "SELECT * FROM customertable WHERE customer_id = ?";
  db.query(selectQuery, [id], (err, results) => {
    if (err) {
      console.error("Error fetching customer for deletion:", err.message);
      return res
        .status(500)
        .json({ message: "Failed to delete customer", error: err.message });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const deletedCustomer = results[0];

    // Now delete the customer
    const deleteQuery = "DELETE FROM customertable WHERE customer_id = ?";
    db.query(deleteQuery, [id], (err, result) => {
      if (err) {
        console.error("Error deleting customer:", err.message);
        return res
          .status(500)
          .json({ message: "Failed to delete customer", error: err.message });
      }

      res.json({
        message: "Customer deleted successfully",
        customer: deletedCustomer,
      });
    });
  });
});

// Bulk delete customers
app.post("/api/v1/customertable/bulk-delete", (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res
        .status(400)
        .json({ error: "Invalid request: ids must be a non-empty array" });
    }

    const placeholders = ids.map(() => "?").join(",");
    const deleteQuery = `DELETE FROM customertable WHERE customer_id IN (${placeholders})`;

    db.query(deleteQuery, ids, (err, results) => {
      if (err) {
        console.error("Error bulk deleting customers:", err);
        return res.status(500).json({ error: "Failed to delete customers" });
      }

      logger.info(`Bulk deleted ${results.affectedRows} customers`);
      res.json({
        message: "Customers deleted successfully",
        deletedCount: results.affectedRows,
      });
    });
  } catch (error) {
    console.error("Error in bulk delete:", error);
    res.status(500).json({ error: "Failed to delete customers" });
  }
});

// Get customer details by ID for billing address auto-fill
app.get("/api/v1/customers/:id/billing", (req, res) => {
  const { id } = req.params;

  const query = `
    SELECT 
      customer_id,
      customer as customer_name,
      company,
      email as customer_email,
      phone as p_number,
      '' as a_p_number,
      address,
      '' as st_reg_no,
      '' as ntn_number
    FROM customertable 
    WHERE customer_id = ?
  `;

  db.query(query, [id], (err, results) => {
    if (err) {
      console.error("Error fetching customer billing details:", err.message);
      return res.status(500).json({
        message: "Failed to fetch customer billing details",
        error: err.message,
      });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: "Customer not found" });
    }

    res.json(results[0]);
  });
});

// Get customer suggestions for autocomplete
app.get("/api/v1/customers/suggestions", (req, res) => {
  const { q } = req.query;

  if (!q || q.length < 1) {
    return res.json([]);
  }

  // Search in both customertable and reporttable for customer names
  const queries = [
    // Search in customertable
    `SELECT DISTINCT customer as name FROM customertable 
     WHERE customer LIKE ? 
     ORDER BY customer ASC 
     LIMIT 5`,
    // Search in reporttable
    `SELECT DISTINCT customer as name FROM reporttable 
     WHERE customer LIKE ? 
     ORDER BY customer ASC 
     LIMIT 5`,
  ];

  const searchTerm = `${q}%`;
  const customerSet = new Set();

  // Execute both queries and combine results
  Promise.all(
    queries.map(
      (query) =>
        new Promise((resolve, reject) => {
          db.query(query, [searchTerm], (err, results) => {
            if (err) {
              console.error("Error in customer suggestions query:", err);
              // Don't fail the entire request if one table has issues
              resolve([]);
            } else {
              // Handle empty results gracefully
              const names = (results || [])
                .map((row) => row.name)
                .filter((name) => name && name.trim());
              resolve(names);
            }
          });
        }),
    ),
  )
    .then((results) => {
      // Combine and deduplicate results
      (results || []).forEach((customerList) => {
        (customerList || []).forEach((customer) => {
          if (customer) customerSet.add(customer);
        });
      });

      // Convert to array, sort, and limit to 5
      const suggestions = Array.from(customerSet)
        .filter(
          (customer) =>
            customer && customer.toLowerCase().startsWith(q.toLowerCase()),
        )
        .sort()
        .slice(0, 5);

      res.json(suggestions);
    })
    .catch((err) => {
      console.error("Error fetching customer suggestions:", err);
      res.status(500).json({
        error: "Failed to fetch customer suggestions",
        suggestions: [],
      });
    });
});

// --- User Signup & Login ---

// Signup endpoint
app.post("/signup", (req, res) => {
  logger.debug("Signup request received:", req.body);

  const { firstName, lastName, email, password } = req.body;

  // Validate required fields
  if (!firstName || !lastName || !email || !password) {
    logger.info("Signup validation failed: missing fields");
    return res
      .status(400)
      .json({ success: false, message: "All fields are required" });
  }

  // Check if user already exists
  const checkQuery = "SELECT * FROM users WHERE email = ?";
  db.query(checkQuery, [email], (checkErr, checkResults) => {
    if (checkErr) {
      console.error("Error checking existing user:", checkErr);
      return res.status(500).json({
        success: false,
        message: "Database error",
        error: checkErr.message,
      });
    }

    if (checkResults.length > 0) {
      return res.status(400).json({
        success: false,
        message: "User with this email already exists",
      });
    }

    // Insert new user
    const query =
      "INSERT INTO users (firstName, lastName, email, password) VALUES (?, ?, ?, ?)";
    const values = [firstName, lastName, email, password];

    db.query(query, values, (err, result) => {
      if (err) {
        logger.error("Error inserting user:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to create account",
          error: err.message,
        });
      }

      logger.info("User created successfully:", result.insertId);
      res.status(201).json({
        success: true,
        message: "Account created successfully",
        insertId: result.insertId,
      });
    });
  });
});

// Login endpoint

app.post("/login", (req, res) => {
  logger.debug("Login request received for:", req.body.email);

  const { email, password } = req.body;

  // Validate required fields
  if (!email || !password) {
    return res
      .status(400)
      .json({ success: false, message: "Email and password are required" });
  }

  const query = "SELECT * FROM users WHERE email = ? AND password = ?";
  const values = [email, password];

  db.query(query, values, (err, results) => {
    if (err) {
      console.error("Error logging in:", err);
      return res.status(500).json({
        success: false,
        message: "Database error",
        error: err.message,
      });
    }

    if (results.length > 0) {
      const user = results[0];

      // If user has a role, fetch their accessible modules
      if (user.role_id) {
        const modulesQuery =
          "SELECT module FROM role_modules WHERE role_id = ? ORDER BY module ASC";
        db.query(modulesQuery, [user.role_id], (moduleErr, modules) => {
          if (moduleErr) {
            console.error("Error fetching user modules:", moduleErr);
            // Continue without modules if there's an error
            logger.info(`Login successful for: ${email}`);
            res.json({ success: true, message: "Login successful", user });
            return;
          }

          // Add modules array to user object
          user.modules = modules.map((m) => m.module);
          logger.info(`Login successful for: ${email}`);
          res.json({ success: true, message: "Login successful", user });
        });
      } else {
        logger.info(`Login successful for: ${email}`);
        res.json({ success: true, message: "Login successful", user });
      }
    } else {
      logger.info(`Invalid login attempt for: ${email}`);
      res
        .status(401)
        .json({ success: false, message: "Invalid email or password" });
    }
  });
});

// Developer quick-login (only available when DEV_VERBOSE=true)
app.post("/dev-login", (req, res) => {
  if (!DEV_VERBOSE) return res.status(404).json({ message: "Not found" });
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "email required" });
  const query = "SELECT * FROM users WHERE email = ? LIMIT 1";
  db.query(query, [email], (err, results) => {
    if (err) {
      logger.error("Dev login DB error:", err);
      return res.status(500).json({ message: "DB error" });
    }
    if (!results || results.length === 0) {
      logger.info(`Dev login failed: user not found: ${email}`);
      return res.status(404).json({ message: "User not found" });
    }
    const user = results[0];
    // Very concise developer-friendly log
    logger.info(`DEV-LOGIN: ${user.email} (id:${user.id}) loaded`);
    // Remove password before returning
    delete user.password;
    res.json({ success: true, user });
  });
});

// Get user profile
app.get("/api/users/:id", (req, res) => {
  const userId = req.params.id;

  const query = "SELECT * FROM users WHERE id = ?";
  db.query(query, [userId], (err, results) => {
    if (err) {
      console.error("Error fetching user:", err.message);
      return res
        .status(500)
        .json({ message: "Failed to fetch user", error: err.message });
    }
    if (results.length > 0) {
      const user = results[0];
      // Remove password from response
      delete user.password;
      res.json({ success: true, user });
    } else {
      res.status(404).json({ success: false, message: "User not found" });
    }
  });
});

// Update user profile
app.put("/api/users/:id", (req, res) => {
  const userId = req.params.id;
  const { firstName, lastName, email, phone, company, address, avatar } =
    req.body;

  const query = `
    UPDATE users 
    SET firstName = ?, lastName = ?, email = ?, phone = ?, company = ?, address = ?, avatar = ?
    WHERE id = ?
  `;
  const values = [
    firstName,
    lastName,
    email,
    phone,
    company,
    address,
    avatar,
    userId,
  ];

  db.query(query, values, (err, result) => {
    if (err) {
      console.error("Error updating user:", err.message);
      return res
        .status(500)
        .json({ message: "Failed to update user", error: err.message });
    }

    if (result.affectedRows > 0) {
      res.json({ success: true, message: "Profile updated successfully" });
    } else {
      res.status(404).json({ success: false, message: "User not found" });
    }
  });
});

// Update user password
app.put("/api/users/:id/password", (req, res) => {
  const userId = req.params.id;
  const { currentPassword, newPassword } = req.body;

  // First verify current password
  const verifyQuery = "SELECT password FROM users WHERE id = ?";
  db.query(verifyQuery, [userId], (err, results) => {
    if (err) {
      console.error("Error verifying password:", err.message);
      return res
        .status(500)
        .json({ message: "Failed to verify password", error: err.message });
    }

    if (results.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const user = results[0];
    if (user.password !== currentPassword) {
      return res
        .status(400)
        .json({ success: false, message: "Current password is incorrect" });
    }

    // Update password
    const updateQuery = "UPDATE users SET password = ? WHERE id = ?";
    db.query(updateQuery, [newPassword, userId], (err, result) => {
      if (err) {
        console.error("Error updating password:", err.message);
        return res
          .status(500)
          .json({ message: "Failed to update password", error: err.message });
      }

      res.json({ success: true, message: "Password updated successfully" });
    });
  });
});

// --- Report Routes ---

// Get report counts by status
app.get("/api/v1/reports/stats", (req, res) => {
  const query = `
    SELECT 
      status,
      COUNT(*) as count
    FROM reporttable 
    GROUP BY status
    UNION ALL
    SELECT 'All' as status, COUNT(*) as count FROM reporttable
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching report stats:", err.message);
      return res
        .status(500)
        .json({ message: "Failed to fetch report stats", error: err.message });
    }

    // Transform results into a more usable format
    const stats = {};

    // Handle empty results - provide default stats
    if (!results || results.length === 0) {
      stats["All"] = 0;
    } else {
      results.forEach((row) => {
        stats[row.status] = row.count || 0;
      });
    }

    res.json(stats);
  });
});

// Get all reports with comprehensive filtering
app.get("/api/v1/reports", (req, res) => {
  const {
    status,
    minPrice,
    maxPrice,
    dateFrom,
    dateTo,
    customer,
    search,
    sortBy = "date",
    sortOrder = "DESC",
    page = 1,
    limit = 50,
  } = req.query;

  let query = "SELECT * FROM reporttable WHERE 1=1";
  const params = [];

  // Status filter
  if (status && status !== "All") {
    query += " AND status = ?";
    params.push(status);
  }

  // Price range filter
  if (minPrice) {
    query += " AND price >= ?";
    params.push(parseFloat(minPrice));
  }

  if (maxPrice) {
    query += " AND price <= ?";
    params.push(parseFloat(maxPrice));
  }

  // Date range filter
  if (dateFrom) {
    query += " AND date >= ?";
    params.push(dateFrom);
  }

  if (dateTo) {
    query += " AND date <= ?";
    params.push(dateTo);
  }

  // Customer filter
  if (customer) {
    query += " AND customer LIKE ?";
    params.push(`%${customer}%`);
  }

  // General search across multiple fields
  if (search) {
    query += " AND (id LIKE ? OR customer LIKE ? OR status LIKE ?)";
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  // Sorting
  const validSortFields = ["id", "date", "customer", "price", "status"];
  const validSortOrders = ["ASC", "DESC"];

  if (
    validSortFields.includes(sortBy) &&
    validSortOrders.includes(sortOrder.toUpperCase())
  ) {
    query += ` ORDER BY ${sortBy} ${sortOrder.toUpperCase()}`;
  } else {
    query += " ORDER BY date DESC";
  }

  // Pagination
  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 50;
  const offset = (pageNum - 1) * limitNum;

  query += " LIMIT ? OFFSET ?";
  params.push(limitNum, offset);

  db.query(query, params, (err, results) => {
    if (err) {
      console.error("Error fetching reports:", err.message);
      return res
        .status(500)
        .json({ message: "Failed to fetch reports", error: err.message });
    }

    // Get total count for pagination
    let countQuery = "SELECT COUNT(*) as total FROM reporttable WHERE 1=1";
    const countParams = [];

    // Apply same filters for count query (exclude pagination)
    if (status && status !== "All") {
      countQuery += " AND status = ?";
      countParams.push(status);
    }

    if (minPrice) {
      countQuery += " AND price >= ?";
      countParams.push(parseFloat(minPrice));
    }

    if (maxPrice) {
      countQuery += " AND price <= ?";
      countParams.push(parseFloat(maxPrice));
    }

    if (dateFrom) {
      countQuery += " AND date >= ?";
      countParams.push(dateFrom);
    }

    if (dateTo) {
      countQuery += " AND date <= ?";
      countParams.push(dateTo);
    }

    if (customer) {
      countQuery += " AND customer LIKE ?";
      countParams.push(`%${customer}%`);
    }

    if (search) {
      countQuery += " AND (id LIKE ? OR customer LIKE ? OR status LIKE ?)";
      countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    db.query(countQuery, countParams, (countErr, countResults) => {
      if (countErr) {
        console.error("Error getting count:", countErr.message);
        return res
          .status(500)
          .json({ message: "Failed to get count", error: countErr.message });
      }

      const totalRecords = countResults[0] ? countResults[0].total : 0;
      const totalPages = Math.ceil(totalRecords / limitNum);

      res.json({
        data: results,
        pagination: {
          currentPage: pageNum,
          totalPages: totalPages,
          totalRecords: totalRecords,
          hasNextPage: pageNum < totalPages,
          hasPrevPage: pageNum > 1,
        },
      });
    });
  });
});

// Create a new report
app.post("/api/v1/reports", (req, res) => {
  const { id, date, customer, price, status } = req.body;

  // Validate required fields
  if (!id || !date || !customer || !price || !status) {
    return res.status(400).json({ message: "All fields are required" });
  }

  const query =
    "INSERT INTO reporttable (id, date, customer, price, status) VALUES (?, ?, ?, ?, ?)";
  const values = [id, date, customer, price, status];

  db.query(query, values, (err, result) => {
    if (err) {
      console.error("Error creating report:", err.message);
      return res
        .status(500)
        .json({ message: "Failed to create report", error: err.message });
    }
    res.status(201).json({
      message: "Report created successfully",
      insertId: result.insertId,
    });
  });
});

// Update a report
app.put("/api/v1/reports/:id", (req, res) => {
  const reportId = req.params.id;
  const { date, customer, price, status } = req.body;

  // Validate required fields
  if (!date || !customer || !price || !status) {
    return res.status(400).json({ message: "All fields are required" });
  }

  const query =
    "UPDATE reporttable SET date = ?, customer = ?, price = ?, status = ? WHERE id = ?";
  const values = [date, customer, price, status, reportId];

  db.query(query, values, (err, result) => {
    if (err) {
      console.error("Error updating report:", err.message);
      return res
        .status(500)
        .json({ message: "Failed to update report", error: err.message });
    }
    if (result.affectedRows === 0)
      return res.status(404).json({ message: "Report not found" });
    res.json({ message: "Report updated successfully" });
  });
});

// Delete a report by ID
app.delete("/api/v1/reports/:id", (req, res) => {
  const reportId = req.params.id;

  const query = "DELETE FROM reporttable WHERE id = ?";
  db.query(query, [reportId], (err, result) => {
    if (err) {
      console.error("Error deleting report:", err.message);
      return res
        .status(500)
        .json({ message: "Failed to delete report", error: err.message });
    }
    if (result.affectedRows === 0)
      return res.status(404).json({ message: "Report not found" });
    res.json({ message: "Report deleted successfully" });
  });
});

// --- Invoice Routes ---

// Get all invoices with optional filtering
app.get("/api/invoices", (req, res) => {
  const {
    status,
    minAmount,
    maxAmount,
    dateFrom,
    dateTo,
    customer,
    company,
    search,
    is_sent,
    currency,
    invoice_number,
    invoice_type, // Parameter to specify invoice type: 'regular', 'po_invoice', or undefined for both
    exclude_po = "false", // Parameter to exclude PO invoices from results
    sortBy = "bill_date",
    sortOrder = "DESC",
    page = 1,
    limit = 50,
  } = req.query;

  // Build query based on invoice_type parameter
  let query = "";

  if (invoice_type === "po_invoice") {
    // Only PO invoices
    query = `
      SELECT 
        id,
        invoice_number,
        customer_name,
        customer_email,
        customer_phone as p_number,
        '' as a_p_number,
        customer_address as address,
        '' as st_reg_no,
        '' as ntn_number,
        'PO Invoice Items' as item_name,
        1 as quantity,
        total_amount as rate,
        currency,
        tax_rate as salesTax,
        total_amount as item_amount,
        invoice_date as bill_date,
        due_date as delivery_date,
        'Generated from PO' as terms_of_payment,
        due_date as payment_deadline,
        notes as note,
        subtotal,
        tax_rate,
        tax_amount,
        total_amount,
        status,
        CASE WHEN status = 'Sent' THEN 1 ELSE 0 END as is_sent,
        CASE WHEN status = 'Sent' THEN created_at ELSE NULL END as sent_at,
        created_at,
        updated_at,
        'po_invoice' as invoice_type,
        po_number,
        po_id
      FROM po_invoices
      WHERE 1=1
    `;
  } else if (invoice_type === "regular" || exclude_po === "true") {
    // Only regular invoices
    query = `
      SELECT 
        id,
        invoice_number,
        customer_name,
        customer_email,
        p_number,
        a_p_number,
        address,
        st_reg_no,
        ntn_number,
        item_name,
        quantity,
        rate,
        currency,
        salesTax,
        item_amount,
        bill_date,
        delivery_date,
        terms_of_payment,
        payment_deadline,
        note,
        subtotal,
        tax_rate,
        tax_amount,
        total_amount,
        status,
        is_sent,
        sent_at,
        created_at,
        updated_at,
        'regular' as invoice_type,
        NULL as po_number,
        NULL as po_id
      FROM invoice
      WHERE 1=1
    `;
  } else {
    // Both types (UNION ALL) - default behavior when no specific type is requested
    query = `
      SELECT 
        id,
        invoice_number,
        customer_name,
        customer_email,
        p_number,
        a_p_number,
        address,
        st_reg_no,
        ntn_number,
        item_name,
        quantity,
        rate,
        currency,
        salesTax,
        item_amount,
        bill_date,
        delivery_date,
        terms_of_payment,
        payment_deadline,
        note,
        subtotal,
        tax_rate,
        tax_amount,
        total_amount,
        status,
        is_sent,
        sent_at,
        created_at,
        updated_at,
        'regular' as invoice_type,
        NULL as po_number,
        NULL as po_id
      FROM invoice
      WHERE 1=1
      
      UNION ALL
      
      SELECT 
        id,
        invoice_number,
        customer_name,
        customer_email,
        customer_phone as p_number,
        '' as a_p_number,
        customer_address as address,
        '' as st_reg_no,
        '' as ntn_number,
        'PO Invoice Items' as item_name,
        1 as quantity,
        total_amount as rate,
        currency,
        tax_rate as salesTax,
        total_amount as item_amount,
        invoice_date as bill_date,
        due_date as delivery_date,
        'Generated from PO' as terms_of_payment,
        due_date as payment_deadline,
        notes as note,
        subtotal,
        tax_rate,
        tax_amount,
        total_amount,
        status,
        CASE WHEN status = 'Sent' THEN 1 ELSE 0 END as is_sent,
        CASE WHEN status = 'Sent' THEN created_at ELSE NULL END as sent_at,
        created_at,
        updated_at,
        'po_invoice' as invoice_type,
        po_number,
        po_id
      FROM po_invoices
      WHERE 1=1
    `;
  }

  const params = [];

  // Build WHERE conditions based on invoice type
  const conditions = [];

  if (status && status !== "All") {
    conditions.push("status = ?");
    params.push(status);
  }

  if (minAmount) {
    conditions.push("total_amount >= ?");
    params.push(parseFloat(minAmount));
  }

  if (maxAmount) {
    conditions.push("total_amount <= ?");
    params.push(parseFloat(maxAmount));
  }

  if (dateFrom) {
    if (invoice_type === "po_invoice") {
      conditions.push("invoice_date >= ?");
      params.push(dateFrom);
    } else if (invoice_type === "regular" || exclude_po === "true") {
      conditions.push("bill_date >= ?");
      params.push(dateFrom);
    } else {
      // For UNION queries, use the aliased column name from SELECT
      conditions.push("bill_date >= ?");
      params.push(dateFrom);
    }
  }

  if (dateTo) {
    if (invoice_type === "po_invoice") {
      conditions.push("invoice_date <= ?");
      params.push(dateTo);
    } else if (invoice_type === "regular" || exclude_po === "true") {
      conditions.push("bill_date <= ?");
      params.push(dateTo);
    } else {
      // For UNION queries, use the aliased column name from SELECT
      conditions.push("bill_date <= ?");
      params.push(dateTo);
    }
  }

  if (customer) {
    conditions.push("customer_name LIKE ?");
    params.push(`%${customer}%`);
  }

  // Filter by company: lookup customers whose company matches and filter by their names
  if (company) {
    // Use subquery to match customer_name against customertable.customer where company LIKE ?
    conditions.push(
      `customer_name IN (SELECT customer FROM customertable WHERE company LIKE ?)`,
    );
    params.push(`%${company}%`);
  }

  if (currency && currency !== "All") {
    conditions.push("currency = ?");
    params.push(currency);
  }

  if (invoice_number) {
    conditions.push("invoice_number LIKE ?");
    params.push(`%${invoice_number}%`);
  }

  if (is_sent !== undefined && invoice_type !== "po_invoice") {
    conditions.push("is_sent = ?");
    params.push(is_sent === "true" ? 1 : 0);
  }

  if (search) {
    const searchTerm = `%${search}%`;
    if (invoice_type === "po_invoice") {
      conditions.push(
        "(customer_name LIKE ? OR customer_email LIKE ? OR invoice_number LIKE ? OR notes LIKE ?)",
      );
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    } else if (invoice_type === "regular" || exclude_po === "true") {
      conditions.push(
        "(customer_name LIKE ? OR customer_email LIKE ? OR invoice_number LIKE ? OR item_name LIKE ? OR address LIKE ? OR note LIKE ?)",
      );
      params.push(
        searchTerm,
        searchTerm,
        searchTerm,
        searchTerm,
        searchTerm,
        searchTerm,
      );
    } else {
      // For UNION queries, search needs to work on fields common to both tables
      conditions.push(
        "(customer_name LIKE ? OR customer_email LIKE ? OR invoice_number LIKE ? OR address LIKE ? OR note LIKE ?)",
      );
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }
  }

  // Apply conditions to the query
  if (conditions.length > 0) {
    const conditionString = `WHERE 1=1 AND ${conditions.join(" AND ")}`;

    // For UNION queries, we need to apply filters to BOTH parts AND duplicate params
    if (
      !invoice_type ||
      (invoice_type !== "po_invoice" &&
        invoice_type !== "regular" &&
        exclude_po !== "true")
    ) {
      // This is a UNION query - replace both WHERE clauses and duplicate params
      const whereCount = (query.match(/WHERE 1=1/g) || []).length;
      query = query.replace(/WHERE 1=1/g, conditionString);

      // Duplicate params for each WHERE clause in UNION (usually 2: regular + PO)
      if (whereCount > 1) {
        const originalParams = [...params];
        for (let i = 1; i < whereCount; i++) {
          params.push(...originalParams);
        }
      }
    } else {
      // Single query (either PO only or regular only)
      query = query.replace("WHERE 1=1", conditionString);
    }
  }

  // Wrap the query and apply sorting
  const allowedSortFields = [
    "id",
    "invoice_number",
    "customer_name",
    "bill_date",
    "total_amount",
    "status",
    "created_at",
    "updated_at",
  ];
  const allowedSortOrders = ["ASC", "DESC"];

  let finalQuery = invoice_type
    ? query
    : `SELECT * FROM (${query}) AS unified_invoices`;

  if (
    allowedSortFields.includes(sortBy) &&
    allowedSortOrders.includes(sortOrder.toUpperCase())
  ) {
    finalQuery += ` ORDER BY ${sortBy} ${sortOrder.toUpperCase()}`;
  } else {
    // Default to created_at DESC for latest first
    finalQuery += " ORDER BY created_at DESC";
  }

  // Pagination
  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 50;
  const offset = (pageNum - 1) * limitNum;

  // First get the total count for pagination
  const countQuery = invoice_type
    ? `SELECT COUNT(*) as total FROM (${query}) AS count_table`
    : `SELECT COUNT(*) as total FROM (${query}) AS count_table`;

  db.query(countQuery, params, (err, countResults) => {
    if (err) {
      console.error("Error counting invoices:", err);
      res.status(500).json({ error: "Failed to count invoices" });
      return;
    }

    const totalRecords = countResults[0] ? countResults[0].total : 0;
    const totalPages = Math.ceil(totalRecords / limitNum);

    // Add pagination to main query
    finalQuery += " LIMIT ? OFFSET ?";
    const queryParams = [...params, limitNum, offset];

    // Execute main query
    db.query(finalQuery, queryParams, (err, results) => {
      if (err) {
        console.error("Error fetching invoices:", err);
        res.status(500).json({ error: "Failed to fetch invoices" });
        return;
      }

      // Return data with pagination info
      res.json({
        data: results,
        pagination: {
          currentPage: pageNum,
          totalPages: totalPages,
          totalRecords: totalRecords,
          limit: limitNum,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1,
        },
        filters: {
          status,
          minAmount,
          maxAmount,
          dateFrom,
          dateTo,
          customer,
          company,
          search,
          is_sent,
          currency,
          invoice_number,
        },
      });
    });
  });
});

// Get invoice filter options and statistics
app.get("/api/invoices/filters/options", (req, res) => {
  const queries = [
    // Get all unique statuses
    "SELECT DISTINCT status FROM invoice WHERE status IS NOT NULL AND status != '' ORDER BY status",
    // Get all unique currencies
    "SELECT DISTINCT currency FROM invoice WHERE currency IS NOT NULL AND currency != '' ORDER BY currency",
    // Get invoice statistics
    `SELECT 
      COUNT(*) as total_invoices,
      COUNT(CASE WHEN status = 'Paid' THEN 1 END) as paid_count,
      COUNT(CASE WHEN status = 'Pending' THEN 1 END) as pending_count,
      COUNT(CASE WHEN status = 'Draft' THEN 1 END) as draft_count,
      COUNT(CASE WHEN status = 'Cancelled' THEN 1 END) as cancelled_count,
      COUNT(CASE WHEN is_sent = 1 THEN 1 END) as sent_count,
      COUNT(CASE WHEN is_sent = 0 THEN 1 END) as not_sent_count,
      COALESCE(MIN(total_amount), 0) as min_amount,
      COALESCE(MAX(total_amount), 0) as max_amount,
      COALESCE(AVG(total_amount), 0) as avg_amount,
      COALESCE(MIN(bill_date), CURDATE()) as earliest_date,
      COALESCE(MAX(bill_date), CURDATE()) as latest_date
     FROM invoice`,
    // Get top customers by invoice count
    "SELECT customer_name, COUNT(*) as invoice_count, COALESCE(SUM(total_amount), 0) as total_amount FROM invoice GROUP BY customer_name ORDER BY invoice_count DESC LIMIT 10",
  ];

  const executeQueries = async () => {
    try {
      const results = await Promise.all(
        queries.map(
          (query) =>
            new Promise((resolve, reject) => {
              db.query(query, (err, result) => {
                if (err) reject(err);
                else resolve(result || []);
              });
            }),
        ),
      );

      const [statuses, currencies, statistics, topCustomers] = results;

      // Handle empty tables gracefully
      const defaultStatistics = {
        total_invoices: 0,
        paid_count: 0,
        pending_count: 0,
        draft_count: 0,
        cancelled_count: 0,
        sent_count: 0,
        not_sent_count: 0,
        min_amount: 0,
        max_amount: 0,
        avg_amount: 0,
        earliest_date: new Date().toISOString().split("T")[0],
        latest_date: new Date().toISOString().split("T")[0],
      };

      res.json({
        statuses: (statuses || [])
          .map((row) => row.status)
          .filter((status) => status),
        currencies: (currencies || [])
          .map((row) => row.currency)
          .filter((currency) => currency),
        statistics:
          statistics && statistics[0] ? statistics[0] : defaultStatistics,
        topCustomers: topCustomers || [],
        success: true,
      });
    } catch (error) {
      console.error("Error fetching filter options:", error);
      res.status(500).json({
        error: "Failed to fetch filter options",
        statuses: ["Draft", "Pending", "Sent", "Paid", "Overdue", "Cancelled"],
        currencies: ["PKR"],
        statistics: {
          total_invoices: 0,
          paid_count: 0,
          pending_count: 0,
          draft_count: 0,
          cancelled_count: 0,
          sent_count: 0,
          not_sent_count: 0,
          min_amount: 0,
          max_amount: 0,
          avg_amount: 0,
          earliest_date: new Date().toISOString().split("T")[0],
          latest_date: new Date().toISOString().split("T")[0],
        },
        topCustomers: [],
        success: false,
      });
    }
  };

  executeQueries();
});

// Get single invoice by ID with its items and payments
app.get("/api/invoices/:id", (req, res) => {
  const { id } = req.params;

  // First get the invoice (JOIN customertable to get company name)
  const invoiceQuery = "SELECT i.*, c.company as company_name FROM invoice i LEFT JOIN customertable c ON i.customer_id = c.customer_id WHERE i.id = ?";
  db.query(invoiceQuery, [id], (err, invoiceResults) => {
    if (err) {
      console.error("Error fetching invoice:", err);
      res.status(500).json({ error: "Failed to fetch invoice" });
      return;
    }
    if (invoiceResults.length === 0) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    const invoice = invoiceResults[0];

    // Get invoice items
    const itemsQuery =
      "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY item_no";
    db.query(itemsQuery, [id], (err, itemsResults) => {
      if (err) {
        console.error("Error fetching invoice items:", err);
        res.status(500).json({ error: "Failed to fetch invoice items" });
        return;
      }

      // Get invoice payments
      const paymentsQuery =
        "SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY payment_date";
      db.query(paymentsQuery, [id], (err, paymentsResults) => {
        if (err) {
          console.error("Error fetching invoice payments:", err);
          res.status(500).json({ error: "Failed to fetch invoice payments" });
          return;
        }

        // Combine all data
        const invoiceWithDetails = {
          ...invoice,
          items: itemsResults,
          payments: paymentsResults,
        };

        res.json(invoiceWithDetails);
      });
    });
  });
});

// Create new invoice with multiple items support
app.post("/api/invoices", (req, res) => {
  logger.debug("Received invoice creation request:", req.body); // Debug log

  const {
    customer_name,
    customer_email,
    p_number,
    a_p_number,
    address,
    st_reg_no,
    ntn_number,
    currency,
    subtotal,
    tax_rate,
    tax_amount,
    total_amount,
    bill_date,
    payment_deadline,
    payment_days,
    note,
    status = "Pending",
    items = [],
  } = req.body;

  // Validate required fields
  if (!customer_name || !customer_email) {
    return res.status(400).json({
      error: "Missing required fields",
      required: ["customer_name", "customer_email"],
    });
  }

  // Check if customer exists in the database
  const checkCustomerQuery =
    "SELECT customer_id FROM customertable WHERE customer = ?";
  db.query(checkCustomerQuery, [customer_name], (err, customerResults) => {
    if (err) {
      console.error("Error checking customer:", err);
      return res.status(500).json({
        error: "Failed to verify customer",
        details: err.message,
      });
    }

    if (customerResults.length === 0) {
      return res.status(400).json({
        error: "Customer not present. Kindly create new Customer first.",
      });
    }

    const customer_id = customerResults[0].customer_id;

    // Validate bill_date as required in DB
    if (!bill_date) {
      return res.status(400).json({
        error: "Bill date is required",
      });
    }

    // Determine payment_deadline: if payment_days provided, calculate due date
    let computed_payment_deadline = payment_deadline || null;
    if (payment_days !== undefined && payment_days !== null) {
      const pd = Number(payment_days);
      if (isNaN(pd) || pd < 0 || pd > 365) {
        return res
          .status(400)
          .json({ error: "payment_days must be a number between 0 and 365" });
      }
      const baseDate = new Date(bill_date || new Date());
      const due = new Date(baseDate);
      due.setDate(due.getDate() + pd);
      computed_payment_deadline = due.toISOString().split("T")[0];
    }

    // If neither payment_deadline nor payment_days provided, reject
    if (!computed_payment_deadline) {
      return res.status(400).json({
        error: "Either payment_deadline or payment_days is required",
      });
    }

    // Validate items
    if (!items || items.length === 0) {
      return res.status(400).json({
        error: "At least one item is required",
      });
    }

    // Get the next invoice ID for sequential numbering
    const getMaxInvoiceIdQuery = "SELECT MAX(id) as max_id FROM invoice";

    db.query(getMaxInvoiceIdQuery, (err, results) => {
      if (err) {
        logger.error("Error getting max invoice ID:", err);
        // Fallback to timestamp if query fails
        const invoice_number = `INV-${new Date().getFullYear()}-${Date.now()}`;
        proceedWithInvoiceCreation(invoice_number);
      } else {
        const nextId = (results[0]?.max_id || 0) + 1;
        const invoice_number = `INV-${nextId}`;
        proceedWithInvoiceCreation(invoice_number);
      }
    });

    function proceedWithInvoiceCreation(invoice_number) {
      logger.debug("Generated invoice_number:", invoice_number);

      // Insert invoice directly (transactions not supported with mysql2 pool)
      const invoiceQuery = `
        INSERT INTO invoice (
          invoice_number, customer_id, customer_name, customer_email, p_number, a_p_number, address,
          st_reg_no, ntn_number, currency, subtotal, tax_rate, tax_amount, total_amount, bill_date,
          payment_deadline, payment_days, note, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const invoiceValues = [
        invoice_number,
        customer_id,
        customer_name,
        customer_email,
        p_number || "",
        a_p_number || "",
        address || "",
        st_reg_no || "",
        ntn_number || "",
        currency || "PKR",
        subtotal || 0,
        tax_rate !== null && tax_rate !== undefined ? tax_rate : 0,
        tax_amount || 0,
        total_amount || 0,
        bill_date,
        computed_payment_deadline,
        payment_days || null,
        note || "",
        status,
      ];

      logger.debug("Executing invoice query with values:", invoiceValues);

      db.query(invoiceQuery, invoiceValues, (err, invoiceResult) => {
        if (err) {
          console.error("Error creating invoice:", err);
          return res.status(500).json({
            error: "Failed to create invoice",
            details: err.message,
          });
        }

        const invoiceId = invoiceResult.insertId;
        logger.info("Invoice created with ID:", invoiceId);

        // Insert invoice items
        if (items.length > 0) {
          const itemsQuery = `
            INSERT INTO invoice_items (invoice_id, item_no, description, quantity, unit, rate, net_weight, amount)
            VALUES ?
          `;

          const itemsValues = items.map((item) => [
            invoiceId,
            item.item_no || 1,
            item.description || "",
            item.quantity || 0,
            item.unit || "",
            item.rate || 0,
            item.net_weight !== undefined && item.net_weight !== null
              ? item.net_weight
              : 0,
            item.amount || 0,
          ]);

          db.query(itemsQuery, [itemsValues], (err, itemsResult) => {
            if (err) {
              console.error("Error creating invoice items:", err);
              return res.status(500).json({
                error: "Failed to create invoice items",
                details: err.message,
              });
            }

            logger.info("Invoice and items created successfully");

            // ✅ CREATE AUTOMATIC LEDGER ENTRY FOR INVOICE (DEBIT - Receivable)
            createLedgerEntriesForInvoice({
              customer_id,
              invoice_number,
              bill_date,
              payment_deadline: computed_payment_deadline,
              total_amount,
              subtotal,
              tax_rate,
              tax_amount,
              status,
              currency,
              items,
            }).catch((ledgerErr) => {
              logger.error(
                "Failed to create ledger entry for invoice:",
                ledgerErr,
              );
              // Don't fail the invoice creation, just log the error
            });

            res.status(201).json({
              id: invoiceId,
              message: "Invoice created successfully",
              invoice: {
                id: invoiceId,
                invoice_number,
                customer_name,
                customer_email,
                total_amount,
                status,
                items_count: items.length,
              },
            });
          });
        } else {
          logger.info("Invoice created successfully (no items)");

          // ✅ CREATE AUTOMATIC LEDGER ENTRY FOR INVOICE WITHOUT ITEMS
          createLedgerEntriesForInvoice({
            customer_id,
            invoice_number,
            bill_date,
            payment_deadline: computed_payment_deadline,
            total_amount,
            subtotal,
            tax_rate,
            tax_amount,
            status,
            currency,
            items: [],
          }).catch((ledgerErr) => {
            logger.error(
              "Failed to create ledger entry for invoice (no items):",
              ledgerErr,
            );
          });

          res.status(201).json({
            id: invoiceId,
            message: "Invoice created successfully",
            invoice: {
              id: invoiceId,
              invoice_number,
              customer_name,
              customer_email,
              total_amount,
              status,
            },
          });
        }
      });
    }
  }); // Close db.query callback
});

// Update invoice
app.put("/api/invoices/:id", (req, res) => {
  const { id } = req.params;
  const {
    customer_name,
    customer_email,
    p_number,
    a_p_number,
    address,
    st_reg_no,
    ntn_number,
    currency,
    subtotal,
    tax_rate,
    tax_amount,
    total_amount,
    bill_date,
    payment_deadline,
    payment_days,
    note,
    status,
    items,
  } = req.body;

  logger.debug("Updating invoice with data:", req.body);

  // Calculate payment_deadline if not provided
  let computed_payment_deadline = payment_deadline;

  if (!computed_payment_deadline && bill_date) {
    // Calculate from bill_date and payment_days (default 30 days)
    const billDate = new Date(bill_date);
    const days = payment_days || 30;
    billDate.setDate(billDate.getDate() + days);
    computed_payment_deadline = billDate.toISOString().split("T")[0];
  }

  if (!computed_payment_deadline) {
    return res.status(400).json({
      error: "payment_deadline or bill_date with payment_days is required",
    });
  }

  // Update invoice directly (transactions not supported with mysql2 pool)
  const updateInvoiceQuery = `
    UPDATE invoice SET
      customer_name = ?, customer_email = ?, p_number = ?, a_p_number = ?, address = ?,
      st_reg_no = ?, ntn_number = ?, currency = ?, subtotal = ?, tax_rate = ?, 
      tax_amount = ?, total_amount = ?, bill_date = ?, payment_deadline = ?, 
      note = ?, status = ?, updated_at = NOW()
    WHERE id = ?
  `;

  const invoiceValues = [
    customer_name,
    customer_email,
    p_number,
    a_p_number,
    address,
    st_reg_no,
    ntn_number,
    currency,
    subtotal,
    tax_rate,
    tax_amount,
    total_amount,
    bill_date,
    computed_payment_deadline,
    note,
    status,
    id,
  ];

  db.query(updateInvoiceQuery, invoiceValues, (err, results) => {
    if (err) {
      console.error("Error updating invoice:", err);
      return res.status(500).json({ error: "Failed to update invoice" });
    }

    if (results.affectedRows === 0) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    // Delete existing items
    const deleteItemsQuery = "DELETE FROM invoice_items WHERE invoice_id = ?";

    db.query(deleteItemsQuery, [id], (err) => {
      if (err) {
        console.error("Error deleting existing items:", err);
        return res
          .status(500)
          .json({ error: "Failed to delete existing items" });
      }

      // Insert new items if provided
      if (items && Array.isArray(items) && items.length > 0) {
        const insertItemQuery = `
          INSERT INTO invoice_items (invoice_id, item_no, description, quantity, unit, rate, net_weight, amount, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `;

        let completedInserts = 0;
        let insertError = false;

        items.forEach((item, index) => {
          const itemValues = [
            id,
            item.item_no || index + 1,
            item.description || "",
            parseFloat(item.quantity) || 0,
            item.unit || "",
            parseFloat(item.rate) || 0,
            item.net_weight !== undefined && item.net_weight !== null
              ? parseFloat(item.net_weight)
              : 0,
            parseFloat(item.amount) || 0,
          ];

          db.query(insertItemQuery, itemValues, (err) => {
            if (err && !insertError) {
              console.error("Error inserting item:", err);
              insertError = true;
              return res
                .status(500)
                .json({ error: "Failed to insert invoice items" });
            }

            completedInserts++;

            if (completedInserts === items.length && !insertError) {
              // All items inserted successfully
              logger.info("Invoice updated successfully with items");
              handleInvoicePaymentIfNeeded(id, status);

              res.json({
                message: "Invoice updated successfully",
                id: id,
                itemsUpdated: items.length,
              });
            }
          });
        });
      } else {
        // No items to insert
        logger.info("Invoice updated successfully");
        handleInvoicePaymentIfNeeded(id, status);

        res.json({
          message: "Invoice updated successfully",
          id: id,
          itemsUpdated: 0,
        });
      }
    });
  });

  logger.info("Invoice updated successfully without items");
});

// Delete invoice
app.delete("/api/invoices/:id", (req, res) => {
  const { id } = req.params;
  const query = "DELETE FROM invoice WHERE id = ?";

  db.query(query, [id], (err, results) => {
    if (err) {
      console.error("Error deleting invoice:", err);
      res.status(500).json({ error: "Failed to delete invoice" });
      return;
    }
    if (results.affectedRows === 0) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    res.json({ message: "Invoice deleted successfully" });
  });
});

// Bulk delete invoices
app.post("/api/invoices/bulk-delete", (req, res) => {
  try {
    const { ids } = req.body;

    // Validate request
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res
        .status(400)
        .json({ error: "Invalid request: ids must be a non-empty array" });
    }

    // Create placeholders for SQL query
    const placeholders = ids.map(() => "?").join(",");

    // First delete invoice items
    const deleteItemsQuery = `DELETE FROM invoice_items WHERE invoice_id IN (${placeholders})`;

    db.query(deleteItemsQuery, ids, (err) => {
      if (err) {
        console.error("Error deleting invoice items:", err);
        return res
          .status(500)
          .json({ error: "Failed to delete invoice items" });
      }

      // Then delete invoices
      const deleteInvoicesQuery = `DELETE FROM invoice WHERE id IN (${placeholders})`;

      db.query(deleteInvoicesQuery, ids, (err, results) => {
        if (err) {
          console.error("Error deleting invoices:", err);
          return res.status(500).json({ error: "Failed to delete invoices" });
        }

        logger.info(`Bulk deleted ${results.affectedRows} invoices`);
        res.json({
          message: "Invoices deleted successfully",
          deletedCount: results.affectedRows,
        });
      });
    });
  } catch (error) {
    console.error("Error in bulk delete:", error);
    res.status(500).json({ error: "Failed to delete invoices" });
  }
});

// --- Transaction History Routes ---

// Get latest paid invoices for transaction history with pagination
app.get("/api/transaction-history", (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  // Query to get ALL paid invoices (both regular and PO invoices)
  const query = `
    SELECT 
      i.id,
      CONCAT('INV-', i.id) as invoice_number,
      i.customer_name,
      i.total_amount,
      i.currency,
      i.bill_date,
      i.payment_deadline,
      i.created_at,
      'Paid Invoice' as transaction_type,
      'income' as type,
      'regular' as invoice_type,
      NULL as po_number
    FROM invoice i 
    WHERE i.status = 'Paid'
    
    UNION ALL
    
    SELECT 
      po.id,
      po.invoice_number,
      po.customer_name,
      po.total_amount,
      po.currency,
      po.invoice_date as bill_date,
      po.due_date as payment_deadline,
      po.created_at,
      'Paid PO Invoice' as transaction_type,
      'income' as type,
      'po_invoice' as invoice_type,
      po.po_number
    FROM po_invoices po 
    WHERE po.status = 'Paid'
    
    ORDER BY created_at DESC, bill_date DESC
    LIMIT ? OFFSET ?
  `;

  // Count query for pagination (count both regular and PO invoices)
  const countQuery = `
    SELECT 
      (SELECT COUNT(*) FROM invoice WHERE status = 'Paid') + 
      (SELECT COUNT(*) FROM po_invoices WHERE status = 'Paid') as total
  `;

  // Execute count query first
  db.query(countQuery, (err, countResults) => {
    if (err) {
      console.error("Error counting paid invoices:", err);
      return res.status(500).json({
        error: "Failed to fetch transaction count",
        data: [],
        pagination: {
          currentPage: 1,
          totalPages: 0,
          totalRecords: 0,
          limit: parseInt(limit),
          hasNext: false,
          hasPrev: false,
        },
      });
    }

    const totalRecords = countResults[0]?.total || 0;
    const totalPages = Math.ceil(totalRecords / parseInt(limit));

    // Handle empty table case
    if (totalRecords === 0) {
      return res.json({
        data: [],
        pagination: {
          currentPage: parseInt(page),
          totalPages: 0,
          totalRecords: 0,
          limit: parseInt(limit),
          hasNext: false,
          hasPrev: false,
        },
      });
    }

    // Execute main query
    db.query(query, [parseInt(limit), offset], (err, results) => {
      if (err) {
        console.error("Error fetching transaction history:", err);
        return res.status(500).json({
          error: "Failed to fetch transaction history",
          data: [],
          pagination: {
            currentPage: parseInt(page),
            totalPages: totalPages,
            totalRecords: totalRecords,
            limit: parseInt(limit),
            hasNext: false,
            hasPrev: false,
          },
        });
      }

      // Format the results for the frontend
      const formattedResults = (results || []).map((item) => ({
        id: item.id || 0,
        name: `${item.customer_name || "Unknown Customer"} - Invoice #${item.invoice_number || `INV-${item.id}`}`,
        amount: parseFloat(item.total_amount || 0),
        currency: item.currency || "PKR",
        type: item.type || "income",
        time: item.created_at
          ? new Date(item.created_at).toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            })
          : "00:00",
        date: item.bill_date || new Date().toISOString().split("T")[0],
        initial: item.customer_name
          ? item.customer_name.substring(0, 2).toUpperCase()
          : "IN",
        transaction_type: item.transaction_type || "Paid Invoice",
        invoice_id: item.id || 0,
        invoice_type: item.invoice_type || "regular",
        po_number: item.po_number || null,
      }));

      res.json({
        data: formattedResults,
        pagination: {
          currentPage: parseInt(page),
          totalPages: totalPages,
          totalRecords: totalRecords,
          limit: parseInt(limit),
          hasNext: parseInt(page) < totalPages,
          hasPrev: parseInt(page) > 1,
        },
      });
    });
  });
});

// Get transaction statistics for dashboard
app.get("/api/transaction-stats", (req, res) => {
  const queries = [
    // Total paid invoices count
    "SELECT COUNT(*) as total_transactions FROM invoice WHERE status = 'Paid'",
    // Total paid amount
    "SELECT COALESCE(SUM(total_amount), 0) as total_income FROM invoice WHERE status = 'Paid'",
    // Today's paid invoices
    "SELECT COUNT(*) as today_transactions FROM invoice WHERE status = 'Paid' AND DATE(created_at) = CURDATE()",
    // This month's paid amount
    "SELECT COALESCE(SUM(total_amount), 0) as month_income FROM invoice WHERE status = 'Paid' AND MONTH(created_at) = MONTH(CURDATE()) AND YEAR(created_at) = YEAR(CURDATE())",
  ];

  const executeQueries = async () => {
    try {
      const results = await Promise.all(
        queries.map(
          (query) =>
            new Promise((resolve, reject) => {
              db.query(query, (err, result) => {
                if (err) reject(err);
                else resolve(result[0] || {});
              });
            }),
        ),
      );

      const [totalTxn, totalIncome, todayTxn, monthIncome] = results;

      res.json({
        totalTransactions: totalTxn.total_transactions || 0,
        totalIncome: parseFloat(totalIncome.total_income || 0),
        todayTransactions: todayTxn.today_transactions || 0,
        monthIncome: parseFloat(monthIncome.month_income || 0),
        success: true,
      });
    } catch (error) {
      logger.error("Error fetching transaction statistics:", error);
      res.status(500).json({
        error: "Failed to fetch transaction statistics",
        // Return default values in case of error
        totalTransactions: 0,
        totalIncome: 0,
        todayTransactions: 0,
        monthIncome: 0,
        success: false,
      });
    }
  };

  executeQueries();
});

// --- PO Invoice Routes ---

// Get all PO invoice numbers (for ID generation)
app.get("/api/po-invoices", (req, res) => {
  const query =
    "SELECT invoice_number FROM po_invoices ORDER BY created_at DESC";

  db.query(query, (err, results) => {
    if (err) {
      logger.error("Error fetching PO invoice numbers:", err);
      return res.status(500).json({
        error: "Failed to fetch PO invoice numbers",
        invoices: [], // Return empty array for ID generation
      });
    }

    // Handle empty table gracefully
    if (!results || results.length === 0) {
      logger.info(
        "No PO invoices found - returning empty array for ID generation",
      );
      return res.json([]);
    }

    // Return just the invoice numbers for ID generation
    const invoiceNumbers = results
      .map((row) => row.invoice_number)
      .filter((num) => num);
    res.json(invoiceNumbers);
  });
});

// Get all PO invoices with details
app.get("/api/po-invoices/details", (req, res) => {
  const {
    po_id,
    status,
    minAmount,
    maxAmount,
    dateFrom,
    dateTo,
    customer,
    sortBy = "invoice_date",
    sortOrder = "DESC",
    page = 1,
    limit = 50,
  } = req.query;

  let query = `
    SELECT 
      pi.*,
      po.po_number,
      po.supplier_name,
      po.total_amount as po_total_amount
    FROM po_invoices pi
    LEFT JOIN purchase_orders po ON pi.po_id = po.id
    WHERE 1=1
  `;
  const params = [];

  // Filter by PO ID if provided (handle both numeric ID and PO number)
  if (po_id) {
    const isNumericId = /^\d+$/.test(po_id);
    if (isNumericId) {
      query += " AND pi.po_id = ?";
      params.push(po_id);
    } else {
      // PO number format, need to join with purchase_orders to find by po_number
      query += " AND po.po_number = ?";
      params.push(po_id);
    }
  }

  // Status filter
  if (status && status !== "All") {
    query += " AND pi.status = ?";
    params.push(status);
  }

  // Amount filters
  if (minAmount) {
    query += " AND pi.total_amount >= ?";
    params.push(parseFloat(minAmount));
  }

  if (maxAmount) {
    query += " AND pi.total_amount <= ?";
    params.push(parseFloat(maxAmount));
  }

  // Date filters
  if (dateFrom) {
    query += " AND pi.invoice_date >= ?";
    params.push(dateFrom);
  }

  if (dateTo) {
    query += " AND pi.invoice_date <= ?";
    params.push(dateTo);
  }

  // Customer filter
  if (customer) {
    query += " AND pi.customer_name LIKE ?";
    params.push(`%${customer}%`);
  }

  // Sorting
  const validSortFields = [
    "invoice_date",
    "invoice_number",
    "customer_name",
    "total_amount",
    "status",
  ];
  const validSortOrders = ["ASC", "DESC"];

  if (
    validSortFields.includes(sortBy) &&
    validSortOrders.includes(sortOrder.toUpperCase())
  ) {
    query += ` ORDER BY pi.${sortBy} ${sortOrder.toUpperCase()}`;
  } else {
    query += " ORDER BY pi.invoice_date DESC";
  }

  // Pagination
  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 50;
  const offset = (pageNum - 1) * limitNum;

  query += " LIMIT ? OFFSET ?";
  params.push(limitNum, offset);

  db.query(query, params, (err, results) => {
    if (err) {
      console.error("Error fetching PO invoices:", err);
      res.status(500).json({ error: "Failed to fetch PO invoices" });
      return;
    }

    res.json(results);
  });
});

// Create new PO invoice
app.post("/api/po-invoices", (req, res) => {
  logger.debug("Received PO invoice creation request:", req.body);

  const {
    po_id,
    po_number,
    invoice_number,
    customer_name,
    customer_email,
    customer_phone,
    customer_address,
    invoice_date,
    due_date,
    subtotal,
    tax_rate,
    tax_amount,
    total_amount,
    currency = "PKR",
    notes = "",
    status = "Pending",
  } = req.body;

  // Validate required fields
  if (!po_id || !invoice_number || !customer_name) {
    return res.status(400).json({
      error: "Missing required fields",
      required: ["po_id", "invoice_number", "customer_name"],
    });
  }

  const query = `
    INSERT INTO po_invoices (
      po_id, po_number, invoice_number, customer_name, customer_email, 
      customer_phone, customer_address, invoice_date, due_date, 
      subtotal, tax_rate, tax_amount, total_amount, currency, notes, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    po_id,
    po_number,
    invoice_number,
    customer_name,
    customer_email || "",
    customer_phone || "",
    customer_address || "",
    invoice_date || new Date().toISOString().split("T")[0],
    due_date ||
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0], // 30 days from now
    subtotal || 0,
    tax_rate || 17,
    tax_amount || 0,
    total_amount || 0,
    currency,
    notes,
    status,
  ];

  db.query(query, values, (err, result) => {
    if (err) {
      logger.error("Error creating PO invoice:", err);
      res.status(500).json({
        error: "Failed to create PO invoice",
        details: err.message,
      });
      return;
    }

    logger.info("PO Invoice created with ID:", result.insertId);
    res.status(201).json({
      id: result.insertId,
      message: "PO Invoice created successfully",
      invoice: {
        id: result.insertId,
        invoice_number,
        po_number,
        customer_name,
        total_amount,
        status,
      },
    });
  });
});

// --- Purchase Order Routes ---

// Get purchase order summary for remaining amount calculation
app.get("/api/purchase-orders/:id/summary", (req, res) => {
  const { id } = req.params;

  // Check if ID is numeric (database ID) or PO number format
  const isNumericId = /^\d+$/.test(id);
  const whereClause = isNumericId ? "po.id = ?" : "po.po_number = ?";

  // Get PO details and calculate total invoiced amount
  const query = `
    SELECT 
      po.id,
      po.po_number,
      po.supplier_name,
      po.total_amount as po_total,
      COALESCE(SUM(pi.total_amount), 0) as total_invoiced,
      (po.total_amount - COALESCE(SUM(pi.total_amount), 0)) as remaining_amount,
      COUNT(pi.id) as invoice_count
    FROM purchase_orders po
    LEFT JOIN po_invoices pi ON po.id = pi.po_id
    WHERE ${whereClause}
    GROUP BY po.id, po.po_number, po.supplier_name, po.total_amount
  `;

  db.query(query, [id], (err, results) => {
    if (err) {
      console.error("Error fetching PO summary:", err);
      res.status(500).json({ error: "Failed to fetch PO summary" });
      return;
    }

    if (results.length === 0) {
      res.status(404).json({ error: "Purchase order not found" });
      return;
    }

    const summary = results[0];
    // Ensure remaining_amount is not negative
    summary.remaining_amount = Math.max(0, summary.remaining_amount);

    res.json(summary);
  });
});

// Get all purchase orders with filtering
app.get("/api/purchase-orders", (req, res) => {
  const {
    status,
    supplier,
    po_number,
    minAmount,
    maxAmount,
    dateFrom,
    dateTo,
    sortBy = "created_at",
    sortOrder = "DESC",
    page = 1,
    limit = 50,
  } = req.query;

  let query = `
    SELECT 
      po.*,
      COALESCE(SUM(pi.total_amount), 0) as total_invoiced,
      (po.total_amount - COALESCE(SUM(pi.total_amount), 0)) as remaining_amount,
      COUNT(pi.id) as invoice_count
    FROM purchase_orders po
    LEFT JOIN po_invoices pi ON po.id = pi.po_id
    WHERE 1=1
  `;
  const params = [];

  // Apply filters
  if (status && status !== "All") {
    query += " AND po.status = ?";
    params.push(status);
  }

  if (supplier) {
    query += " AND po.supplier_name LIKE ?";
    params.push(`%${supplier}%`);
  }

  if (po_number) {
    query += " AND po.po_number LIKE ?";
    params.push(`%${po_number}%`);
  }

  if (minAmount) {
    query += " AND po.total_amount >= ?";
    params.push(parseFloat(minAmount));
  }

  if (maxAmount) {
    query += " AND po.total_amount <= ?";
    params.push(parseFloat(maxAmount));
  }

  if (dateFrom) {
    query += " AND po.po_date >= ?";
    params.push(dateFrom);
  }

  if (dateTo) {
    query += " AND po.po_date <= ?";
    params.push(dateTo);
  }

  // Group by PO
  query +=
    " GROUP BY po.id, po.po_number, po.supplier_name, po.total_amount, po.status, po.po_date, po.created_at, po.updated_at";

  // Sorting
  const validSortFields = [
    "po_date",
    "po_number",
    "supplier_name",
    "total_amount",
    "status",
    "created_at",
  ];
  const validSortOrders = ["ASC", "DESC"];

  if (
    validSortFields.includes(sortBy) &&
    validSortOrders.includes(sortOrder.toUpperCase())
  ) {
    query += ` ORDER BY po.${sortBy} ${sortOrder.toUpperCase()}`;
  } else {
    query += " ORDER BY po.created_at DESC";
  }

  // Pagination
  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 50;
  const offset = (pageNum - 1) * limitNum;

  query += " LIMIT ? OFFSET ?";
  params.push(limitNum, offset);

  db.query(query, params, (err, results) => {
    if (err) {
      console.error("Error fetching purchase orders:", err);
      return res.status(500).json({
        error: "Failed to fetch purchase orders",
        data: [],
      });
    }

    // Handle empty table case
    if (!results || results.length === 0) {
      return res.json([]);
    }

    // Calculate remaining amounts and ensure they're not negative
    const processedResults = results.map((po) => ({
      ...po,
      remaining_amount: Math.max(0, po.remaining_amount || 0),
      is_fully_invoiced: po.remaining_amount <= 0,
    }));

    res.json(processedResults);
  });
});

// Get single purchase order by ID or PO number
app.get("/api/purchase-orders/:id", (req, res) => {
  const { id } = req.params;

  // Check if ID is numeric (database ID) or PO number format
  const isNumericId = /^\d+$/.test(id);
  const whereClause = isNumericId ? "po.id = ?" : "po.po_number = ?";

  const query = `
    SELECT 
      po.*,
      COALESCE(SUM(pi.total_amount), 0) as total_invoiced,
      (po.total_amount - COALESCE(SUM(pi.total_amount), 0)) as remaining_amount,
      COUNT(pi.id) as invoice_count
    FROM purchase_orders po
    LEFT JOIN po_invoices pi ON po.id = pi.po_id
    WHERE ${whereClause}
    GROUP BY po.id
  `;

  db.query(query, [id], (err, results) => {
    if (err) {
      console.error("Error fetching purchase order:", err);
      res.status(500).json({ error: "Failed to fetch purchase order" });
      return;
    }

    if (results.length === 0) {
      res.status(404).json({ error: "Purchase order not found" });
      return;
    }

    const po = results[0];
    // Ensure remaining_amount is not negative
    po.remaining_amount = Math.max(0, po.remaining_amount || 0);
    po.is_fully_invoiced = po.remaining_amount <= 0;

    // Now fetch the items for this PO
    const itemsQuery =
      "SELECT * FROM purchase_order_items WHERE purchase_order_id = ? ORDER BY item_no";
    db.query(itemsQuery, [po.id], (itemsErr, itemsResults) => {
      if (itemsErr) {
        console.error("Error fetching PO items:", itemsErr);
        console.error(
          "Note: If purchase_order_items table doesn't exist, please create it",
        );
        // Still return PO even if items fetch fails
        po.items = [];
      } else {
        // Handle NULL net_weight values
        po.items = itemsResults
          ? itemsResults.map((item) => ({
              ...item,
              net_weight: item.net_weight || 0,
            }))
          : [];
      }

      res.json(po);
    });
  });
});

// --- Categories Routes ---

// Get all categories with optional filtering
app.get("/api/categories", (req, res) => {
  const { name, description, type, status, page = 1, limit = 10 } = req.query;

  let query = `
    SELECT c.*, 
           COALESCE(e.expense_count, 0) as expense_count
    FROM categories c
    LEFT JOIN (
      SELECT category_id, COUNT(*) as expense_count 
      FROM expenses 
      GROUP BY category_id
    ) e ON c.id = e.category_id
    WHERE 1=1
  `;
  const params = [];

  // Apply filters
  if (name) {
    query += " AND c.name LIKE ?";
    params.push(`%${name}%`);
  }

  if (description) {
    query += " AND c.description LIKE ?";
    params.push(`%${description}%`);
  }

  if (type && type !== "All") {
    query += " AND c.type = ?";
    params.push(type);
  }

  if (status && status !== "All") {
    query += " AND c.status = ?";
    params.push(status);
  }

  // Count query for pagination
  const countQuery = query.replace(
    "SELECT c.*, COALESCE(e.expense_count, 0) as expense_count",
    "SELECT COUNT(DISTINCT c.id) as total",
  );

  // Add pagination
  const offset = (parseInt(page) - 1) * parseInt(limit);
  query += " ORDER BY c.created_date DESC LIMIT ? OFFSET ?";
  params.push(parseInt(limit), offset);

  // Execute count query first
  db.query(countQuery, params.slice(0, -2), (err, countResults) => {
    if (err) {
      console.error("Error counting categories:", err);
      res.status(500).json({ error: "Failed to count categories" });
      return;
    }

    const totalRecords = countResults[0] ? countResults[0].total : 0;
    const totalPages = Math.ceil(totalRecords / parseInt(limit));

    // Execute main query
    db.query(query, params, (err, results) => {
      if (err) {
        console.error("Error fetching categories:", err);
        res.status(500).json({ error: "Failed to fetch categories" });
        return;
      }

      res.json({
        data: results,
        pagination: {
          currentPage: parseInt(page),
          totalPages: totalPages,
          totalRecords: totalRecords,
          limit: parseInt(limit),
          hasNext: parseInt(page) < totalPages,
          hasPrev: parseInt(page) > 1,
        },
      });
    });
  });
});

// Get category statistics
app.get("/api/categories/stats", (req, res) => {
  const queries = [
    "SELECT COUNT(*) as total FROM categories",
    "SELECT COUNT(*) as active FROM categories WHERE status = 'Active'",
    "SELECT COUNT(*) as expense_categories FROM categories WHERE type = 'Expense'",
    "SELECT COALESCE(SUM(COALESCE(e.expense_count, 0)), 0) as total_expenses FROM categories c LEFT JOIN (SELECT category_id, COUNT(*) as expense_count FROM expenses GROUP BY category_id) e ON c.id = e.category_id",
  ];

  const executeQueries = async () => {
    try {
      const results = await Promise.all(
        queries.map(
          (query) =>
            new Promise((resolve, reject) => {
              db.query(query, (err, result) => {
                if (err) reject(err);
                else resolve(result[0] || {});
              });
            }),
        ),
      );

      const [total, active, expenseCategories, totalExpenses] = results;

      res.json({
        totalCategories: total.total || 0,
        activeCategories: active.active || 0,
        expenseCategories: expenseCategories.expense_categories || 0,
        totalExpenses: totalExpenses.total_expenses || 0,
        success: true,
      });
    } catch (error) {
      console.error("Error fetching category statistics:", error);
      res.status(500).json({
        error: "Failed to fetch category statistics",
        // Return default values in case of error
        totalCategories: 0,
        activeCategories: 0,
        expenseCategories: 0,
        totalExpenses: 0,
        success: false,
      });
    }
  };

  executeQueries();
});

// Create new category
app.post("/api/categories", (req, res) => {
  const { name, description, type = "Expense", status = "Active" } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Category name is required" });
  }

  const query = `
    INSERT INTO categories (name, description, type, status, created_date)
    VALUES (?, ?, ?, ?, CURDATE())
  `;

  db.query(query, [name, description, type, status], (err, result) => {
    if (err) {
      console.error("Error creating category:", err);
      if (err.code === "ER_DUP_ENTRY") {
        res
          .status(409)
          .json({ error: "Category with this name already exists" });
      } else {
        res.status(500).json({ error: "Failed to create category" });
      }
      return;
    }

    res.status(201).json({
      message: "Category created successfully",
      categoryId: result.insertId,
    });
  });
});

// Update category
app.put("/api/categories/:id", (req, res) => {
  const { id } = req.params;
  const { name, description, type, status } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Category name is required" });
  }

  const query = `
    UPDATE categories 
    SET name = ?, description = ?, type = ?, status = ?
    WHERE id = ?
  `;

  db.query(query, [name, description, type, status, id], (err, result) => {
    if (err) {
      console.error("Error updating category:", err);
      if (err.code === "ER_DUP_ENTRY") {
        res
          .status(409)
          .json({ error: "Category with this name already exists" });
      } else {
        res.status(500).json({ error: "Failed to update category" });
      }
      return;
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Category not found" });
    }

    res.json({ message: "Category updated successfully" });
  });
});

// Delete category
app.delete("/api/categories/:id", (req, res) => {
  const { id } = req.params;

  // First check if category has associated expenses
  const checkQuery =
    "SELECT COUNT(*) as expense_count FROM expenses WHERE category_id = ?";

  db.query(checkQuery, [id], (err, results) => {
    if (err) {
      console.error("Error checking category usage:", err);
      res.status(500).json({ error: "Failed to check category usage" });
      return;
    }

    const expenseCount = results[0].expense_count;
    if (expenseCount > 0) {
      return res.status(400).json({
        error: `Cannot delete category. It has ${expenseCount} associated expenses.`,
      });
    }

    // If no expenses, proceed with deletion
    const deleteQuery = "DELETE FROM categories WHERE id = ?";

    db.query(deleteQuery, [id], (err, result) => {
      if (err) {
        console.error("Error deleting category:", err);
        res.status(500).json({ error: "Failed to delete category" });
        return;
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Category not found" });
      }

      res.json({ message: "Category deleted successfully" });
    });
  });
});

// Get single category
app.get("/api/categories/:id", (req, res) => {
  const { id } = req.params;

  const query = `
    SELECT c.*, 
           COALESCE(e.expense_count, 0) as expense_count
    FROM categories c
    LEFT JOIN (
      SELECT category_id, COUNT(*) as expense_count 
      FROM expenses 
      WHERE category_id = ?
      GROUP BY category_id
    ) e ON c.id = e.category_id
    WHERE c.id = ?
  `;

  db.query(query, [id, id], (err, results) => {
    if (err) {
      console.error("Error fetching category:", err);
      res.status(500).json({ error: "Failed to fetch category" });
      return;
    }

    if (results.length === 0) {
      return res.status(404).json({ error: "Category not found" });
    }

    res.json(results[0]);
  });
});

// --- Company Settings Routes ---

// Get company settings
app.get("/api/company-settings", (req, res) => {
  const query = "SELECT * FROM company_settings WHERE id = 1";

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching company settings:", err);
      res.status(500).json({ error: "Failed to fetch company settings" });
      return;
    }

    if (results.length === 0) {
      // Return default settings if none exist
      res.json({
        company_name: "A Rauf Brother Textile",
        address:
          "Room No.205 Floor Saleha Chamber, Plot No. 8-9/C-1 Site, Karachi",
        email: "contact@araufbrothe.com",
        phone: "021-36404043",
        st_reg_no: "3253255666541",
        ntn_no: "7755266214-8",
        logo_path: "/assets/Logo/Logo.png",
      });
    } else {
      res.json(results[0]);
    }
  });
});

// Update company settings
app.put("/api/company-settings", (req, res) => {
  const { company_name, address, email, phone, st_reg_no, ntn_no, logo_path } =
    req.body;

  const query = `
    UPDATE company_settings 
    SET company_name = ?, address = ?, email = ?, phone = ?, st_reg_no = ?, ntn_no = ?, logo_path = ?
    WHERE id = 1
  `;

  db.query(
    query,
    [company_name, address, email, phone, st_reg_no, ntn_no, logo_path],
    (err, result) => {
      if (err) {
        console.error("Error updating company settings:", err);
        res.status(500).json({ error: "Failed to update company settings" });
        return;
      }

      if (result.affectedRows === 0) {
        // Insert if no record exists
        const insertQuery = `
        INSERT INTO company_settings (id, company_name, address, email, phone, st_reg_no, ntn_no, logo_path)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?)
      `;

        db.query(
          insertQuery,
          [company_name, address, email, phone, st_reg_no, ntn_no, logo_path],
          (err, result) => {
            if (err) {
              console.error("Error inserting company settings:", err);
              res
                .status(500)
                .json({ error: "Failed to create company settings" });
              return;
            }

            res.json({ message: "Company settings created successfully" });
          },
        );
      } else {
        res.json({ message: "Company settings updated successfully" });
      }
    },
  );
});

// --- Purchase Order Routes ---

// Get all purchase orders with optional filtering
app.get("/api/purchase-orders", (req, res) => {
  const { status, supplier, minAmount, maxAmount, startDate, endDate } =
    req.query;

  let query = "SELECT * FROM purchase_orders WHERE 1=1";
  const params = [];

  if (status && status !== "All") {
    query += " AND status = ?";
    params.push(status);
  }

  if (supplier) {
    query += " AND supplier_name LIKE ?";
    params.push(`%${supplier}%`);
  }

  if (minAmount) {
    query += " AND total_amount >= ?";
    params.push(parseFloat(minAmount));
  }

  if (maxAmount) {
    query += " AND total_amount <= ?";
    params.push(parseFloat(maxAmount));
  }

  if (startDate) {
    query += " AND po_date >= ?";
    params.push(startDate);
  }

  if (endDate) {
    query += " AND po_date <= ?";
    params.push(endDate);
  }

  query += " ORDER BY po_date DESC, created_at DESC";

  db.query(query, params, (err, results) => {
    if (err) {
      console.error("Error fetching purchase orders:", err.message);
      return res.status(500).json({
        message: "Failed to fetch purchase orders",
        error: err.message,
      });
    }
    res.json(results);
  });
});

// Get single purchase order by ID with its items
app.get("/api/purchase-orders/:id", (req, res) => {
  const { id } = req.params;

  // Check if the ID is numeric (database ID) or alphanumeric (PO number)
  const isNumericId = /^\d+$/.test(id);
  const whereCondition = isNumericId ? "id = ?" : "po_number = ?";

  // First get the purchase order
  const poQuery = `SELECT * FROM purchase_orders WHERE ${whereCondition}`;
  db.query(poQuery, [id], (err, poResults) => {
    if (err) {
      console.error("Error fetching purchase order:", err.message);
      return res.status(500).json({
        message: "Failed to fetch purchase order",
        error: err.message,
      });
    }

    if (poResults.length === 0) {
      return res.status(404).json({ message: "Purchase order not found" });
    }

    const purchaseOrder = poResults[0];
    const actualId = purchaseOrder.id; // Always use the numeric database ID for items lookup

    // Get purchase order items (if table exists)
    const itemsQuery =
      "SELECT * FROM purchase_order_items WHERE purchase_order_id = ? ORDER BY item_no";
    db.query(itemsQuery, [actualId], (err, itemsResults) => {
      if (err) {
        console.error("Error fetching purchase order items:", err);
        console.error(
          "Note: If purchase_order_items table doesn't exist, please run database_updates.sql",
        );
        // Still return PO even if items fetch fails
        return res.json({
          ...purchaseOrder,
          items: [],
          note: "Items table not available",
        });
      }

      // Combine purchase order with items and handle NULL net_weight values
      const itemsWithNetWeight = itemsResults
        ? itemsResults.map((item) => ({
            ...item,
            net_weight: item.net_weight || 0, // Convert NULL to 0
          }))
        : [];

      const poWithItems = {
        ...purchaseOrder,
        items: itemsWithNetWeight,
      };

      res.json(poWithItems);
    });
  });
});

// Create new purchase order with multiple items support
app.post("/api/purchase-orders", (req, res) => {
  logger.debug("Received PO creation request:", req.body); // Debug log

  const {
    po_number,
    po_date,
    supplier_name,
    supplier_email,
    supplier_phone,
    supplier_address,
    subtotal,
    tax_rate = 17,
    tax_amount,
    total_amount,
    currency = "PKR",
    status = "Pending",
    payment_days = 30,
    notes = "",
    items = [],
  } = req.body;

  // Validate required fields
  if (!po_number || !po_date || !supplier_name) {
    return res.status(400).json({
      message: "Missing required fields: po_number, po_date, supplier_name",
    });
  }

  // For multiple items, calculate total amount from items
  let calculatedSubtotal = subtotal;
  let calculatedTaxAmount = tax_amount;
  let calculatedTotal = total_amount;

  if (items && items.length > 0) {
    calculatedSubtotal = items.reduce(
      (sum, item) => sum + (item.amount || 0),
      0,
    );
    calculatedTaxAmount = calculatedSubtotal * (tax_rate / 100);
    calculatedTotal = calculatedSubtotal + calculatedTaxAmount;
  }

  // Start transaction for PO and items
  // Start transaction for PO and items - USING POOL
  db.getConnection((err, connection) => {
    if (err) {
      console.error("Error getting connection:", err);
      return res.status(500).json({
        message: "Failed to get database connection",
        error: err.message,
      });
    }

    connection.beginTransaction((err) => {
      if (err) {
        connection.release();
        console.error("Error starting transaction:", err);
        return res
          .status(500)
          .json({ message: "Failed to start transaction", error: err.message });
      }

      const query = `
      INSERT INTO purchase_orders (
        po_number, po_date, supplier_name, supplier_email, supplier_phone, supplier_address,
        subtotal, tax_rate, tax_amount, total_amount, currency, status, payment_days, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

      const values = [
        po_number,
        po_date,
        supplier_name,
        supplier_email || "",
        supplier_phone || "",
        supplier_address || "",
        calculatedSubtotal,
        tax_rate,
        calculatedTaxAmount,
        calculatedTotal,
        currency,
        status,
        payment_days,
        notes,
      ];

      connection.query(query, values, (err, result) => {
        if (err) {
          console.error("Error creating purchase order:", err.message);
          return connection.rollback(() => {
            connection.release();
            res.status(500).json({
              message: "Failed to create purchase order",
              error: err.message,
            });
          });
        }

        const poId = result.insertId;
        logger.info("Purchase order created with ID:", poId);

        // Insert PO items if provided
        if (items && items.length > 0) {
          const itemsQuery = `
          INSERT INTO purchase_order_items (purchase_order_id, item_no, description, quantity, unit, net_weight, unit_price, amount)
          VALUES ?
        `;

          const itemsValues = items.map((item) => [
            poId,
            item.item_no || 1,
            item.description || "",
            item.quantity || 1,
            item.unit || "pcs",
            item.net_weight || 0,
            item.unit_price || 0,
            item.amount || 0,
          ]);

          connection.query(itemsQuery, [itemsValues], (err, itemsResult) => {
            if (err) {
              console.error("Error creating PO items:", err);
              console.error(
                "Note: If purchase_order_items table doesn't exist, please run database_updates.sql",
              );
              // Still commit the PO even if items table doesn't exist
              return connection.commit((commitErr) => {
                if (commitErr) {
                  console.error("Error committing transaction:", commitErr);
                  return connection.rollback(() => {
                    connection.release();
                    res.status(500).json({
                      message: "Failed to commit transaction",
                      error: commitErr.message,
                    });
                  });
                }

                connection.release();
                logger.info(
                  "Purchase order created successfully (without items due to table error)",
                );
                res.status(201).json({
                  message: "Purchase order created successfully",
                  purchase_order: {
                    id: poId,
                    po_number,
                    po_date,
                    supplier_name,
                    supplier_email: supplier_email || "",
                    supplier_phone: supplier_phone || "",
                    supplier_address: supplier_address || "",
                    subtotal: calculatedSubtotal,
                    tax_rate,
                    tax_amount: calculatedTaxAmount,
                    total_amount: calculatedTotal,
                    currency,
                    status,
                    notes,
                    items_count: 0,
                    items: [],
                    note: "Items table not available - run database_updates.sql",
                  },
                });
              });
            }

            // Commit transaction and return success
            connection.commit((err) => {
              if (err) {
                console.error("Error committing transaction:", err);
                return connection.rollback(() => {
                  connection.release();
                  res.status(500).json({
                    message: "Failed to commit transaction",
                    error: err.message,
                  });
                });
              }

              connection.release();
              logger.info("Purchase order and items created successfully");
              res.status(201).json({
                message: "Purchase order created successfully",
                purchase_order: {
                  id: poId,
                  po_number,
                  po_date,
                  supplier_name,
                  supplier_email: supplier_email || "",
                  supplier_phone: supplier_phone || "",
                  supplier_address: supplier_address || "",
                  subtotal: calculatedSubtotal,
                  tax_rate,
                  tax_amount: calculatedTaxAmount,
                  total_amount: calculatedTotal,
                  currency,
                  status,
                  notes,
                  items_count: items.length,
                  items: items,
                },
              });
            });
          });
        } else {
          // No items, just commit PO
          connection.commit((err) => {
            if (err) {
              console.error("Error committing transaction:", err);
              return connection.rollback(() => {
                connection.release();
                res.status(500).json({
                  message: "Failed to commit transaction",
                  error: err.message,
                });
              });
            }

            connection.release();
            logger.info("Purchase order created successfully");
            res.status(201).json({
              message: "Purchase order created successfully",
              purchase_order: {
                id: poId,
                po_number,
                po_date,
                supplier_name,
                supplier_email: supplier_email || "",
                supplier_phone: supplier_phone || "",
                supplier_address: supplier_address || "",
                subtotal: calculatedSubtotal,
                tax_rate,
                tax_amount: calculatedTaxAmount,
                total_amount: calculatedTotal,
                currency,
                status,
                notes,
                items_count: 0,
                items: [],
              },
            });
          });
        }
      });
    });
  });
});

// Update purchase order
app.put("/api/purchase-orders/:id", (req, res) => {
  const id = req.params.id;

  // Check if the ID is numeric (database ID) or alphanumeric (PO number)
  const isNumericId = /^\d+$/.test(id);

  // If it's a PO number, we need to get the database ID first
  if (!isNumericId) {
    const getIdQuery = "SELECT id FROM purchase_orders WHERE po_number = ?";
    db.query(getIdQuery, [id], (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Failed to find purchase order",
          error: err.message,
        });
      }
      if (results.length === 0) {
        return res.status(404).json({ message: "Purchase order not found" });
      }
      const actualId = results[0].id;
      updatePurchaseOrder(actualId, req.body, res);
    });
  } else {
    updatePurchaseOrder(id, req.body, res);
  }
});

function updatePurchaseOrder(poId, requestBody, res) {
  const {
    po_number,
    po_date,
    supplier_name,
    supplier_email,
    supplier_phone,
    supplier_address,
    subtotal,
    tax_rate,
    tax_amount,
    total_amount,
    currency,
    status,
    payment_days = 30,
    notes,
    previous_status,
    items = [],
  } = requestBody;

  // Begin transaction for updating PO and items
  // Begin transaction for updating PO and items - USING POOL
  db.getConnection((err, connection) => {
    if (err) {
      console.error("Error getting connection:", err);
      return res.status(500).json({
        message: "Failed to get database connection",
        error: err.message,
      });
    }

    connection.beginTransaction((transactionErr) => {
      if (transactionErr) {
        connection.release();
        console.error("Error starting transaction:", transactionErr);
        return res.status(500).json({
          message: "Database transaction error",
          error: transactionErr.message,
        });
      }

      // Update purchase order
      const updatePOQuery = `
      UPDATE purchase_orders SET
        po_number = ?, po_date = ?, supplier_name = ?, supplier_email = ?, supplier_phone = ?,
        supplier_address = ?, subtotal = ?, tax_rate = ?, tax_amount = ?, total_amount = ?,
        currency = ?, status = ?, payment_days = ?, notes = ?, previous_status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;

      const updatePOValues = [
        po_number,
        po_date,
        supplier_name,
        supplier_email || "",
        supplier_phone || "",
        supplier_address || "",
        subtotal,
        tax_rate,
        tax_amount,
        total_amount,
        currency,
        status,
        payment_days,
        notes || "",
        previous_status || null,
        poId,
      ];

      connection.query(updatePOQuery, updatePOValues, (err, results) => {
        if (err) {
          console.error("Error updating purchase order:", err);
          return connection.rollback(() => {
            connection.release();
            res.status(500).json({
              message: "Failed to update purchase order",
              error: err.message,
            });
          });
        }

        if (results.affectedRows === 0) {
          return connection.rollback(() => {
            connection.release();
            res.status(404).json({ message: "Purchase order not found" });
          });
        }

        // Delete existing items
        const deleteItemsQuery =
          "DELETE FROM purchase_order_items WHERE purchase_order_id = ?";
        connection.query(deleteItemsQuery, [poId], (deleteErr) => {
          if (deleteErr) {
            console.error("Error deleting existing items:", deleteErr);
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({
                message: "Failed to update items",
                error: deleteErr.message,
              });
            });
          }

          // Insert new items if provided
          if (items && items.length > 0) {
            const itemsQuery = `
            INSERT INTO purchase_order_items (purchase_order_id, item_no, description, quantity, unit, net_weight, unit_price, amount)
            VALUES ?
          `;

            const itemsValues = items.map((item) => [
              poId,
              item.item_no || 1,
              item.description || "",
              item.quantity || 1,
              item.unit || "pcs",
              item.net_weight || 0,
              item.unit_price || 0,
              item.amount || 0,
            ]);

            connection.query(itemsQuery, [itemsValues], (itemsErr) => {
              if (itemsErr) {
                console.error("Error updating PO items:", itemsErr);
                return connection.rollback(() => {
                  connection.release();
                  res.status(500).json({
                    message: "Failed to update items",
                    error: itemsErr.message,
                  });
                });
              }

              // Commit transaction
              connection.commit((commitErr) => {
                if (commitErr) {
                  console.error("Error committing transaction:", commitErr);
                  return connection.rollback(() => {
                    connection.release();
                    res.status(500).json({
                      message: "Transaction commit failed",
                      error: commitErr.message,
                    });
                  });
                }

                connection.release();
                res.json({
                  message: "Purchase order updated successfully",
                  purchase_order: {
                    id: poId,
                    po_number,
                    po_date,
                    supplier_name,
                    supplier_email,
                    supplier_phone,
                    supplier_address,
                    subtotal,
                    tax_rate,
                    tax_amount,
                    total_amount,
                    currency,
                    status,
                    notes,
                    items,
                  },
                });
              });
            });
          } else {
            // No items to insert, just commit the PO update
            connection.commit((commitErr) => {
              if (commitErr) {
                console.error("Error committing transaction:", commitErr);
                return connection.rollback(() => {
                  connection.release();
                  res.status(500).json({
                    message: "Transaction commit failed",
                    error: commitErr.message,
                  });
                });
              }

              connection.release();
              res.json({
                message: "Purchase order updated successfully",
                purchase_order: {
                  id: poId,
                  po_number,
                  po_date,
                  supplier_name,
                  supplier_email,
                  supplier_phone,
                  supplier_address,
                  subtotal,
                  tax_rate,
                  tax_amount,
                  total_amount,
                  currency,
                  status,
                  notes,
                  items: [],
                },
              });
            });
          }
        });
      });
    });
  });
}

// Delete purchase order and related invoices
app.delete("/api/purchase-orders/:id", (req, res) => {
  const { id } = req.params;

  logger.info(`Deleting PO with ID: ${id}`);

  // Check if the ID is numeric (database ID) or alphanumeric (PO number)
  const isNumericId = /^\d+$/.test(id);
  const whereCondition = isNumericId ? "id = ?" : "po_number = ?";
  const poNumberCondition = isNumericId ? "po.id = ?" : "po.po_number = ?";

  // Start transaction to ensure data consistency
  // Start transaction to ensure data consistency - USING POOL
  db.getConnection((err, connection) => {
    if (err) {
      console.error("Error getting connection:", err);
      return res.status(500).json({
        error: "Failed to get database connection",
        details: err.message,
      });
    }

    connection.beginTransaction((err) => {
      if (err) {
        connection.release();
        console.error("Error starting transaction:", err);
        return res.status(500).json({
          error: "Failed to start transaction",
          details: err.message,
        });
      }

      // First, get PO details and related invoices
      const getPODetailsQuery = `
      SELECT po.*, 
             GROUP_CONCAT(pi.id) as invoice_ids,
             GROUP_CONCAT(pi.invoice_number) as invoice_numbers,
             COUNT(pi.id) as invoice_count
      FROM purchase_orders po
      LEFT JOIN po_invoices pi ON po.po_number = pi.po_number
      WHERE ${poNumberCondition}
      GROUP BY po.id
    `;

      connection.query(getPODetailsQuery, [id], (err, poResults) => {
        if (err) {
          console.error("Error fetching PO details:", err);
          return connection.rollback(() => {
            connection.release();
            res.status(500).json({
              error: "Failed to fetch PO details",
              details: err.message,
            });
          });
        }

        if (poResults.length === 0) {
          return connection.rollback(() => {
            connection.release();
            res.status(404).json({ error: "Purchase order not found" });
          });
        }

        const poData = poResults[0];
        const invoiceIds = poData.invoice_ids
          ? poData.invoice_ids.split(",")
          : [];

        logger.info(
          `PO ${poData.po_number} has ${poData.invoice_count} related invoices`,
        );

        // If there are related invoices, delete them first
        if (invoiceIds.length > 0 && invoiceIds[0] !== null) {
          // Create deletion history records for all related invoices
          const historyPromises = invoiceIds.map((invoiceId) => {
            return new Promise((resolve) => {
              const getInvoiceQuery = "SELECT * FROM po_invoices WHERE id = ?";
              connection.query(
                getInvoiceQuery,
                [invoiceId],
                (err, invoiceResults) => {
                  if (err) {
                    console.error(`Error fetching invoice ${invoiceId}:`, err);
                    resolve();
                    return;
                  }

                  if (invoiceResults.length > 0) {
                    const invoice = invoiceResults[0];
                    const historyQuery = `
                  INSERT INTO po_deletion_history (
                    po_invoice_id, invoice_number, po_number, customer_name, 
                    invoice_amount, invoice_date, deletion_date, deletion_reason, deleted_by
                  ) VALUES (?, ?, ?, ?, ?, ?, NOW(), 'PO permanently deleted', 'System User')
                `;

                    connection.query(
                      historyQuery,
                      [
                        invoice.id,
                        invoice.invoice_number,
                        invoice.po_number,
                        invoice.customer_name,
                        invoice.total_amount,
                        invoice.invoice_date,
                      ],
                      (err) => {
                        if (err) {
                          console.error(
                            `Error creating deletion history for invoice ${invoiceId}:`,
                            err,
                          );
                        }
                        resolve();
                      },
                    );
                  } else {
                    resolve();
                  }
                },
              );
            });
          });

          // Wait for all history records to be created
          Promise.all(historyPromises).then(() => {
            // Delete PO invoice items first
            const deleteInvoiceItemsQuery =
              "DELETE FROM po_invoice_items WHERE po_invoice_id IN (" +
              invoiceIds.map(() => "?").join(",") +
              ")";
            connection.query(deleteInvoiceItemsQuery, invoiceIds, (err) => {
              if (err) {
                console.error("Error deleting PO invoice items:", err);
                // Continue even if items deletion fails
              }

              // Delete PO invoices
              const deleteInvoicesQuery =
                "DELETE FROM po_invoices WHERE po_number = ?";
              connection.query(
                deleteInvoicesQuery,
                [poData.po_number],
                (err, invoiceDeleteResult) => {
                  if (err) {
                    console.error("Error deleting PO invoices:", err);
                    return connection.rollback(() => {
                      connection.release();
                      res.status(500).json({
                        error: "Failed to delete related invoices",
                        details: err.message,
                      });
                    });
                  }

                  logger.info(
                    `Deleted ${invoiceDeleteResult.affectedRows} invoices for PO ${poData.po_number}`,
                  );
                  deletePurchaseOrder();
                },
              );
            });
          });
        } else {
          // No invoices to delete, proceed with PO deletion
          deletePurchaseOrder();
        }

        function deletePurchaseOrder() {
          // Delete PO items first
          const deleteItemsQuery =
            "DELETE FROM purchase_order_items WHERE purchase_order_id = ?";
          connection.query(deleteItemsQuery, [poData.id], (err) => {
            if (err) {
              console.error("Error deleting PO items:", err);
              // Continue even if items deletion fails
            }

            // Delete PO summary
            const deleteSummaryQuery =
              "DELETE FROM po_invoice_summary WHERE po_number = ?";
            connection.query(deleteSummaryQuery, [poData.po_number], (err) => {
              if (err) {
                console.error("Error deleting PO summary:", err);
                // Continue even if summary deletion fails
              }

              // Finally, delete the PO itself
              const deletePOQuery = `DELETE FROM purchase_orders WHERE ${whereCondition}`;
              connection.query(deletePOQuery, [id], (err, results) => {
                if (err) {
                  console.error("Error deleting purchase order:", err);
                  return connection.rollback(() => {
                    connection.release();
                    res.status(500).json({
                      error: "Failed to delete purchase order",
                      details: err.message,
                    });
                  });
                }

                if (results.affectedRows === 0) {
                  return connection.rollback(() => {
                    connection.release();
                    res.status(404).json({ error: "Purchase order not found" });
                  });
                }

                // Commit the transaction
                connection.commit((err) => {
                  if (err) {
                    console.error("Error committing transaction:", err);
                    return connection.rollback(() => {
                      connection.release();
                      res.status(500).json({
                        error: "Failed to commit deletion transaction",
                        details: err.message,
                      });
                    });
                  }

                  connection.release();
                  logger.info(
                    `PO ${poData.po_number} and ${poData.invoice_count} related invoices deleted successfully`,
                  );

                  res.json({
                    message: "Purchase order deleted successfully",
                    deletedPO: {
                      po_number: poData.po_number,
                      invoices_deleted: poData.invoice_count,
                    },
                  });
                });
              });
            });
          });
        }
      });
    });
  });
});

// Bulk delete purchase orders
app.post("/api/purchase-orders/bulk-delete", (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res
        .status(400)
        .json({ error: "Invalid request: ids must be a non-empty array" });
    }

    const placeholders = ids.map(() => "?").join(",");

    // First delete related PO invoices and items
    const deleteInvoicesQuery = `DELETE FROM po_invoices WHERE po_number IN (SELECT po_number FROM purchase_orders WHERE id IN (${placeholders}))`;

    db.query(deleteInvoicesQuery, ids, (err) => {
      if (err) {
        console.error("Error deleting PO invoices:", err);
        return res.status(500).json({ error: "Failed to delete PO invoices" });
      }

      // Then delete POs
      const deleteQuery = `DELETE FROM purchase_orders WHERE id IN (${placeholders})`;

      db.query(deleteQuery, ids, (err, results) => {
        if (err) {
          console.error("Error bulk deleting purchase orders:", err);
          return res
            .status(500)
            .json({ error: "Failed to delete purchase orders" });
        }

        logger.info(`Bulk deleted ${results.affectedRows} purchase orders`);
        res.json({
          message: "Purchase orders deleted successfully",
          deletedCount: results.affectedRows,
        });
      });
    });
  } catch (error) {
    console.error("Error in bulk delete:", error);
    res.status(500).json({ error: "Failed to delete purchase orders" });
  }
});

// --- PO Invoice Routes ---

// Create invoice from PO
app.post("/api/po-invoices", (req, res) => {
  logger.debug("Creating PO invoice:", req.body);

  const {
    invoice_number,
    invoice_date,
    due_date,
    po_id,
    po_number,
    supplier_name,
    supplier_email,
    supplier_phone,
    supplier_address,
    subtotal,
    tax_rate,
    tax_amount,
    total_amount,
    currency = "PKR",
    status = "Not Sent",
    notes = "",
    items = [],
  } = req.body;

  // Map supplier fields to customer fields for database compatibility
  const customer_name = supplier_name;
  const customer_email = supplier_email;
  const customer_phone = supplier_phone;
  const customer_address = supplier_address;

  // Validate required fields
  if (!invoice_number || !invoice_date || !po_number || !supplier_name) {
    return res.status(400).json({
      message:
        "Missing required fields: invoice_number, invoice_date, po_number, supplier_name",
    });
  }

  // Get PO details to fetch payment_days and calculate due_date
  const getPODetailsAndCreateInvoice = (itemsToSave) => {
    const poQuery =
      "SELECT payment_days FROM purchase_orders WHERE po_number = ?";
    db.query(poQuery, [po_number], (err, poResults) => {
      if (err) {
        console.error("Error fetching PO details:", err);
        return res
          .status(500)
          .json({ message: "Failed to fetch PO details", error: err.message });
      }

      const payment_days =
        poResults.length > 0 ? poResults[0].payment_days || 30 : 30;

      // Calculate due_date: invoice_date + payment_days
      const invoiceDate = new Date(invoice_date);
      const calculatedDueDate = new Date(invoiceDate);
      calculatedDueDate.setDate(calculatedDueDate.getDate() + payment_days);
      const calculated_due_date = calculatedDueDate.toISOString().split("T")[0];

      createInvoiceWithItems(itemsToSave, payment_days, calculated_due_date);
    });
  };

  // Function to create invoice with resolved items
  const createInvoiceWithItems = (
    itemsToSave,
    payment_days,
    calculated_due_date,
  ) => {
    // Start transaction for invoice and items
    // Start transaction for invoice and items - USING POOL
    db.getConnection((err, connection) => {
      if (err) {
        console.error("Error getting connection:", err);
        return res.status(500).json({
          message: "Failed to get database connection",
          error: err.message,
        });
      }

      connection.beginTransaction((err) => {
        if (err) {
          connection.release();
          console.error("Error starting transaction:", err);
          return res.status(500).json({
            message: "Failed to start transaction",
            error: err.message,
          });
        }

        const query = `
      INSERT INTO po_invoices (
        invoice_number, invoice_date, due_date, po_id, po_number, customer_name, 
        customer_email, customer_phone, customer_address, subtotal, tax_rate, 
        tax_amount, total_amount, currency, status, payment_days, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

        const values = [
          invoice_number,
          invoice_date,
          calculated_due_date,
          po_id,
          po_number,
          customer_name,
          customer_email || "",
          customer_phone || "",
          customer_address || "",
          subtotal,
          tax_rate,
          tax_amount,
          total_amount,
          currency,
          status,
          payment_days,
          notes,
        ];

        connection.query(query, values, (err, result) => {
          if (err) {
            console.error("Error creating PO invoice:", err.message);

            if (
              err.code === "ER_DUP_ENTRY" &&
              err.sqlMessage.includes("invoice_number")
            ) {
              return connection.rollback(() => {
                connection.release();
                res.status(409).json({
                  message: `Invoice number ${invoice_number} already exists. Please try again with a different number.`,
                  error: "DUPLICATE_INVOICE_NUMBER",
                  suggestion:
                    "The system will generate a new unique number on refresh",
                });
              });
            }

            return connection.rollback(() => {
              connection.release();
              res.status(500).json({
                message: "Failed to create PO invoice",
                error: err.message,
              });
            });
          }

          const invoiceId = result.insertId;
          logger.info("PO invoice created with ID:", invoiceId);

          // Insert invoice items if provided
          if (itemsToSave && itemsToSave.length > 0) {
            const itemsQuery = `
          INSERT INTO po_invoice_items (po_invoice_id, po_item_id, item_no, description, quantity, net_weight, unit_price, amount)
          VALUES ?
        `;

            const itemsValues = itemsToSave.map((item, index) => [
              invoiceId,
              item.po_item_id || null,
              item.item_no || index + 1,
              item.description || "",
              item.quantity || 1,
              item.net_weight || 0,
              item.unitPrice || item.unit_price || 0,
              item.amount || 0,
            ]);

            connection.query(itemsQuery, [itemsValues], (err, itemsResult) => {
              if (err) {
                console.error("Error creating PO invoice items:", err);
                console.error(
                  "Note: If po_invoice_items table doesn't exist, please run database_update.sql",
                );

                // Still commit the invoice even if items table doesn't exist
                return connection.commit((commitErr) => {
                  if (commitErr) {
                    console.error("Error committing transaction:", commitErr);
                    return connection.rollback(() => {
                      connection.release();
                      res.status(500).json({
                        message: "Failed to commit transaction",
                        error: commitErr.message,
                      });
                    });
                  }

                  connection.release();
                  logger.info(
                    "PO invoice created successfully (without items due to table error)",
                  );
                  res.status(201).json({
                    message: "PO invoice created successfully",
                    invoice: {
                      id: invoiceId,
                      invoice_number,
                      po_number,
                      customer_name,
                      total_amount,
                      status,
                      items_count: 0,
                      note: "Items table not available - run database_update.sql",
                    },
                  });
                });
              }

              // Commit transaction and return success
              connection.commit((err) => {
                if (err) {
                  console.error("Error committing transaction:", err);
                  return connection.rollback(() => {
                    connection.release();
                    res.status(500).json({
                      message: "Failed to commit transaction",
                      error: err.message,
                    });
                  });
                }

                connection.release();
                logger.info("PO invoice and items created successfully");
                res.status(201).json({
                  message: "PO invoice created successfully",
                  invoice: {
                    id: invoiceId,
                    invoice_number,
                    po_number,
                    customer_name,
                    total_amount,
                    status,
                    items_count: itemsToSave.length,
                  },
                });
              });
            });
          } else {
            // No items, just commit invoice
            connection.commit((err) => {
              if (err) {
                console.error("Error committing transaction:", err);
                return connection.rollback(() => {
                  connection.release();
                  res.status(500).json({
                    message: "Failed to commit transaction",
                    error: err.message,
                  });
                });
              }

              connection.release();
              logger.info("PO invoice created successfully");
              res.status(201).json({
                message: "PO invoice created successfully",
                invoice: {
                  id: invoiceId,
                  invoice_number,
                  po_number,
                  customer_name,
                  total_amount,
                  status,
                },
              });
            });
          }
        });
      });
    });
  };

  // If no items provided, fetch items from the Purchase Order
  if (!items || items.length === 0) {
    logger.debug(`No items provided, fetching from PO: ${po_number}`);

    const fetchPOItemsQuery = `
      SELECT 
        poi.id as po_item_id,
        poi.item_no,
        poi.description,
        poi.quantity,
        COALESCE(poi.net_weight, 0) as net_weight,
        poi.unit_price,
        poi.amount
      FROM purchase_order_items poi
      JOIN purchase_orders po ON poi.purchase_order_id = po.id
      WHERE po.po_number = ?
      ORDER BY poi.item_no
    `;

    db.query(fetchPOItemsQuery, [po_number], (err, poItems) => {
      if (err) {
        console.error("Error fetching PO items:", err);
        // Continue with empty items if fetch fails
        createInvoiceWithItems([]);
      } else {
        logger.info(`Found ${poItems.length} items in PO ${po_number}`);
        createInvoiceWithItems(poItems || []);
      }
    });
  } else {
    // Use provided items
    createInvoiceWithItems(items);
  }
});

// Get single PO invoice by ID with its items
app.get("/api/po-invoices/:id", (req, res) => {
  const { id } = req.params;

  // First get the PO invoice
  const invoiceQuery = "SELECT * FROM po_invoices WHERE id = ?";
  db.query(invoiceQuery, [id], (err, invoiceResults) => {
    if (err) {
      console.error("Error fetching PO invoice:", err);
      res.status(500).json({ error: "Failed to fetch invoice" });
      return;
    }
    if (invoiceResults.length === 0) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    const invoice = invoiceResults[0];

    // Get PO invoice items (use linked purchase_order_items.net_weight when pii.net_weight is NULL)
    const itemsQuery = `
      SELECT
        pii.id,
        pii.po_invoice_id,
        pii.po_item_id,
        pii.item_no,
        COALESCE(pii.description, poi.description) as description,
        pii.po_quantity,
        pii.invoiced_quantity,
        pii.remaining_quantity,
        pii.unit,
        COALESCE(pii.net_weight, poi.net_weight, 0) as net_weight,
        pii.unit_price,
        pii.amount,
        pii.created_at,
        pii.updated_at
      FROM po_invoice_items pii
      LEFT JOIN purchase_order_items poi ON pii.po_item_id = poi.id
      WHERE pii.po_invoice_id = ?
      ORDER BY pii.item_no
    `;

    db.query(itemsQuery, [id], (err, itemsResults) => {
      if (err) {
        console.error("Error fetching PO invoice items:", err);
        logger.info(
          "Note: If po_invoice_items table doesn't exist, returning invoice without items",
        );
        // Still return invoice even if items fetch fails
        return res.json({
          ...invoice,
          items: [],
        });
      }

      // If no items found in po_invoice_items, try to get items from original PO
      if (!itemsResults || itemsResults.length === 0) {
        // First try to get items from purchase_order_items table (preferred)
        const poItemsQuery = `
          SELECT
            poi.item_no,
            poi.description,
            poi.quantity,
            COALESCE(poi.net_weight, 0) as net_weight,
            poi.unit_price,
            poi.amount,
            CONCAT('Supplier: ', po.supplier_name, ' - As per PO specifications') as specifications
          FROM purchase_order_items poi
          JOIN purchase_orders po ON poi.purchase_order_id = po.id
          WHERE po.po_number = ?
          ORDER BY poi.item_no
        `;

        db.query(poItemsQuery, [invoice.po_number], (err2, poItemsResults) => {
          if (err2) {
            console.error(
              "Error fetching PO items from purchase_order_items:",
              err2,
            );

            // Fallback: get basic info from purchase_orders table
            const fallbackQuery = `
              SELECT 
                1 as item_no,
                COALESCE(notes, 'Items as per purchase order agreement') as description,
                1 as quantity,
                total_amount as unit_price,
                total_amount as amount,
                CONCAT('Supplier: ', supplier_name, ' - As per PO specifications') as specifications
              FROM purchase_orders 
              WHERE po_number = ?
            `;

            db.query(
              fallbackQuery,
              [invoice.po_number],
              (err3, fallbackResults) => {
                if (err3) {
                  console.error("Error fetching PO fallback items:", err3);
                  return res.json({
                    ...invoice,
                    items: [],
                  });
                }

                const invoiceWithItems = {
                  ...invoice,
                  items: fallbackResults || [],
                };

                res.json(invoiceWithItems);
              },
            );
          } else if (poItemsResults && poItemsResults.length > 0) {
            // Return invoice with actual PO items
            const invoiceWithItems = {
              ...invoice,
              items: poItemsResults,
            };

            res.json(invoiceWithItems);
          } else {
            // No items found in purchase_order_items, use fallback
            const fallbackQuery = `
              SELECT 
                1 as item_no,
                'Items as per purchase order agreement' as description,
                1 as quantity,
                total_amount as unit_price,
                total_amount as amount,
                CONCAT('Supplier: ', supplier_name, ' - As per PO specifications') as specifications
              FROM purchase_orders 
              WHERE po_number = ?
            `;

            db.query(
              fallbackQuery,
              [invoice.po_number],
              (err3, fallbackResults) => {
                if (err3) {
                  console.error("Error fetching PO fallback items:", err3);
                  return res.json({
                    ...invoice,
                    items: [],
                  });
                }

                const invoiceWithItems = {
                  ...invoice,
                  items: fallbackResults || [],
                };

                res.json(invoiceWithItems);
              },
            );
          }
        });
      } else {
        // Combine invoice with items
        const invoiceWithItems = {
          ...invoice,
          items: itemsResults || [],
        };

        res.json(invoiceWithItems);
      }
    });
  });
});

// Update PO invoice status
app.put("/api/po-invoices/:id", (req, res) => {
  const { id } = req.params;
  const { status, payment_date, notes } = req.body;

  if (!status) {
    return res.status(400).json({ message: "Status is required" });
  }

  let query =
    "UPDATE po_invoices SET status = ?, updated_at = CURRENT_TIMESTAMP";
  let params = [status];

  // Add payment_date if provided (when marking as paid)
  if (payment_date) {
    query += ", payment_date = ?";
    params.push(payment_date);
  }

  // Add notes if provided
  if (notes !== undefined) {
    query += ", notes = ?";
    params.push(notes);
  }

  query += " WHERE id = ?";
  params.push(id);

  db.query(query, params, (err, result) => {
    if (err) {
      console.error("Error updating PO invoice:", err.message);
      return res
        .status(500)
        .json({ message: "Failed to update invoice", error: err.message });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    // Get the updated invoice to return
    const selectQuery = "SELECT * FROM po_invoices WHERE id = ?";
    db.query(selectQuery, [id], (err, results) => {
      if (err) {
        console.error("Error fetching updated invoice:", err.message);
        return res.status(500).json({
          message: "Invoice updated but failed to retrieve details",
          error: err.message,
        });
      }

      const updatedInvoice = results[0];

      // ✅ If status changed to 'Paid', create payment ledger entry (DEBIT - we pay supplier)
      if (status === "Paid" && updatedInvoice) {
        (async () => {
          try {
            // Try to find customer_id by matching supplier name from purchase_orders with customer entries
            // First, check if customer already exists by name
            let customer_id = null;

            // Method 1: Look for an existing customer with matching name to supplier
            const [custByNameResults] = await db
              .promise()
              .query(
                "SELECT customer_id FROM customertable WHERE customer = ? OR company = ? LIMIT 1",
                [updatedInvoice.customer_name, updatedInvoice.customer_name],
              );

            if (custByNameResults && custByNameResults.length > 0) {
              customer_id = custByNameResults[0].customer_id;
            } else {
              // Method 2: If no customer found, try to get from PO data - might be stored in customer_name field
              logger.warn(
                `⚠️ No customer_id found for supplier: ${updatedInvoice.customer_name}. Skipping ledger entry creation.`,
              );
              return; // Skip ledger creation if we can't find a customer
            }

            if (!customer_id) {
              logger.warn(
                `⚠️ Cannot create payment entries: No customer found for ${updatedInvoice.invoice_number}`,
              );
              return;
            }

            // First, ensure original PO invoice ledger entries exist (in case they weren't created during invoice creation)
            const [checkResults] = await db.promise().query(
              `
              SELECT COUNT(*) as entry_count FROM ledger_entries 
              WHERE customer_id = ? AND bill_no = ? AND debit_amount > 0
            `,
              [customer_id, updatedInvoice.invoice_number],
            );

            if (
              checkResults &&
              checkResults[0] &&
              checkResults[0].entry_count === 0
            ) {
              logger.warn(
                `⚠️ Original PO invoice entries missing for ${updatedInvoice.invoice_number}, creating now...`,
              );
              // Create the original ledger entries that should have been created during invoice creation
              await createLedgerEntriesForPOInvoice({
                customer_id: customer_id,
                invoice_number: updatedInvoice.invoice_number,
                invoice_date:
                  updatedInvoice.invoice_date ||
                  new Date().toISOString().split("T")[0],
                due_date: updatedInvoice.due_date,
                total_amount: parseFloat(updatedInvoice.total_amount),
                tax_rate: parseFloat(updatedInvoice.tax_rate),
                tax_amount: parseFloat(updatedInvoice.tax_amount),
                status: "Draft",
                currency: updatedInvoice.currency || "PKR",
                customer_name: updatedInvoice.customer_name,
              });
              logger.info(
                `✅ Missing PO invoice ledger entries created for ${updatedInvoice.invoice_number}`,
              );
            }

            // Now proceed with payment entries
            await createLedgerEntryForPayment({
              customer_id: customer_id,
              payment_date:
                payment_date || new Date().toISOString().split("T")[0],
              description: `Payment - PO Invoice ${updatedInvoice.invoice_number}`,
              reference_no: updatedInvoice.invoice_number,
              payment_mode: "Cash", // Could be passed in request
              transaction_id: null,
              amount: parseFloat(updatedInvoice.total_amount),
              subtotal: parseFloat(updatedInvoice.subtotal),
              tax_amount: parseFloat(updatedInvoice.tax_amount),
              tax_rate: parseFloat(updatedInvoice.tax_rate),
              invoice_type: "po_invoice",
              invoice_number: updatedInvoice.invoice_number,
            });
            logger.info(
              `✅ Payment ledger entries successfully created for PO invoice ${updatedInvoice.invoice_number}`,
            );
          } catch (err) {
            logger.error(
              "Error processing PO invoice payment ledger entries:",
              err,
            );
          }
        })();
      }

      res.json({
        message: "Invoice updated successfully",
        invoice: updatedInvoice,
      });
    });
  });
});

// Get all invoices for a specific PO with enhanced tracking
app.get("/api/purchase-orders/:poNumber/invoices", (req, res) => {
  const { poNumber } = req.params;

  // First, ensure PO total amount is synced in summary table
  const syncQuery = `
    INSERT INTO po_invoice_summary (po_number, po_total_amount, total_invoiced_amount, remaining_amount, invoice_count)
    SELECT 
      po.po_number,
      po.total_amount,
      COALESCE(SUM(pi.total_amount), 0),
      po.total_amount - COALESCE(SUM(pi.total_amount), 0),
      COUNT(pi.id)
    FROM purchase_orders po
    LEFT JOIN po_invoices pi ON po.po_number = pi.po_number
    WHERE po.po_number = ?
    GROUP BY po.po_number, po.total_amount
    ON DUPLICATE KEY UPDATE
      po_total_amount = VALUES(po_total_amount),
      total_invoiced_amount = VALUES(total_invoiced_amount),
      remaining_amount = VALUES(remaining_amount),
      invoice_count = VALUES(invoice_count),
      updated_at = CURRENT_TIMESTAMP
  `;

  db.query(syncQuery, [poNumber], (syncErr) => {
    if (syncErr) {
      console.error("Error syncing PO summary:", syncErr.message);
      // Continue anyway - don't fail the request
    }

    // Now get the invoices with summary data
    const query = `
      SELECT 
        pi.*,
        pis.po_total_amount,
        pis.total_invoiced_amount,
        pis.remaining_amount,
        pis.invoice_count
      FROM po_invoices pi
      LEFT JOIN po_invoice_summary pis ON pi.po_number = pis.po_number
      WHERE pi.po_number = ?
      ORDER BY pi.created_at DESC
    `;

    db.query(query, [poNumber], (err, results) => {
      if (err) {
        console.error("Error fetching PO invoices:", err.message);
        return res
          .status(500)
          .json({ message: "Failed to fetch PO invoices", error: err.message });
      }
      res.json(results);
    });
  });
});

// Get PO invoice summary
app.get("/api/purchase-orders/:poNumber/invoice-summary", (req, res) => {
  const { poNumber } = req.params;

  const query = "SELECT * FROM po_invoice_summary WHERE po_number = ?";

  db.query(query, [poNumber], (err, results) => {
    if (err) {
      console.error("Error fetching PO invoice summary:", err.message);
      return res.status(500).json({
        message: "Failed to fetch PO invoice summary",
        error: err.message,
      });
    }

    if (results.length === 0) {
      // Return default summary if no invoices exist yet
      return res.json({
        po_number: poNumber,
        po_total_amount: 0,
        total_invoiced_amount: 0,
        remaining_amount: 0,
        invoice_count: 0,
        last_invoice_date: null,
      });
    }

    res.json(results[0]);
  });
});

// Get all PO summaries for invoice tracking
app.get("/api/po-summaries", (req, res) => {
  const query = `
    SELECT 
      po_number,
      po_total_amount,
      total_invoiced_amount,
      remaining_amount,
      invoice_count,
      last_invoice_date,
      created_at,
      updated_at
    FROM po_invoice_summary 
    ORDER BY updated_at DESC
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching PO summaries:", err);
      return res.status(500).json({
        message: "Failed to fetch PO summaries",
        error: err.message,
        data: [],
      });
    }

    // Return empty array if no PO summaries exist
    res.json(results || []);
  });
});
// Delete PO invoice with proper tracking and history
app.delete("/api/po-invoices/:id", (req, res) => {
  const { id } = req.params;

  logger.info(`Deleting PO invoice with ID: ${id}`);

  // Get the PO invoice details before deletion for tracking (no transaction needed)
  const getInvoiceQuery = `
    SELECT 
      pi.*,
      po.po_number as po_number_check,
      po.total_amount as po_total_amount
    FROM po_invoices pi
    LEFT JOIN purchase_orders po ON pi.po_number = po.po_number
    WHERE pi.id = ?
  `;

  db.query(getInvoiceQuery, [id], (err, invoiceResults) => {
    if (err) {
      console.error("Error fetching PO invoice for deletion:", err);
      return res.status(500).json({
        message: "Failed to fetch invoice for deletion",
        error: err.message,
      });
    }

    if (invoiceResults.length === 0) {
      return res.status(404).json({ message: "PO invoice not found" });
    }

    const invoiceToDelete = invoiceResults[0];
    logger.debug("Invoice to delete:", invoiceToDelete);

    // Create deletion history record before actual deletion
    const historyQuery = `
      INSERT INTO po_deletion_history (
        po_invoice_id,
        invoice_number,
        po_number,
        customer_name,
        invoice_amount,
        invoice_date,
        deletion_date,
        deletion_reason,
        deleted_by
      ) VALUES (?, ?, ?, ?, ?, ?, NOW(), 'Manual deletion via system', 'System User')
    `;

    db.query(
      historyQuery,
      [
        invoiceToDelete.id,
        invoiceToDelete.invoice_number,
        invoiceToDelete.po_number,
        invoiceToDelete.customer_name,
        invoiceToDelete.total_amount,
        invoiceToDelete.invoice_date,
      ],
      (err, historyResult) => {
        if (err) {
          console.error(
            "Error creating deletion history (table might not exist):",
            err,
          );
          // Continue with deletion even if history table doesn't exist
        } else {
          logger.info("Deletion history recorded successfully");
        }

        // Delete related invoice items first
        const deleteItemsQuery =
          "DELETE FROM po_invoice_items WHERE po_invoice_id = ?";
        db.query(deleteItemsQuery, [id], (err, itemsResult) => {
          if (err) {
            console.error("Error deleting PO invoice items:", err);
            // Continue even if items deletion fails (table might not exist)
          }

          // Now delete the main PO invoice
          const deleteInvoiceQuery = "DELETE FROM po_invoices WHERE id = ?";
          db.query(deleteInvoiceQuery, [id], (err, deleteResult) => {
            if (err) {
              console.error("Error deleting PO invoice:", err);
              return res.status(500).json({
                message: "Failed to delete PO invoice",
                error: err.message,
              });
            }

            if (deleteResult.affectedRows === 0) {
              return res.status(404).json({ message: "PO invoice not found" });
            }

            logger.info("PO invoice deleted successfully");

            // Update PO summary to reflect the deletion
            const updateSummaryQuery = `
            INSERT INTO po_invoice_summary (
              po_number, 
              po_total_amount, 
              total_invoiced_amount, 
              remaining_amount, 
              invoice_count, 
              last_invoice_date
            )
            SELECT 
              ?,
              COALESCE(?, 0),
              COALESCE(SUM(pi.total_amount), 0),
              COALESCE(?, 0) - COALESCE(SUM(pi.total_amount), 0),
              COUNT(pi.id),
              MAX(pi.invoice_date)
            FROM po_invoices pi
            WHERE pi.po_number = ?
            ON DUPLICATE KEY UPDATE
              po_total_amount = COALESCE(VALUES(po_total_amount), po_total_amount),
              total_invoiced_amount = VALUES(total_invoiced_amount),
              remaining_amount = VALUES(remaining_amount),
              invoice_count = VALUES(invoice_count),
              last_invoice_date = VALUES(last_invoice_date),
              updated_at = CURRENT_TIMESTAMP
          `;

            db.query(
              updateSummaryQuery,
              [
                invoiceToDelete.po_number,
                invoiceToDelete.po_total_amount,
                invoiceToDelete.po_total_amount,
                invoiceToDelete.po_number,
              ],
              (err, summaryResult) => {
                if (err) {
                  console.error(
                    "Error updating PO summary after deletion:",
                    err,
                  );
                  // Don't fail the entire operation for summary update issues
                } else {
                  logger.info("PO summary updated after deletion");
                }

                logger.info("PO invoice deletion completed successfully");

                // Return success response with deletion details
                res.json({
                  message: "PO invoice deleted successfully",
                  deletedInvoice: {
                    id: invoiceToDelete.id,
                    invoice_number: invoiceToDelete.invoice_number,
                    po_number: invoiceToDelete.po_number,
                    customer_name: invoiceToDelete.customer_name,
                    amount: invoiceToDelete.total_amount,
                    deletion_date: new Date().toISOString(),
                  },
                  poUpdate: {
                    po_number: invoiceToDelete.po_number,
                    amount_restored: invoiceToDelete.total_amount,
                    message: `${invoiceToDelete.total_amount} has been restored to PO remaining amount`,
                  },
                });
              },
            );
          });
        });
      },
    );
  });
});

// Get all invoice numbers for ID generation
app.get("/api/invoice-numbers", (req, res) => {
  const regularInvoicesQuery = "SELECT invoice_number FROM invoice";
  const poInvoicesQuery = "SELECT invoice_number FROM po_invoices";

  Promise.all([
    new Promise((resolve, reject) => {
      db.query(regularInvoicesQuery, (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    }),
    new Promise((resolve, reject) => {
      db.query(poInvoicesQuery, (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    }),
  ])
    .then(([regularInvoices, poInvoices]) => {
      const allInvoiceNumbers = [...regularInvoices, ...poInvoices];
      res.json(allInvoiceNumbers);
    })
    .catch((error) => {
      console.error("Error fetching invoice numbers:", error);
      res.status(500).json({
        message: "Failed to fetch invoice numbers",
        error: error.message,
      });
    });
});

// --- Settings Routes ---

// Get user settings
app.get("/api/settings/:userId", (req, res) => {
  const userId = req.params.userId || 1; // Default to user 1

  logger.debug(`Fetching settings for user: ${userId}`);

  // Query users and user_settings separately and merge safely. This avoids SQL errors if one table
  // doesn't have all columns and also ensures we return sensible fallbacks.
  const userQuery = `SELECT * FROM users WHERE id = ? LIMIT 1`;
  const settingsQuery = `SELECT * FROM user_settings WHERE user_id = ? LIMIT 1`;

  // Execute both queries in parallel
  db.query(userQuery, [userId], (uErr, uResults) => {
    if (uErr) {
      logger.error("Error fetching user:", uErr);
      return res.status(500).json({
        success: false,
        message: "Error fetching user",
        error: uErr.message,
      });
    }

    if (!uResults || uResults.length === 0) {
      logger.warn(`User not found: ${userId}`);
      // Return default empty settings instead of 404
      return res.json({
        success: true,
        data: {
          personal: {
            firstName: "",
            lastName: "",
            email: "",
            phone: "",
            company: "A Rauf Textile",
            address: "",
            profilePicture: null,
            profilePictureUrl: null,
          },
          security: {
            twoFactorEnabled: false,
            loginNotifications: true,
          },
        },
      });
    }

    const user = uResults[0] || {};

    db.query(settingsQuery, [userId], (sErr, sResults) => {
      if (sErr) {
        logger.error("Error fetching user_settings:", sErr);
        // Do not fail completely; return user info with empty settings
      }

      const us = sResults && sResults[0] ? sResults[0] : {};

      // Prefer explicit user_settings values, fall back to users table when available
      const personal = {
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        email: user.email || "",
        phone: us.phone || user.phone || "",
        company: us.company || user.company || "A Rauf Textile",
        address: us.address || user.address || "",
        profilePicture:
          us.profile_picture_url || user.profile_picture_url || null,
        profilePictureUrl: (() => {
          const pic = us.profile_picture_url || user.profile_picture_url;
          if (!pic) return null;
          // If it's an absolute URL (Cloudinary), return as-is. Otherwise, return the local proxy path.
          return pic.startsWith("http")
            ? pic
            : `/api/profile-picture/view/${pic}`;
        })(),
      };

      const security = {
        twoFactorEnabled:
          typeof us.two_factor_enabled !== "undefined"
            ? us.two_factor_enabled === 1
            : !!user.two_factor_enabled,
        loginNotifications:
          typeof us.email_notifications !== "undefined"
            ? us.email_notifications === 1
            : !!user.email_notifications,
      };

      logger.debug(`Settings found for user ${userId}`);
      res.json({ success: true, data: { personal, security } });
    });
  });
});

// --- Lightweight Header Endpoint ---
// GET user header info (optimized for Header component - only essential fields)
app.get("/api/user/header/:userId", (req, res) => {
  const userId = req.params.userId || 1;

  // Single optimized query - join users and user_settings, select only needed fields
  const query = `
    SELECT 
      u.firstName,
      u.lastName,
      u.email,
      COALESCE(us.company, u.company) AS company,
      COALESCE(us.phone, u.phone) AS phone,
      COALESCE(us.profile_picture_url, u.profile_picture_url) AS profile_picture_url
    FROM users u
    LEFT JOIN user_settings us ON u.id = us.user_id
    WHERE u.id = ?
    LIMIT 1
  `;

  db.query(query, [userId], (err, results) => {
    if (err) {
      console.error("Error fetching header data:", err);
      return res.status(500).json({
        success: false,
        message: "Error fetching user header information",
      });
    }

    if (!results || results.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const user = results[0];

    // Build response with clean field names
    const headerData = {
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      fullName: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
      email: user.email || "",
      company: user.company || "",
      phone: user.phone || "",
      profilePictureUrl: (() => {
        const pic = user.profile_picture_url;
        if (!pic) return null;
        return pic.startsWith("http")
          ? pic
          : `/api/profile-picture/view/${pic}`;
      })(),
    };

    res.json({
      success: true,
      data: headerData,
    });
  });
});

// Update user settings
app.post("/api/settings/:userId", (req, res) => {
  const userId = req.params.userId || 1;
  const { personal, security, password } = req.body;

  let completedOperations = 0;
  let totalOperations = 0;
  let hasError = false;
  let errorMessage = "";

  // Count total operations
  if (personal) totalOperations++;
  if (personal || security) totalOperations++;
  if (password && password.newPassword) totalOperations++;

  // If no operations, return success
  if (totalOperations === 0) {
    return res.json({ success: true, message: "No changes to update" });
  }

  const checkCompletion = () => {
    completedOperations++;
    if (completedOperations === totalOperations) {
      if (hasError) {
        return res.status(500).json({ success: false, message: errorMessage });
      }
      res.json({ success: true, message: "Settings updated successfully" });
    }
  };

  // Update user basic info
  if (personal) {
    const updateUserQuery = `
      UPDATE users 
      SET firstName = ?, lastName = ?, email = ?
      WHERE id = ?
    `;

    db.query(
      updateUserQuery,
      [personal.firstName, personal.lastName, personal.email, userId],
      (err) => {
        if (err) {
          console.error("Error updating user:", err);
          hasError = true;
          errorMessage = "Error updating user info";
        }
        checkCompletion();
      },
    );
  }

  // Update or insert user settings
  if (personal || security) {
    const upsertSettingsQuery = `
      INSERT INTO user_settings (user_id, phone, company, address, two_factor_enabled, email_notifications)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
      phone = VALUES(phone),
      company = VALUES(company), 
      address = VALUES(address),
      two_factor_enabled = VALUES(two_factor_enabled),
      email_notifications = VALUES(email_notifications)
    `;

    const settingsValues = [
      userId,
      personal?.phone || "",
      personal?.company || "",
      personal?.address || "",
      security?.twoFactorEnabled ? 1 : 0,
      security?.loginNotifications ? 1 : 0,
    ];

    db.query(upsertSettingsQuery, settingsValues, (err) => {
      if (err) {
        console.error("Error updating settings:", err);
        hasError = true;
        errorMessage = "Error updating settings";
      }
      checkCompletion();
    });
  }

  // Update password if provided
  if (password && password.newPassword) {
    const updatePasswordQuery = "UPDATE users SET password = ? WHERE id = ?";
    db.query(updatePasswordQuery, [password.newPassword, userId], (err) => {
      if (err) {
        console.error("Error updating password:", err);
        hasError = true;
        errorMessage = "Error updating password";
      }
      checkCompletion();
    });
  }
});

// Get user's accessible modules based on their role
app.get("/api/user-modules/:userId", (req, res) => {
  const userId = req.params.userId;

  // First, get user's role
  const userQuery = "SELECT role_id FROM users WHERE id = ?";
  db.query(userQuery, [userId], (err, results) => {
    if (err) {
      console.error("Error fetching user:", err);
      return res
        .status(500)
        .json({ success: false, message: "Error fetching user" });
    }

    if (!results || results.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const roleId = results[0].role_id;

    // If user has no role, return empty modules
    if (!roleId) {
      return res.json({ success: true, data: [] });
    }

    // Get modules for the user's role
    const modulesQuery =
      "SELECT module FROM role_modules WHERE role_id = ? ORDER BY module ASC";
    db.query(modulesQuery, [roleId], (moduleErr, modules) => {
      if (moduleErr) {
        console.error("Error fetching user modules:", moduleErr);
        return res
          .status(500)
          .json({ success: false, message: "Error fetching modules" });
      }

      const moduleList = (modules || []).map((m) => m.module);
      res.json({ success: true, data: moduleList });
    });
  });
});

// ================================================================================
// QUANTITY-BASED INVOICING API ENDPOINTS
// ================================================================================

// Get PO items with quantity tracking for invoice creation
app.get("/api/purchase-orders/:id/items/quantity-tracking", (req, res) => {
  const { id } = req.params;

  // Check if ID is numeric (database ID) or PO number format
  const isNumericId = /^\d+$/.test(id);
  const whereClause = isNumericId ? "po.id = ?" : "po.po_number = ?";

  const query = `
    SELECT 
      poi.id as po_item_id,
      poi.purchase_order_id as po_id,
      po.po_number,
      poi.item_no,
      poi.description,
      poi.quantity as po_quantity,
      poi.unit,
      poi.net_weight,
      poi.unit_price,
      poi.amount as po_amount,
      
      -- Calculate already invoiced quantities for this item
      COALESCE(SUM(pii.invoiced_quantity), 0) as total_invoiced_quantity,
      
      -- Calculate remaining quantity for this item
      (poi.quantity - COALESCE(SUM(pii.invoiced_quantity), 0)) as remaining_quantity,
      
      -- Calculate percentage invoiced for this item
      CASE 
        WHEN poi.quantity > 0 
        THEN (COALESCE(SUM(pii.invoiced_quantity), 0) / poi.quantity) * 100
        ELSE 0 
      END as item_invoicing_percentage,
      
      -- Item invoicing status
      CASE 
        WHEN COALESCE(SUM(pii.invoiced_quantity), 0) = 0 THEN 'Not Invoiced'
        WHEN (poi.quantity - COALESCE(SUM(pii.invoiced_quantity), 0)) <= 0 THEN 'Fully Invoiced'
        ELSE 'Partially Invoiced'
      END as item_status,
      
      -- Count of invoices for this item
      COUNT(pii.id) as invoice_count
      
    FROM purchase_order_items poi
    LEFT JOIN purchase_orders po ON poi.purchase_order_id = po.id
    LEFT JOIN po_invoice_items pii ON poi.id = pii.po_item_id
    WHERE ${whereClause}
    GROUP BY poi.id, poi.purchase_order_id, po.po_number, poi.item_no, poi.description, 
             poi.quantity, poi.unit, poi.unit_price, poi.amount
    ORDER BY poi.item_no
  `;

  db.query(query, [id], (err, results) => {
    if (err) {
      console.error("Error fetching PO item quantity tracking:", err);
      res
        .status(500)
        .json({ error: "Failed to fetch PO item quantity tracking" });
      return;
    }

    res.json(results);
  });
});

// Get quantity-based summary for a PO
app.get("/api/purchase-orders/:id/quantity-summary", (req, res) => {
  const { id } = req.params;

  // Check if ID is numeric (database ID) or PO number format
  const isNumericId = /^\d+$/.test(id);
  const whereClause = isNumericId ? "po.id = ?" : "po.po_number = ?";

  const query = `
    SELECT 
      po.id as po_id,
      po.po_number,
      po.supplier_name,
      po.total_amount as po_total_amount,
      po.status as po_status,
      
      -- PO Total Quantities
      COALESCE(SUM(poi.quantity), 0) as po_total_quantity,
      
      -- Amount-based invoicing summary
      COALESCE(SUM(
        CASE WHEN pi.invoicing_mode = 'amount' 
        THEN pi.total_amount 
        ELSE 0 END
      ), 0) as amount_invoiced,
      
      (po.total_amount - COALESCE(SUM(
        CASE WHEN pi.invoicing_mode = 'amount' 
        THEN pi.total_amount 
        ELSE 0 END
      ), 0)) as amount_remaining,
      
      -- Quantity-based invoicing summary
      COALESCE(SUM(
        CASE WHEN pi.invoicing_mode IN ('quantity', 'mixed') 
        THEN pi.invoiced_quantity 
        ELSE 0 END
      ), 0) as quantity_invoiced,
      
      (COALESCE(SUM(poi.quantity), 0) - COALESCE(SUM(
        CASE WHEN pi.invoicing_mode IN ('quantity', 'mixed') 
        THEN pi.invoiced_quantity 
        ELSE 0 END
      ), 0)) as quantity_remaining,
      
      -- Percentage calculations
      CASE 
        WHEN po.total_amount > 0 
        THEN (COALESCE(SUM(
          CASE WHEN pi.invoicing_mode = 'amount' 
          THEN pi.total_amount 
          ELSE 0 END
        ), 0) / po.total_amount) * 100
        ELSE 0 
      END as amount_invoicing_percentage,
      
      CASE 
        WHEN COALESCE(SUM(poi.quantity), 0) > 0 
        THEN (COALESCE(SUM(
          CASE WHEN pi.invoicing_mode IN ('quantity', 'mixed') 
          THEN pi.invoiced_quantity 
          ELSE 0 END
        ), 0) / SUM(poi.quantity)) * 100
        ELSE 0 
      END as quantity_invoicing_percentage,
      
      -- Invoice counts
      COUNT(CASE WHEN pi.invoicing_mode = 'amount' THEN pi.id END) as amount_invoice_count,
      COUNT(CASE WHEN pi.invoicing_mode IN ('quantity', 'mixed') THEN pi.id END) as quantity_invoice_count,
      
      -- Status determination
      CASE 
        WHEN COUNT(DISTINCT pi.invoicing_mode) > 1 THEN 'Mixed Invoicing'
        WHEN COUNT(CASE WHEN pi.invoicing_mode = 'amount' THEN 1 END) > 0 THEN 'Amount Based'
        WHEN COUNT(CASE WHEN pi.invoicing_mode IN ('quantity', 'mixed') THEN 1 END) > 0 THEN 'Quantity Based'
        ELSE 'Not Invoiced'
      END as invoicing_type
      
    FROM purchase_orders po
    LEFT JOIN purchase_order_items poi ON po.id = poi.purchase_order_id
    LEFT JOIN po_invoices pi ON po.id = pi.po_id
    WHERE ${whereClause}
    GROUP BY po.id, po.po_number, po.supplier_name, po.total_amount, po.status
  `;

  db.query(query, [id], (err, results) => {
    if (err) {
      console.error("Error fetching PO quantity summary:", err);
      res.status(500).json({ error: "Failed to fetch PO quantity summary" });
      return;
    }

    if (results.length === 0) {
      res.status(404).json({ error: "Purchase order not found" });
      return;
    }

    const summary = results[0];

    // Ensure no negative values
    summary.amount_remaining = Math.max(0, summary.amount_remaining);
    summary.quantity_remaining = Math.max(0, summary.quantity_remaining);

    res.json(summary);
  });
});

// Create quantity-based invoice
// Wrapper function to get PO details and create quantity-based invoice
async function getPODetailsAndCreateQuantityBasedInvoice(req, res) {
  const { po_id, invoice_date } = req.body;

  // Get payment_days from original PO
  const query = "SELECT payment_days FROM purchase_orders WHERE id = ?";
  db.query(query, [po_id], (err, results) => {
    if (err) {
      console.error("Error fetching PO payment_days:", err);
      return res.status(500).json({ error: "Failed to fetch PO details" });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: "Purchase order not found" });
    }

    const payment_days = results[0].payment_days || 30;

    // Calculate due_date
    const invoiceDate = new Date(invoice_date || new Date());
    const dueDate = new Date(invoiceDate);
    dueDate.setDate(dueDate.getDate() + payment_days);
    const calculated_due_date = dueDate.toISOString().split("T")[0];

    console.log(
      `PO ${po_id} payment_days: ${payment_days}, calculated due_date: ${calculated_due_date}`,
    );

    // Call the actual creation function with calculated values
    createQuantityBasedInvoiceWithItems(
      req,
      res,
      payment_days,
      calculated_due_date,
    );
  });
}

async function createQuantityBasedInvoiceWithItems(
  req,
  res,
  payment_days,
  calculated_due_date,
) {
  const {
    invoice_number,
    invoice_date,
    due_date, // This will be ignored in favor of calculated_due_date
    po_id,
    po_number,
    customer_name,
    customer_email,
    customer_phone,
    customer_address,
    currency,
    status,
    notes,
    tax_rate, // Tax rate from PO
    tax_amount, // Tax amount from PO
    items, // Array of { po_item_id, invoiced_quantity }
  } = req.body;

  // Validate required fields
  if (
    !po_id ||
    !invoice_number ||
    !customer_name ||
    !items ||
    !Array.isArray(items) ||
    items.length === 0
  ) {
    console.error("Quantity-based invoice validation failed:", {
      po_id: !!po_id,
      invoice_number: !!invoice_number,
      customer_name: !!customer_name,
      items_provided: !!items,
      items_is_array: Array.isArray(items),
      items_length: items ? items.length : 0,
    });

    return res.status(400).json({
      error: "Missing required fields for quantity-based invoice",
      required: [
        "po_id",
        "invoice_number",
        "customer_name",
        "items (array with at least 1 item)",
      ],
      received: {
        po_id: !!po_id,
        invoice_number: !!invoice_number,
        customer_name: !!customer_name,
        items_count: items ? items.length : 0,
      },
    });
  }

  console.log(
    `Creating quantity-based invoice for PO ${po_id} with ${items.length} items:`,
    items.map((item) => ({
      po_item_id: item.po_item_id,
      quantity: item.invoiced_quantity,
    })),
  );

  console.log("🔍 [DEBUG] Request body received at backend:", {
    po_id,
    invoice_number,
    customer_name,
    tax_rate: req.body.tax_rate,
    tax_amount: req.body.tax_amount,
    items_count: items.length,
  });

  // Start transaction
  // Start transaction - USING POOL
  db.getConnection((err, connection) => {
    if (err) {
      console.error("Error getting connection:", err);
      return res.status(500).json({
        error: "Failed to get database connection",
        details: err.message,
      });
    }

    connection.beginTransaction((transactionErr) => {
      if (transactionErr) {
        connection.release();
        console.error("Transaction start error:", transactionErr);
        return res.status(500).json({
          error: "Failed to start transaction",
          details: transactionErr.message,
        });
      }

      // FETCH TAX FROM PO TABLE
      const poTaxQuery = `
      SELECT tax_rate, tax_amount 
      FROM purchase_orders 
      WHERE id = ?
    `;

      console.log(
        "🔍 [DEBUG] Fetching tax from PO with po_id:",
        po_id,
        "Type:",
        typeof po_id,
      );

      connection.query(poTaxQuery, [po_id], (taxErr, taxResults) => {
        if (taxErr) {
          console.error("Error fetching tax from PO:", taxErr);
          // Don't fail - just use the values from request body
        }

        console.log("📊 [DEBUG] Tax query result:", {
          error: taxErr ? taxErr.message : "none",
          resultsLength: taxResults ? taxResults.length : 0,
          results: taxResults,
        });

        let finalTaxRate = parseFloat(tax_rate) || 0;
        let finalTaxAmount = parseFloat(tax_amount) || 0;

        console.log("💾 [DEBUG] Initial tax values from request:", {
          tax_rate: parseFloat(tax_rate),
          tax_amount: parseFloat(tax_amount),
        });

        if (taxResults && taxResults.length > 0) {
          finalTaxRate = parseFloat(taxResults[0].tax_rate) || finalTaxRate;
          finalTaxAmount =
            parseFloat(taxResults[0].tax_amount) || finalTaxAmount;
          console.log("✅ [DEBUG] Tax fetched from PO table:", {
            tax_rate: finalTaxRate,
            tax_amount: finalTaxAmount,
          });
        } else {
          console.log(
            "⚠️ [DEBUG] Could not fetch tax from PO, using request body values:",
            { tax_rate: finalTaxRate, tax_amount: finalTaxAmount },
          );
        }

        // Step 1: Validate quantities and get item details
        const itemValidationPromises = items.map((item) => {
          return new Promise((resolve, reject) => {
            const itemQuery = `
            SELECT 
              poi.id,
              poi.description,
              poi.quantity as po_quantity,
              poi.unit,
              COALESCE(poi.net_weight, 0) as net_weight,
              poi.unit_price,
              poi.amount as po_amount,
              COALESCE(SUM(pii.invoiced_quantity), 0) as already_invoiced
            FROM purchase_order_items poi
            LEFT JOIN po_invoice_items pii ON poi.id = pii.po_item_id
            WHERE poi.id = ? AND poi.purchase_order_id = ?
            GROUP BY poi.id
          `;

            connection.query(
              itemQuery,
              [item.po_item_id, po_id],
              (err, results) => {
                if (err) {
                  return reject(err);
                }

                if (results.length === 0) {
                  return reject(
                    new Error(`PO item ${item.po_item_id} not found`),
                  );
                }

                const poItem = results[0];
                const requestedQty = parseFloat(item.invoiced_quantity) || 0;
                const availableQty =
                  poItem.po_quantity - poItem.already_invoiced;

                if (requestedQty <= 0) {
                  return reject(
                    new Error(
                      `Invalid quantity for item "${poItem.description}" (ID: ${item.po_item_id}): ${requestedQty}. Quantity must be greater than 0.`,
                    ),
                  );
                }

                if (requestedQty > availableQty) {
                  return reject(
                    new Error(
                      `Insufficient quantity for item "${poItem.description}". Available: ${availableQty}, Requested: ${requestedQty}. Please reduce the quantity or check if this item was already invoiced.`,
                    ),
                  );
                }

                console.log(
                  `✓ Item validated - ${poItem.description}: ${requestedQty}/${availableQty} available`,
                );

                const totalNetWeight = poItem.net_weight || 0;
                const netWeightPerUnit =
                  poItem.po_quantity > 0
                    ? totalNetWeight / poItem.po_quantity
                    : 0;
                const invoicedNetWeight = requestedQty * netWeightPerUnit;

                resolve({
                  ...poItem,
                  invoiced_quantity: requestedQty,
                  remaining_quantity:
                    poItem.po_quantity - poItem.already_invoiced - requestedQty,
                  item_amount: requestedQty * poItem.unit_price,
                  net_weight: invoicedNetWeight,
                });
              },
            );
          });
        });

        // Validate all items
        Promise.all(itemValidationPromises)
          .then((validatedItems) => {
            const totalQuantity = validatedItems.reduce(
              (sum, item) => sum + item.invoiced_quantity,
              0,
            );
            const subtotal = validatedItems.reduce(
              (sum, item) => sum + item.item_amount,
              0,
            );

            const poQuery = `SELECT COALESCE(SUM(quantity), 0) as po_total_qty FROM purchase_order_items WHERE purchase_order_id = ?`;
            connection.query(poQuery, [po_id], (poErr, poResults) => {
              if (poErr) {
                console.error("Error fetching PO total quantity:", poErr);
                return connection.rollback(() => {
                  connection.release();
                  res.status(500).json({
                    error: "Failed to calculate tax",
                    details: poErr.message,
                  });
                });
              }

              const poTotalQty = poResults[0]?.po_total_qty || 1;
              const invoicedQtyProportion = totalQuantity / poTotalQty;

              let invoiceTaxRate = finalTaxRate;
              let invoiceTaxAmount = finalTaxAmount * invoicedQtyProportion;

              console.log(
                `Tax recalculation: PO qty=${poTotalQty}, invoiced qty=${totalQuantity}, proportion=${invoicedQtyProportion.toFixed(2)}, original tax=${finalTaxAmount}, adjusted tax=${invoiceTaxAmount.toFixed(2)}`,
              );

              const totalAmount = subtotal + invoiceTaxAmount;

              const invoiceQuery = `
            INSERT INTO po_invoices (
              po_id, po_number, invoice_number, customer_name, customer_email, 
              customer_phone, customer_address, invoice_date, due_date, 
              subtotal, tax_rate, tax_amount, total_amount, currency, 
              invoicing_mode, invoiced_quantity, payment_days, notes, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;

              const invoiceValues = [
                po_id,
                po_number,
                invoice_number,
                customer_name,
                customer_email || "",
                customer_phone || "",
                customer_address || "",
                invoice_date || new Date().toISOString().split("T")[0],
                calculated_due_date,
                subtotal,
                invoiceTaxRate,
                invoiceTaxAmount,
                totalAmount,
                currency || "PKR",
                "quantity",
                totalQuantity,
                payment_days,
                notes || "",
                status || "Draft",
              ];

              connection.query(
                invoiceQuery,
                invoiceValues,
                (invoiceErr, invoiceResult) => {
                  if (invoiceErr) {
                    return connection.rollback(() => {
                      connection.release();
                      console.error(
                        "Error creating quantity-based invoice:",
                        invoiceErr,
                      );
                      res.status(500).json({
                        error: "Failed to create invoice",
                        details: invoiceErr.message,
                      });
                    });
                  }

                  const invoiceId = invoiceResult.insertId;

                  const itemInsertPromises = validatedItems.map(
                    (item, index) => {
                      return new Promise((resolve, reject) => {
                        const itemQuery = `
                  INSERT INTO po_invoice_items (
                    po_invoice_id, po_item_id, item_no, description,
                    po_quantity, invoiced_quantity, remaining_quantity,
                    unit, net_weight, unit_price, amount
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;

                        const itemValues = [
                          invoiceId,
                          item.id,
                          index + 1,
                          item.description,
                          item.po_quantity,
                          item.invoiced_quantity,
                          item.remaining_quantity,
                          item.unit,
                          item.net_weight || 0,
                          item.unit_price,
                          item.item_amount,
                        ];

                        connection.query(
                          itemQuery,
                          itemValues,
                          (itemErr, itemResult) => {
                            if (itemErr) {
                              return reject(itemErr);
                            }
                            resolve(itemResult);
                          },
                        );
                      });
                    },
                  );

                  Promise.all(itemInsertPromises)
                    .then(() => {
                      connection.commit((commitErr) => {
                        if (commitErr) {
                          return connection.rollback(() => {
                            connection.release();
                            console.error(
                              "Transaction commit error:",
                              commitErr,
                            );
                            res
                              .status(500)
                              .json({ error: "Failed to commit transaction" });
                          });
                        }

                        connection.release();
                        console.log(
                          `✅ Quantity-based invoice created successfully: ${invoice_number}`,
                        );

                        const getCustomerQuery =
                          "SELECT customer_id FROM purchase_orders WHERE po_number = ? LIMIT 1";
                        db.query(
                          getCustomerQuery,
                          [po_number],
                          (custErr, custResults) => {
                            if (
                              custErr ||
                              !custResults ||
                              custResults.length === 0
                            ) {
                              logger.warn(
                                "⚠️ Could not find customer_id for PO invoice ledger entry",
                              );
                            } else {
                              const po_customer_id = custResults[0].customer_id;

                              createLedgerEntriesForPOInvoice({
                                customer_id: po_customer_id,
                                invoice_number,
                                invoice_date:
                                  invoice_date ||
                                  new Date().toISOString().split("T")[0],
                                due_date: calculated_due_date,
                                total_amount: totalAmount,
                                tax_rate: invoiceTaxRate,
                                tax_amount: invoiceTaxAmount,
                                status: status || "Draft",
                                currency: currency || "PKR",
                                customer_name,
                              }).catch((ledgerErr) => {
                                logger.error(
                                  "Failed to create ledger entry for PO invoice:",
                                  ledgerErr,
                                );
                              });
                            }
                          },
                        );

                        res.status(201).json({
                          id: invoiceId,
                          message:
                            "Quantity-based invoice created successfully",
                          details: {
                            items_processed: validatedItems.length,
                            total_po_items: items.length,
                            total_quantity: totalQuantity,
                            subtotal: subtotal,
                            tax_rate: invoiceTaxRate,
                            tax_amount: invoiceTaxAmount,
                            total_amount: totalAmount,
                          },
                          invoice: {
                            id: invoiceId,
                            invoice_number,
                            po_number,
                            customer_name,
                            invoicing_mode: "quantity",
                            total_quantity: totalQuantity,
                            subtotal: subtotal,
                            tax_rate: invoiceTaxRate,
                            tax_amount: invoiceTaxAmount,
                            total_amount: totalAmount,
                            items: validatedItems.map((item) => ({
                              po_item_id: item.id,
                              description: item.description,
                              invoiced_quantity: item.invoiced_quantity,
                              remaining_quantity: item.remaining_quantity,
                              amount: item.item_amount,
                            })),
                            status,
                          },
                        });
                      });
                    })
                    .catch((itemInsertErr) => {
                      connection.rollback(() => {
                        connection.release();
                        console.error(
                          "Error inserting invoice items:",
                          itemInsertErr,
                        );
                        res.status(500).json({
                          error: "Failed to create invoice items",
                          details: itemInsertErr.message,
                        });
                      });
                    });
                },
              );
            });
          })
          .catch((validationErr) => {
            connection.rollback(() => {
              connection.release();
              console.error("Item validation error:", validationErr);
              res.status(400).json({
                error: "Item validation failed",
                details: validationErr.message,
              });
            });
          });
      });
    });
  });
}

// Route handler for quantity-based invoices
app.post(
  "/api/po-invoices/quantity-based",
  getPODetailsAndCreateQuantityBasedInvoice,
);

// Get invoice items for a specific invoice
app.get("/api/po-invoices/:id/items", (req, res) => {
  const { id } = req.params;

  const query = `
    SELECT
      pii.id,
      pii.po_invoice_id,
      pii.po_item_id,
      pii.item_no,
      COALESCE(pii.description, poi.description) as description,
      pii.po_quantity,
      pii.invoiced_quantity,
      pii.remaining_quantity,
      pii.unit,
      COALESCE(pii.net_weight, poi.net_weight, 0) as net_weight,
      pii.unit_price,
      pii.amount,
      pii.created_at,
      pii.updated_at,
      poi.quantity as original_po_quantity
    FROM po_invoice_items pii
    LEFT JOIN purchase_order_items poi ON pii.po_item_id = poi.id
    WHERE pii.po_invoice_id = ?
    ORDER BY pii.item_no
  `;

  db.query(query, [id], (err, results) => {
    if (err) {
      console.error("Error fetching invoice items:", err);
      res.status(500).json({ error: "Failed to fetch invoice items" });
      return;
    }

    res.json(results);
  });
});

// Update invoice item quantity (for editing quantity-based invoices)
app.put("/api/po-invoice-items/:id", (req, res) => {
  const { id } = req.params;
  const { invoiced_quantity } = req.body;

  if (!invoiced_quantity || invoiced_quantity <= 0) {
    return res.status(400).json({ error: "Invalid invoiced quantity" });
  }

  // Start transaction
  // Start transaction - USING POOL
  db.getConnection((err, connection) => {
    if (err) {
      console.error("Error getting connection:", err);
      return res
        .status(500)
        .json({ error: "Failed to get database connection" });
    }

    connection.beginTransaction((transactionErr) => {
      if (transactionErr) {
        connection.release();
        console.error("Transaction start error:", transactionErr);
        return res.status(500).json({ error: "Failed to start transaction" });
      }

      // Get current item details for validation
      const getItemQuery = `
      SELECT 
        pii.*,
        poi.quantity as po_quantity,
        (
          SELECT COALESCE(SUM(other_pii.invoiced_quantity), 0) 
          FROM po_invoice_items other_pii 
          WHERE other_pii.po_item_id = pii.po_item_id 
          AND other_pii.id != pii.id
        ) as other_invoiced_quantity
      FROM po_invoice_items pii
      LEFT JOIN purchase_order_items poi ON pii.po_item_id = poi.id
      WHERE pii.id = ?
    `;

      connection.query(getItemQuery, [id], (err, results) => {
        if (err || results.length === 0) {
          return connection.rollback(() => {
            connection.release();
            console.error("Error fetching invoice item:", err);
            res.status(500).json({ error: "Invoice item not found" });
          });
        }

        const item = results[0];
        const newQuantity = parseFloat(invoiced_quantity);
        const availableQuantity =
          item.po_quantity - item.other_invoiced_quantity;

        if (newQuantity > availableQuantity) {
          return connection.rollback(() => {
            connection.release();
            res.status(400).json({
              error: "Insufficient quantity available",
              available: availableQuantity,
              requested: newQuantity,
            });
          });
        }

        // Update the invoice item
        const newAmount = newQuantity * item.unit_price;
        const newRemainingQuantity =
          item.po_quantity - item.other_invoiced_quantity - newQuantity;

        const updateQuery = `
        UPDATE po_invoice_items 
        SET invoiced_quantity = ?, amount = ?, remaining_quantity = ?
        WHERE id = ?
      `;

        connection.query(
          updateQuery,
          [newQuantity, newAmount, newRemainingQuantity, id],
          (updateErr) => {
            if (updateErr) {
              return connection.rollback(() => {
                connection.release();
                console.error("Error updating invoice item:", updateErr);
                res
                  .status(500)
                  .json({ error: "Failed to update invoice item" });
              });
            }

            connection.commit((commitErr) => {
              if (commitErr) {
                return connection.rollback(() => {
                  connection.release();
                  console.error("Transaction commit error:", commitErr);
                  res
                    .status(500)
                    .json({ error: "Failed to commit transaction" });
                });
              }

              connection.release();
              res.json({
                message: "Invoice item updated successfully",
                item: {
                  id,
                  invoiced_quantity: newQuantity,
                  amount: newAmount,
                  remaining_quantity: newRemainingQuantity,
                },
              });
            });
          },
        );
      });
    });
  });
});

// Database migration endpoint - Fix NULL net_weight values
app.post("/api/fix-net-weight", (req, res) => {
  console.log("Starting net_weight migration...");

  // Update NULL net_weight values to 0
  const updateQuery = `
    UPDATE purchase_order_items 
    SET net_weight = 0 
    WHERE net_weight IS NULL
  `;

  db.query(updateQuery, (err, result) => {
    if (err) {
      console.error("Error updating net_weight values:", err);
      return res.status(500).json({
        message: "Failed to update net_weight values",
        error: err.message,
      });
    }

    console.log(
      `Updated ${result.affectedRows} records with NULL net_weight values`,
    );
    res.json({
      message: `Successfully updated ${result.affectedRows} records`,
      affectedRows: result.affectedRows,
    });
  });
});

// --- Start Server ---
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  logger.info(`🚀 Server running on http://localhost:${PORT}`);
});

// Graceful server error handling
server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    logger.error(
      `🔌 Port ${PORT} already in use. Make sure the server is not already running or change the PORT.`,
    );
    process.exit(1);
  } else {
    logger.error("Server error:", err);
    process.exit(1);
  }
});

// Handle SIGINT / SIGTERM gracefully
process.on("SIGINT", () => {
  logger.info("SIGINT received, shutting down server gracefully.");
  server.close(() => {
    logger.info("Server stopped.");
    // Close database connection pool
    if (db) {
      db.end((err) => {
        if (err) {
          logger.error("Error closing database pool:", err);
        } else {
          logger.info("Database connection pool closed.");
        }
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  });
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down server gracefully.");
  server.close(() => {
    logger.info("Server stopped.");
    // Close database connection pool
    if (db) {
      db.end((err) => {
        if (err) {
          logger.error("Error closing database pool:", err);
        } else {
          logger.info("Database connection pool closed.");
        }
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  });
});

// Handle uncaught exceptions
process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception:", err);
  // Close database gracefully before exiting
  if (db) {
    db.end(() => {
      process.exit(1);
    });
  } else {
    process.exit(1);
  }
});
