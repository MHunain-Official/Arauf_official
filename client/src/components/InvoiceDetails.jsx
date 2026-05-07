import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Download, Printer } from "lucide-react";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import Logo from "../assets/Logo/rauf textile png.png";
import { API_ENDPOINTS } from "../config/api";

// Number to Words Converter
const numberToWords = (num) => {
  if (num === 0) return "Zero";

  const ones = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
  ];
  const tens = [
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
  ];
  const teens = [
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];

  const convertHundreds = (n) => {
    if (n === 0) return "";
    if (n < 10) return ones[n];
    if (n < 20) return teens[n - 10];
    if (n < 100)
      return (
        tens[Math.floor(n / 10)] + (n % 10 !== 0 ? " " + ones[n % 10] : "")
      );
    return (
      ones[Math.floor(n / 100)] +
      " Hundred" +
      (n % 100 !== 0 ? " " + convertHundreds(n % 100) : "")
    );
  };

  const convertThousands = (n) => {
    if (n === 0) return "";
    if (n < 1000) return convertHundreds(n);
    if (n < 100000)
      return (
        convertHundreds(Math.floor(n / 1000)) +
        " Thousand" +
        (n % 1000 !== 0 ? " " + convertHundreds(n % 1000) : "")
      );
    if (n < 10000000)
      return (
        convertHundreds(Math.floor(n / 100000)) +
        " Lakh" +
        (n % 100000 !== 0 ? " " + convertThousands(n % 100000) : "")
      );
    return (
      convertHundreds(Math.floor(n / 10000000)) +
      " Crore" +
      (n % 10000000 !== 0 ? " " + convertThousands(n % 10000000) : "")
    );
  };

  const [intPart, decPart] = num.toString().split(".");
  let words = convertThousands(parseInt(intPart));

  if (decPart && parseInt(decPart) > 0) {
    words +=
      " and " +
      convertHundreds(parseInt(decPart.padEnd(2, "0").slice(0, 2))) +
      " Paisa";
  }

  return words;
};

const InvoiceDetailsLayoutImproved = () => {
  const { id, type } = useParams();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showPaymentHistory, setShowPaymentHistory] = useState(false);
  const invoiceRef = useRef();
  const isPOInvoice = type === "po";
  const displayInvoiceNumber = invoice?.invoice_number
    ? String(invoice.invoice_number).trim()
    : isPOInvoice
      ? `PO-${id}`
      : `INV-${id}`;

  // PDF Generation Function - FIXED VERSION
  const generatePDF = () => {
    try {
      const printWindow = window.open("", "_blank", "width=800,height=600");

      if (!printWindow) {
        alert(
          "Pop-up blocked. Please allow pop-ups for this site to generate PDF.",
        );
        return;
      }

      const printHTML = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Invoice ${displayInvoiceNumber}</title>
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            
            body {
              font-family: Arial, sans-serif;
              background: white;
              color: #333;
              line-height: 1.5;
              padding: 0;
              margin: 0;
            }
            
            .invoice-container {
              max-width: 900px;
              margin: 0 auto;
              background: white;
              border: 1px solid #666;
              position: relative;
            }
            
            /* FIXED: Watermark styling */
            .print-watermark {
              position: fixed;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%) rotate(-14deg);
              width: 65%;
              max-width: 820px;
              height: auto;
              opacity: 0.06;
              pointer-events: none;
              z-index: 0;
              display: block;
            }
            
            .content {
              position: relative;
              z-index: 1;
            }
            
            .title-section {
              text-align: center;
              padding: 10px;
              border-bottom: 1px solid #999;
            }
            
            .title-section h1 {
              font-size: 18px;
              font-weight: bold;
              letter-spacing: 1px;
            }
            
            .invoice-info {
              display: grid;
              grid-template-columns: 1fr 1fr;
              padding: 15px;
              border-bottom: 2px solid #999;
              font-size: 13px;
            }
            
            .invoice-info-left div {
              margin-bottom: 8px;
            }
            
            .invoice-info-right {
              text-align: right;
            }
            
            .label {
              font-weight: bold;
              display: inline-block;
              width: 110px;
            }
            
            .buyer-section {
              padding: 15px;
              border-bottom: 2px solid #999;
            }
            
            .buyer-section h3 {
              font-size: 15px;
              font-weight: bold;
              margin-bottom: 10px;
            }
            
            .buyer-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 8px;
              font-size: 12px;
            }
            
            .invoice-table {
              width: 100%;
              border-collapse: collapse;
              font-size: 11px;
            }
            
            .invoice-table th {
              background: #e0e0e0;
              padding: 10px 6px;
              font-weight: bold;
              text-align: center;
              border: 1px solid #999;
            }
            
            .invoice-table td {
              padding: 10px 6px;
              border: 1px solid #999;
            }
            
            .invoice-table .text-left {
              text-align: left;
            }
            
            .invoice-table .text-center {
              text-align: center;
            }
            
            .invoice-table .text-right {
              text-align: right;
            }
            
            .net-row {
              background: #f5f5f5;
              font-weight: bold;
            }
            
            .amount-words {
              padding: 15px;
              border-top: 1px solid #999;
              font-size: 12px;
            }
            
            .signatures {
              display: grid;
              grid-template-columns: 1fr 1fr;
              padding: 15px;
              border-top: 2px solid #999;
              text-align: center;
            }
            
            .signature-box {
              padding: 10px;
            }
            
            .signature-line {
              border-top: 1px solid #333;
              margin-top: 50px;
              padding-top: 8px;
              font-weight: bold;
              font-size: 12px;
            }
            
            .footer {
              background: #D4AF37;
              text-align: center;
              padding: 15px 12px;
              font-size: 11px;
              line-height: 1.6;
            }
            
            @page {
              size: A4;
              margin: 0;
            }
            @media print {
              body { 
                margin: 0; 
                padding: 10mm; 
              }
              .invoice-container { 
                border: none; 
                box-shadow: none;
              }
              /* FIXED: Hide any extra content */
              .no-print, .print-date-time {
                display: none !important;
              }
            }
          </style>
        </head>
        <body>
          <div class="invoice-container">
            <!-- Watermark image -->
            <img class="print-watermark" src="${Logo}" alt="Watermark" />
            
            <div class="content">
              <!-- Company Header -->
              <div style="text-align: center; padding: 15px; border-bottom: 1px solid #999;">
                <img src="${Logo}" alt="A Rauf Textile" style="height: 200px; width: auto; max-width: 500px; margin: 0 auto 10px;">
                <div style="font-size: 11px; color: #333;">
                  <p style="margin: 2px 0; font-size: 10px;">Deals in all kind of Greige & Dyed Fabric</p>
                  <p style="margin: 2px 0; font-size: 10px;">ROOM NO. 205 2ND FLOOR SALEHA CHAMBER, PLOT No. B-9/C-1 SITE KARACHI</p>
                  <p style="margin: 3px 0; font-size: 10px;"><strong>STRN #</strong> 3277876141188</p>
                  <p style="margin: 2px 0; font-size: 10px;"><strong>NTN #</strong> 7555850-8</p>
                  <p style="margin: 2px 0; font-size: 10px;"><strong>Phone Number</strong> 021-36404043</p>
                </div>
              </div>
              
              <div class="title-section">
                <h1>PAYMENT INVOICE</h1>
              </div>
            
              <div class="invoice-info">
                <div class="invoice-info-left">
                  <div><span class="label">Invoice No :</span> ${displayInvoiceNumber}</div>
                </div>
                <div class="invoice-info-right">
                  <div><span class="label">Invoice Date:</span> ${invoice.bill_date ? new Date(invoice.bill_date).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) : "N/A"}</div>
                  <div style="border: 2px solid #333; display: inline-block; padding: 6px 16px; margin-top: 8px; font-size: 10px;">
                    <div style="font-weight: bold;">ORIGINAL ✓</div>
                    <div style="border-top: 1px solid #666; margin-top: 4px; padding-top: 4px;">DUPLICATE</div>
                  </div>
                </div>
              </div>
            
              <!-- BUYER'S PARTICULARS SECTION - Simplified to only customer details -->
              <div class="buyer-section">
                <h3 style="text-decoration: underline;">Buyer's Particulars :</h3>
                <div class="buyer-grid">
                  <div><span class="label">Company Name :</span> <strong>${invoice.company_name || invoice.customer_name || 'N/A'}</strong></div>
                  <div><span class="label">Address :</span> ${invoice.address || 'Floor Shan Residency SB-44 Block-K North Nazimabad karachi'}</div>
                  <div><span class="label">Sales Tax Reg No :</span> ${invoice.st_reg_no || '32-77-8761-411-88'}</div>
                  <div><span class="label">Phone Number :</span> ${invoice.p_number || '0333-1234567'}</div>
                  <div><span class="label">National Tax No :</span> ${invoice.ntn_number || '7555850-8'}</div>
                  <div><span class="label">Terms of Sale:</span> ${invoice.payment_days != null ? ('Payment due within ' + invoice.payment_days + ' days') : (invoice.terms_of_payment || 'Within 15 days')}</div>
                </div>
              </div>
      
              <table class="invoice-table">
                <thead>
                  <tr>
                    <th>S.No</th>
                    <th>Description of Goods</th>
                    <th>Quantity</th>
                    <th>Net Weight (KG)</th>
                    <th>Price</th>
                    <th>Value Ex-Sales Tax</th>
                    <th>Sales Tax %</th>
                    <th>Sales Tax Amount</th>
                    <th>Value Inc Sales tax</th>
                  </tr>
                </thead>
                <tbody>
                  ${
                    invoice.items && invoice.items.length > 0
                      ? invoice.items
                          .map((item, index) => {
                            const valueExTax = parseFloat(item.amount || 0);
                            const taxRate = parseFloat(invoice.tax_rate || 0);
                            const taxAmount = valueExTax * (taxRate / 100);
                            const valueIncTax = valueExTax + taxAmount;
                            return `
                      <tr>
                        <td class="text-center"><strong>${index + 1}</strong></td>
                        <td class="text-left">${item.description || "N/A"}${item.specifications ? "<br><small>" + item.specifications + "</small>" : ""}</td>
                        <td class="text-center">${parseFloat(item.quantity || 0).toLocaleString()}</td>
                        <td class="text-center">${parseFloat(item.net_weight || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} KG</td>
                        <td class="text-right">${parseFloat(item.rate || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                        <td class="text-right">${valueExTax.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                        <td class="text-center">${taxRate.toFixed(2)}%</td>
                        <td class="text-right">${taxAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                        <td class="text-right"><strong>${valueIncTax.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong></td>
                      </tr>
                    `;
                          })
                          .join("")
                      : `
                      <tr>
                        <td class="text-center"><strong>1</strong></td>
                        <td class="text-left">${invoice.item_name || "N/A"}</td>
                        <td class="text-center">${parseFloat(invoice.quantity || 0).toLocaleString()}</td>
                        <td class="text-center">${parseFloat(invoice.net_weight || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} KG</td>
                        <td class="text-right">${parseFloat(invoice.rate || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                        <td class="text-right">${parseFloat(invoice.subtotal || invoice.total_amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                        <td class="text-center">${(invoice.tax_rate || 0).toFixed(2)}%</td>
                        <td class="text-right">${(parseFloat(invoice.subtotal || invoice.total_amount || 0) * ((invoice.tax_rate || 0) / 100)).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                        <td class="text-right"><strong>${(parseFloat(invoice.subtotal || invoice.total_amount || 0) * (1 + (invoice.tax_rate || 0) / 100)).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong></td>
                      </tr>
                    `
                  }
                  <tr class="net-row">
                    <td></td>
                    <td class="text-left">NET AMOUNT RECEIVABLE</td>
                    <td class="text-center">${invoice.items ? invoice.items.reduce((sum, item) => sum + parseFloat(item.quantity || 0), 0).toLocaleString() : parseFloat(invoice.quantity || 0).toLocaleString()}</td>
                    <td class="text-center"><strong>${invoice.items ? invoice.items.reduce((sum, item) => sum + parseFloat(item.net_weight || 0), 0).toLocaleString("en-US", { minimumFractionDigits: 2 }) : parseFloat(invoice.net_weight || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} KG</strong></td>
                    <td></td>
                    <td class="text-right"><strong>${(() => {
                      const totalValueExTax =
                        invoice.items && invoice.items.length > 0
                          ? invoice.items.reduce(
                              (sum, item) => sum + parseFloat(item.amount || 0),
                              0,
                            )
                          : parseFloat(invoice.subtotal || 0);
                      return totalValueExTax.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                      });
                    })()}</strong></td>
                    <td></td>
                    <td class="text-right"><strong>${(() => {
                      const totalValueExTax =
                        invoice.items && invoice.items.length > 0
                          ? invoice.items.reduce(
                              (sum, item) => sum + parseFloat(item.amount || 0),
                              0,
                            )
                          : parseFloat(invoice.subtotal || 0);
                      const taxRate = parseFloat(invoice.tax_rate || 0);
                      const totalTaxAmount = totalValueExTax * (taxRate / 100);
                      return totalTaxAmount.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                      });
                    })()}</strong></td>
                    <td class="text-right"><strong>${(() => {
                      const totalValueExTax =
                        invoice.items && invoice.items.length > 0
                          ? invoice.items.reduce(
                              (sum, item) => sum + parseFloat(item.amount || 0),
                              0,
                            )
                          : parseFloat(invoice.subtotal || 0);
                      const taxRate = parseFloat(invoice.tax_rate || 0);
                      const totalTaxAmount = totalValueExTax * (taxRate / 100);
                      const totalValueIncTax = totalValueExTax + totalTaxAmount;
                      return totalValueIncTax.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                      });
                    })()}</strong></td>
                  </tr>
                </tbody>
              </table>
            
              <div class="amount-words">
                <strong>Amount in words:</strong> <em style="text-transform: uppercase;">PKR ${numberToWords(invoice.total_amount || 0)} ONLY </em>
              </div>
            
              <div class="signatures">
                <div class="signature-box">
                  <div class="signature-line">Prepared By</div>
                </div>
                <div class="signature-box">
                  <div class="signature-line">Authorized By</div>
                </div>
              </div>
            </div>
          </div>
        </body>
        </html>
      `;

      printWindow.document.write(printHTML);
      printWindow.document.close();

      printWindow.onload = () => {
        setTimeout(() => {
          printWindow.print();
          setTimeout(() => {
            printWindow.close();
          }, 1000);
        }, 500);
      };
    } catch (error) {
      console.error("Error generating PDF:", error);
      alert("Failed to generate PDF. Please try again.");
    }
  };

  // Handle status change for PO invoices
  const handleStatusChange = async (e) => {
    const newStatus = e.target.value;

    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000/api"}/po-invoices/${id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            status: newStatus,
            payment_date:
              newStatus === "Paid"
                ? new Date().toISOString().split("T")[0]
                : null,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to update status: ${response.statusText}`);
      }

      const result = await response.json();

      setInvoice((prev) => ({
        ...prev,
        status: newStatus,
      }));

      alert(`Invoice status updated to ${newStatus}`);
    } catch (error) {
      console.error("Error updating status:", error);
      alert(`Failed to update status: ${error.message}`);
      e.target.value = invoice.status;
    }
  };

  // Handle PO invoice deletion
  const handleDeletePOInvoice = async () => {
    const confirmMessage = `Are you sure you want to delete PO invoice ${displayInvoiceNumber}?

This will:
- Remove the invoice from the system permanently
- Restore ${invoice.currency || "PKR"} ${parseFloat(invoice.total_amount || 0).toLocaleString()} to PO ${invoice.po_number}
- Add deletion record to PO history for tracking

This action cannot be undone.`;

    if (window.confirm(confirmMessage)) {
      try {
        const response = await fetch(
          `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000/api"}/po-invoices/${id}`,
          {
            method: "DELETE",
          },
        );

        if (!response.ok) {
          throw new Error(`Failed to delete invoice: ${response.statusText}`);
        }

        const result = await response.json();

        alert(
          `PO Invoice deleted successfully!\n\n${result.poUpdate.message}\n\nRedirecting to invoices list...`,
        );

        navigate("/invoices");
      } catch (error) {
        console.error("Error deleting PO invoice:", error);
        alert(`Failed to delete PO invoice: ${error.message}`);
      }
    }
  };

  useEffect(() => {
    const fetchInvoice = async () => {
      try {
        setLoading(true);

        let response;
        if (isPOInvoice) {
          response = await fetch(
            `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000/api"}/po-invoices/${id}`,
          );
        } else {
          response = await fetch(
            `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000/api"}/invoices/${id}`,
          );
        }

        if (!response.ok) {
          throw new Error("Failed to fetch invoice");
        }

        const data = await response.json();

        if (isPOInvoice) {
          const mappedData = {
            ...data,
            bill_date: data.invoice_date,
            payment_deadline: data.due_date,
            payment_days: data.payment_days || 30,
            customer_email: data.customer_email || "N/A",
            address: data.customer_address,
            p_number: data.customer_phone,
            note: data.notes,
            items: data.items
              ? data.items.map((item) => ({
                  id: item.id,
                  item_no: item.item_no,
                  description: item.description,
                  quantity: item.invoiced_quantity || item.quantity,
                  net_weight: item.net_weight || 0,
                  rate: item.unit_price,
                  amount: item.amount,
                  specifications: item.specifications,
                  po_quantity: item.po_quantity,
                  remaining_quantity: item.remaining_quantity,
                }))
              : [],
            invoice_type: "po_invoice",
            quantity: data.invoiced_quantity || data.quantity,
            net_weight: data.net_weight || 0,
            subtotal: data.subtotal,
            tax_rate: data.tax_rate,
            salesTax: data.tax_amount,
            terms_of_payment: data.terms_of_payment || null,
            delivery_date: null,
            is_sent: data.status !== "Draft",
          };
          setInvoice(mappedData);
        } else {
          setInvoice(data);
        }
      } catch (err) {
        console.error("Error fetching invoice:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchInvoice();
    }
  }, [id, isPOInvoice]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
          <p className="text-gray-500">Loading invoice...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 mb-4">Error loading invoice</div>
          <p className="text-gray-500 mb-4">{error}</p>
          <button
            onClick={() => navigate("/invoices")}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
          >
            Back to Invoices
          </button>
        </div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="text-gray-500 mb-4">Invoice not found</div>
          <button
            onClick={() => navigate("/invoices")}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
          >
            Back to Invoices
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-screen bg-background"
      style={{ backgroundColor: "#F4F5F6" }}
    >
      {/* Sidebar */}
      <div className="hidden md:block fixed h-full w-64 z-20">
        <Sidebar />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col md:ml-64 relative">
        {/* Header */}
        <Header />

        {/* Main Container */}
        <div className="flex-1 p-6">
          {/* Enhanced Invoice Header */}
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6 bg-white rounded-lg shadow-sm p-6">
            {/* Left Side: Invoice Info */}
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate("/invoices")}
                className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
                <span>Back to Invoices</span>
              </button>
              <div className="border-l border-gray-300 pl-4">
                <h1 className="text-[24px] font-bold text-[#333843]">
                  {isPOInvoice
                    ? `PO Invoice #${displayInvoiceNumber}`
                    : `Invoice #${displayInvoiceNumber}`}
                </h1>
                <p className="text-[16px] text-[#667085]">
                  Invoice Date :{" "}
                  {invoice.bill_date
                    ? new Date(invoice.bill_date)
                        .toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                        .toUpperCase()
                    : "N/A"}
                </p>
                {isPOInvoice && invoice.po_number && (
                  <p className="text-[14px] text-[#1976D2]">
                    From PO: {invoice.po_number}
                  </p>
                )}
              </div>
            </div>

            {/* Right Side: Action Buttons */}
            <div className="flex items-center gap-3">
              <button
                onClick={generatePDF}
                className="flex flex-row justify-center items-center px-5 py-2 gap-[10px] bg-[#1976D2] rounded-lg hover:bg-[#1565C0] transition-colors"
              >
                <Printer className="w-5 h-5 text-white" />
                <span className="font-semibold text-[18px] text-white">
                  Print PDF
                </span>
              </button>
            </div>
          </div>

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
            {/* Invoice Content - Takes 3 columns on xl screens */}
            <div className="xl:col-span-3">
              <div
                ref={invoiceRef}
                className="bg-white rounded-lg shadow-sm overflow-hidden"
              >
                {/* Company Header */}
                <div className="relative px-8 py-6 border-b border-gray-400">
                  {/* Company Logo and Info - Centered */}
                  <div className="relative z-10 text-center mb-4">
                    <div className="flex justify-center mb-3">
                      <img
                        src={Logo}
                        alt="A Rauf Textile"
                        className="h-32 w-auto object-contain"
                        style={{ maxWidth: "280px" }}
                      />
                    </div>
                    <div className="text-sm text-gray-700">
                      <p className="text-xs">
                        Deals in all kind of Greige & Dyed Fabric
                      </p>
                      <p className="text-xs mt-1">
                        ROOM NO. 205 2ND FLOOR SALEHA CHAMBER, PLOT No. B-9/C-1 SITE KARACHI
                      </p>
                      <p className="text-xs mt-1">
                        <strong>STRN #</strong> 3277876141188
                      </p>
                      <p className="text-xs">
                        <strong>NTN #</strong> 7555850-8{" "}
                      </p>
                      <p className="text-xs">
                        <strong>Phone Number</strong> 021-36404043
                      </p>
                    </div>
                  </div>

                  {/* Title Section */}
                  <div className="relative z-10 text-center mb-4 border-t border-gray-300 pt-4">
                    <h1 className="text-xl font-bold text-gray-800 uppercase tracking-wide">
                      PAYMENT INVOICE
                    </h1>
                  </div>

                  {/* Invoice Info Grid */}
                  <div className="relative z-10 border-t border-gray-400 pt-4">
                    <div className="grid grid-cols-2 gap-8 mb-4">
                      {/* Left Column - Invoice Details */}
                      <div className="space-y-1 text-sm">
                        <div className="flex">
                          <span className="font-semibold text-gray-700 w-32">
                            Invoice No :
                          </span>
                          <span className="text-gray-800">
                            {displayInvoiceNumber}
                          </span>
                        </div>
                      </div>

                      {/* Right Column - Date */}
                      <div className="text-right space-y-1">
                        <div className="text-sm">
                          <span className="font-semibold text-gray-700">
                            Invoice Date:{" "}
                          </span>
                          <span className="text-gray-800">
                            {invoice.bill_date
                              ? new Date(invoice.bill_date).toLocaleDateString(
                                  "en-GB",
                                  {
                                    day: "2-digit",
                                    month: "2-digit",
                                    year: "numeric",
                                  },
                                )
                              : "N/A"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* FIXED: Buyer's Particulars Section - Simplified to only customer details */}
                  <div className="relative z-10 border border-gray-400 p-4 mb-4">
                    <h3 className="font-bold text-gray-800 mb-3 underline text-sm">
                      Buyer's Particulars :
                    </h3>
                    <div className="grid grid-cols-2 gap-x-12 gap-y-3 text-sm">
                      <div>
                        <div className="flex gap-2 mb-2">
                          <span className="font-semibold text-gray-700 w-48">
                            Company Name :
                          </span>
                          <span className="text-gray-800 font-bold">
                            {invoice.company_name || "N/A"}
                          </span>
                        </div>
                        <div className="flex gap-2 mb-2">
                          <span className="font-semibold text-gray-700 w-48">
                            Sales Tax Reg No :
                          </span>
                          <span className="text-gray-800">
                             {invoice.st_reg_no || "32-77-8761-411-88"}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <span className="font-semibold text-gray-700 w-48">
                            National Tax No :
                          </span>
                          <span className="text-gray-800">
                            {invoice.ntn_number || "7555850-8"}
                          </span>
                        </div>
                      </div>
                      <div>
                        <div className="flex gap-2 mb-2">
                          <span className="font-semibold text-gray-700 w-[25%]">
                            Address :
                          </span>
                          <span className="text-gray-800">
                            {invoice.address ||
                              "Floor Shan Residency SB-44 Block-K North Nazimabad karachi"}
                          </span>
                        </div>
                        <div className="flex gap-2 mb-2">
                          <span className="font-semibold text-gray-700 w-[25%]">
                            Phone Number :
                          </span>
                          <span className="text-gray-800">
                            {invoice.p_number || "0300-1234567"}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <span className="font-semibold text-gray-700 w-[25%]">
                            Terms of Sale :
                          </span>
                          <span className="text-gray-800">
                            {invoice.payment_days != null
                              ? "Payment due within " +
                                invoice.payment_days +
                                " days"
                              : invoice.terms_of_payment || "Within 15 days"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Items Table Section */}
                <div className="px-8 py-6">
                  {/* Invoice Table */}
                  <div className="mb-6">
                    <div className="overflow-x-auto border-2 border-gray-400">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="bg-gray-200 border-b-2 border-gray-400">
                            <th className="py-3 px-2 text-center text-xs font-bold text-gray-800 border-r border-gray-400">
                              S.No
                            </th>
                            <th className="py-3 px-3 text-center text-xs font-bold text-gray-800 border-r border-gray-400">
                              Description of Goods
                            </th>
                            <th className="py-3 px-3 text-center text-xs font-bold text-gray-800 border-r border-gray-400">
                              Quantity
                            </th>
                            <th className="py-3 px-3 text-center text-xs font-bold text-gray-800 border-r border-gray-400">
                              Net Weight (KG)
                            </th>
                            <th className="py-3 px-3 text-center text-xs font-bold text-gray-800 border-r border-gray-400">
                              Price
                            </th>
                            <th className="py-3 px-3 text-center text-xs font-bold text-gray-800 border-r border-gray-400">
                              Value Ex-Sales Tax
                            </th>
                            <th className="py-3 px-3 text-center text-xs font-bold text-gray-800 border-r border-gray-400">
                              Sales Tax %
                            </th>
                            <th className="py-3 px-3 text-center text-xs font-bold text-gray-800 border-r border-gray-400">
                              Sales Tax Amount
                            </th>
                            <th className="py-3 px-3 text-center text-xs font-bold text-gray-800">
                              Value Inc Sales tax
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {invoice.items && invoice.items.length > 0
                            ? invoice.items.map((item, index) => {
                                const valueExTax = parseFloat(item.amount || 0);
                                const taxRate = parseFloat(
                                  invoice.tax_rate || 0,
                                );
                                const taxAmount = valueExTax * (taxRate / 100);
                                const valueIncTax = valueExTax + taxAmount;
                                return (
                                  <tr
                                    key={item.id || index}
                                    className="border-b border-gray-300"
                                  >
                                    <td className="py-4 px-2 text-sm text-gray-800 text-center border-r border-gray-300 font-semibold">
                                      {index + 1}
                                    </td>
                                    <td className="py-4 px-3 text-sm text-gray-800 border-r border-gray-300">
                                      <div className="font-medium">
                                        {item.description || "N/A"}
                                      </div>
                                      {item.specifications && (
                                        <div className="text-xs text-gray-600 mt-1">
                                          {item.specifications}
                                        </div>
                                      )}
                                    </td>
                                    <td className="py-4 px-3 text-sm text-gray-800 text-center border-r border-gray-300">
                                      {parseFloat(
                                        item.quantity || 0,
                                      ).toLocaleString()}
                                    </td>
                                    <td className="py-4 px-3 text-sm text-gray-800 text-center border-r border-gray-300">
                                      {parseFloat(
                                        item.net_weight || 0,
                                      ).toLocaleString("en-US", {
                                        minimumFractionDigits: 2,
                                      })}{" "}
                                      KG
                                    </td>
                                    <td className="py-4 px-3 text-sm text-gray-800 text-right border-r border-gray-300">
                                      {parseFloat(
                                        item.rate || 0,
                                      ).toLocaleString("en-US", {
                                        minimumFractionDigits: 2,
                                      })}
                                    </td>
                                    <td className="py-4 px-3 text-sm text-gray-800 text-right border-r border-gray-300">
                                      {valueExTax.toLocaleString("en-US", {
                                        minimumFractionDigits: 2,
                                      })}
                                    </td>
                                    <td className="py-4 px-3 text-sm text-gray-800 text-center border-r border-gray-300">
                                      {taxRate.toFixed(2)}%
                                    </td>
                                    <td className="py-4 px-3 text-sm text-gray-800 text-right border-r border-gray-300">
                                      {taxAmount.toLocaleString("en-US", {
                                        minimumFractionDigits: 2,
                                      })}
                                    </td>
                                    <td className="py-4 px-3 text-sm font-semibold text-gray-900 text-right">
                                      {valueIncTax.toLocaleString("en-US", {
                                        minimumFractionDigits: 2,
                                      })}
                                    </td>
                                  </tr>
                                );
                              })
                            : (() => {
                                const valueIncTax = parseFloat(
                                  invoice.total_amount || 0,
                                );
                                const taxRate = parseFloat(
                                  invoice.tax_rate || 0,
                                );
                                const valueExTax =
                                  valueIncTax / (1 + taxRate / 100);
                                const taxAmount = valueIncTax - valueExTax;
                                return (
                                  <tr className="border-b border-gray-300">
                                    <td className="py-4 px-2 text-sm text-gray-800 text-center border-r border-gray-300 font-semibold">
                                      1
                                    </td>
                                    <td className="py-4 px-3 text-sm text-gray-800 border-r border-gray-300">
                                      <div className="font-medium">
                                        {invoice.item_name || "N/A"}
                                      </div>
                                    </td>
                                    <td className="py-4 px-3 text-sm text-gray-800 text-center border-r border-gray-300">
                                      {parseFloat(
                                        invoice.quantity || 0,
                                      ).toLocaleString()}
                                    </td>
                                    <td className="py-4 px-3 text-sm text-gray-800 text-center border-r border-gray-300">
                                      {parseFloat(
                                        invoice.net_weight || 0,
                                      ).toLocaleString("en-US", {
                                        minimumFractionDigits: 2,
                                      })}{" "}
                                      KG
                                    </td>
                                    <td className="py-4 px-3 text-sm text-gray-800 text-right border-r border-gray-300">
                                      {parseFloat(
                                        invoice.rate || 0,
                                      ).toLocaleString("en-US", {
                                        minimumFractionDigits: 2,
                                      })}
                                    </td>
                                    <td className="py-4 px-3 text-sm text-gray-800 text-right border-r border-gray-300">
                                      {valueExTax.toLocaleString("en-US", {
                                        minimumFractionDigits: 2,
                                      })}
                                    </td>
                                    <td className="py-4 px-3 text-sm text-gray-800 text-center border-r border-gray-300">
                                      {taxRate.toFixed(2)}%
                                    </td>
                                    <td className="py-4 px-3 text-sm text-gray-800 text-right border-r border-gray-300">
                                      {taxAmount.toLocaleString("en-US", {
                                        minimumFractionDigits: 2,
                                      })}
                                    </td>
                                    <td className="py-4 px-3 text-sm font-semibold text-gray-900 text-right">
                                      {valueIncTax.toLocaleString("en-US", {
                                        minimumFractionDigits: 2,
                                      })}
                                    </td>
                                  </tr>
                                );
                              })()}
                          {/* Net Amount Row */}
                          {(() => {
                            const totalValueExTax =
                              invoice.items && invoice.items.length > 0
                                ? invoice.items.reduce(
                                    (sum, item) =>
                                      sum + parseFloat(item.amount || 0),
                                    0,
                                  )
                                : parseFloat(invoice.subtotal || 0);
                            const taxRate = parseFloat(invoice.tax_rate || 0);
                            const totalTaxAmount =
                              totalValueExTax * (taxRate / 100);
                            const totalValueIncTax =
                              totalValueExTax + totalTaxAmount;
                            return (
                              <tr className="bg-gray-100 border-t-2 border-gray-400">
                                <td className="py-3 px-2 border-r border-gray-300"></td>
                                <td className="py-3 px-3 text-sm font-bold text-gray-800 border-r border-gray-300">
                                  NET AMOUNT RECEIVABLE
                                </td>
                                <td className="py-3 px-3 text-sm text-gray-800 text-center border-r border-gray-300">
                                  {invoice.items
                                    ? invoice.items
                                        .reduce(
                                          (sum, item) =>
                                            sum +
                                            parseFloat(item.quantity || 0),
                                          0,
                                        )
                                        .toLocaleString()
                                    : parseFloat(
                                        invoice.quantity || 0,
                                      ).toLocaleString()}
                                </td>
                                <td className="py-3 px-3 text-sm font-bold text-gray-900 text-center border-r border-gray-300">
                                  {invoice.items
                                    ? invoice.items
                                        .reduce(
                                          (sum, item) =>
                                            sum +
                                            parseFloat(item.net_weight || 0),
                                          0,
                                        )
                                        .toLocaleString("en-US", {
                                          minimumFractionDigits: 2,
                                        })
                                    : parseFloat(
                                        invoice.net_weight || 0,
                                      ).toLocaleString("en-US", {
                                        minimumFractionDigits: 2,
                                      })}{" "}
                                  KG
                                </td>
                                <td className="py-3 px-3 border-r border-gray-300"></td>
                                <td className="py-3 px-3 text-sm font-bold text-gray-900 text-right border-r border-gray-300">
                                  {totalValueExTax.toLocaleString("en-US", {
                                    minimumFractionDigits: 2,
                                  })}
                                </td>
                                <td className="py-3 px-3 border-r border-gray-300"></td>
                                <td className="py-3 px-3 text-sm font-bold text-gray-900 text-right border-r border-gray-300">
                                  {totalTaxAmount.toLocaleString("en-US", {
                                    minimumFractionDigits: 2,
                                  })}
                                </td>
                                <td className="py-3 px-3 text-sm font-bold text-gray-900 text-right">
                                  {totalValueIncTax.toLocaleString("en-US", {
                                    minimumFractionDigits: 2,
                                  })}
                                </td>
                              </tr>
                            );
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Amount in Words */}
                  <div className="mb-6 border border-gray-300 p-4">
                    <div className="flex items-start gap-2">
                      <span className="font-semibold text-gray-800">
                        Amount in words:
                      </span>
                      <span className="text-gray-700 italic uppercase">
                        PKR {numberToWords(invoice.total_amount || 0)} ONLY
                      </span>
                    </div>
                  </div>

                  {/* Signature Section */}
                  <div className="grid grid-cols-2 gap-8 border-t-2 border-gray-300 pt-6">
                    <div className="text-center">
                      <div className="h-16 mb-2"></div>
                      <div className="border-t border-gray-400 pt-2">
                        <span className="text-sm font-semibold text-gray-800">
                          Prepared By
                        </span>
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="h-16 mb-2"></div>
                      <div className="border-t border-gray-400 pt-2">
                        <span className="text-sm font-semibold text-gray-800">
                          Authorized By
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer - Company Info */}
                <div className="relative z-10 bg-[#E8D5A8] text-center py-3 rounded-b-lg border-t-2 border-gray-400">
                  <p className="text-xs text-gray-700 mt-1">
                    Deals in all kind of Greige & Dyed Fabric
                  </p>
                </div>
              </div>
            </div>

            {/* Sidebar - Takes 1 column on xl screens */}
            <div className="xl:col-span-1">
              {/* Status Card */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-100 mb-6">
                <div className="p-4 border-b border-gray-200">
                  <h3 className="font-semibold text-gray-900">
                    Invoice Status
                  </h3>
                </div>
                <div className="p-4">
                  <div
                    className={`inline-flex items-center px-3 py-2 rounded-lg font-medium ${
                      invoice.status === "Paid"
                        ? "bg-green-100 text-green-800"
                        : invoice.status === "Sent"
                          ? "bg-yellow-100 text-yellow-800"
                          : invoice.status === "Not Sent"
                            ? "bg-orange-100 text-orange-800"
                            : invoice.status === "Overdue"
                              ? "bg-red-100 text-red-800"
                              : invoice.status === "Pending"
                                ? "bg-yellow-100 text-yellow-800"
                                : invoice.status === "Draft"
                                  ? "bg-gray-100 text-gray-800"
                                  : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {invoice.status || "Not Sent"}
                  </div>

                  {/* Status Change Dropdown for PO Invoices */}
                  {isPOInvoice && (
                    <div className="mt-4">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Change Status
                      </label>
                      <select
                        value={invoice.status || "Not Sent"}
                        onChange={handleStatusChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      >
                        <option value="Not Sent">Not Sent</option>
                        <option value="Draft">Draft</option>
                        <option value="Sent">Sent</option>
                        <option value="Paid">Paid</option>
                        <option value="Overdue">Overdue</option>
                      </select>
                    </div>
                  )}

                  {/* Send Button for Not Sent PO Invoices */}
                  {isPOInvoice &&
                    (invoice.status === "Not Sent" ||
                      invoice.status === "Draft") && (
                      <div className="mt-4">
                        <button
                          onClick={() =>
                            handleStatusChange({ target: { value: "Sent" } })
                          }
                          className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                        >
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                            />
                          </svg>
                          <span>Send Invoice</span>
                        </button>
                      </div>
                    )}

                  {/* Delete Button for PO Invoices */}
                  {isPOInvoice && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <button
                        onClick={handleDeletePOInvoice}
                        className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                        <span>Delete PO Invoice</span>
                      </button>
                    </div>
                  )}

                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <div className="text-sm text-gray-500 mb-1">
                      Total Amount Due
                    </div>
                    <div className="text-xl font-bold text-gray-900">
                      {invoice.currency || "PKR"}{" "}
                      {parseFloat(invoice.total_amount || 0).toLocaleString(
                        "en-US",
                        { minimumFractionDigits: 2 },
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Box */}
              <div className="bg-white border border-gray-100 shadow-sm rounded-lg p-6">
                <h3 className="font-semibold text-[#333843] mb-4 text-center">
                  {isPOInvoice
                    ? invoice.status === "Draft"
                      ? "PO Invoice Draft"
                      : `PO Invoice ${invoice.status}`
                    : invoice.is_sent
                      ? "Invoice sent!"
                      : "Invoice not yet sent!"}
                </h3>
                {!isPOInvoice && (
                  <button className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-[#1976D2] text-white rounded-lg hover:bg-[#1565C0] transition-colors">
                    <svg
                      className="w-5 h-5"
                      viewBox="0 0 20 20"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M18.3334 9.99935L1.66675 9.99935M18.3334 9.99935L11.6667 16.666M18.3334 9.99935L11.6667 3.33268"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="font-semibold">Send Invoice</span>
                  </button>
                )}
                {isPOInvoice && (
                  <button
                    onClick={() =>
                      navigate(`/purchase-order/${invoice.po_number}`)
                    }
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-[#1976D2] text-white rounded-lg hover:bg-[#1565C0] transition-colors"
                  >
                    <svg
                      className="w-5 h-5"
                      viewBox="0 0 20 20"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M18.3334 9.99935L1.66675 9.99935M18.3334 9.99935L11.6667 16.666M18.3334 9.99935L11.6667 3.33268"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="font-semibold">View Purchase Order</span>
                  </button>
                )}
              </div>

              {/* Payment History - Only show when toggled */}
              {showPaymentHistory && (
                <div className="bg-white rounded-lg shadow-sm border border-gray-100 mt-6 p-6">
                  <h3 className="font-semibold text-gray-900 mb-4">
                    Payment History
                  </h3>
                  <div className="text-center py-4 text-gray-500">
                    <p className="text-sm">No payment history available</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InvoiceDetailsLayoutImproved;
