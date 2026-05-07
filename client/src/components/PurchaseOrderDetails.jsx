import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Download, Printer, Edit, Share2, Eye, EyeOff, X } from 'lucide-react';
import { generateInvoiceId, generateIncrementalPOInvoiceId } from '../utils/idGenerator';
import Logo from '../assets/Logo/rauf textile png.png';
import { API_ENDPOINTS } from '../config/api';

const PurchaseOrderDetails = ({ poId, onBack }) => {
  const [purchaseOrder, setPurchaseOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showPaymentHistory, setShowPaymentHistory] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [invoiceHistory, setInvoiceHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const poRef = useRef();

  // Fetch PO data from API
  useEffect(() => {
    const fetchPODetails = async () => {
      try {
        setLoading(true);
  console.debug('Fetching PO details for ID:', poId);
        
        const response = await fetch(API_ENDPOINTS.PURCHASE_ORDERS.GET(poId));
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
  console.debug('PO Details API Response:', data);
        
        // Transform API data to match component format
        const transformedPO = {
          id: data.id, // Keep the database ID
          databaseId: data.id, // Store database ID separately
          number: data.po_number || data.id,
          date: data.po_date,
          deliveryDate: data.delivery_date || new Date(Date.now() + 10*24*60*60*1000).toISOString().split('T')[0], // 10 days from PO date
          supplier: {
            name: data.supplier_name || 'N/A',
            company: data.supplier_name || 'N/A',
            email: data.supplier_email || 'N/A',
            phone: data.supplier_phone || 'N/A', 
            address: data.supplier_address || 'N/A',
            taxId: 'STR-123456789', // Static for now
            ntn: '1234567-8' // Static for now
          },
          items: (data.items || []).map(item => ({
            id: item.id || item.item_no || 1,
            description: item.description || 'N/A',
            quantity: item.quantity || 0,
            unit: item.unit || 'pcs',
            netWeight: item.net_weight || 0,
            unitPrice: item.unit_price || item.unitPrice || 0,
            total: item.amount || item.total || 0
          })),
          subtotal: data.subtotal || 0,
          taxRate: data.tax_rate || 0,
          taxAmount: data.tax_amount || 0,
          totalAmount: data.total_amount || 0,
          currency: data.currency || 'PKR',
          status: data.status || 'Pending',
          paymentDays: data.payment_days || 30,
          termsAndConditions: data.terms_conditions || `Payment within ${data.payment_days || 30} days of delivery. Quality as per approved sample. Delivery at buyer's warehouse.`,
          notes: data.notes || '',
          createdBy: 'System User', // Static for now
          approvedBy: data.status === 'Approved' ? 'Manager' : null,
          paymentHistory: [] // Static empty for now
        };
        
        setPurchaseOrder(transformedPO);
        setError(null);
        
      } catch (error) {
        console.error('Error fetching PO details:', error);
        setError(error.message);
        
        // Create a safe fallback PO with proper default values
        const fallbackPO = {
          id: poId,
          number: poId,
          date: new Date().toISOString().split('T')[0],
          deliveryDate: new Date(Date.now() + 10*24*60*60*1000).toISOString().split('T')[0],
          supplier: {
            name: 'Supplier Not Found',
            company: 'N/A',
            email: 'N/A',
            phone: 'N/A',
            address: 'N/A',
            taxId: 'N/A',
            ntn: 'N/A'
          },
          items: [],
          subtotal: 0,
          taxRate: 0,
          taxAmount: 0,
          totalAmount: 0,
          currency: 'PKR',
          status: 'Pending',
          paymentDays: 30,
          termsAndConditions: 'Payment within 30 days of delivery. Quality as per approved sample. Delivery at buyer\'s warehouse.',
          notes: 'Error loading purchase order details',
          createdBy: 'System',
          approvedBy: null,
          paymentHistory: []
        };
        
        setPurchaseOrder(fallbackPO);
      }
      setLoading(false);
    };
    
    fetchPODetails();
  }, [poId]);

  // Fetch invoice and payment history for this PO
  const fetchInvoiceHistory = async () => {
    if (!purchaseOrder?.number) return;
    
    try {
      setLoadingHistory(true);
      const response = await fetch(API_ENDPOINTS.PURCHASE_ORDERS.INVOICES(purchaseOrder.number));
      if (response.ok) {
        const invoices = await response.json();
        setInvoiceHistory(invoices);
      } else {
        console.error('Failed to fetch invoice history');
        setInvoiceHistory([]);
      }
    } catch (error) {
      console.error('Error fetching invoice history:', error);
      setInvoiceHistory([]);
    }
    setLoadingHistory(false);
  };

  // Fetch PO summary data from server
  const [poSummary, setPOSummary] = useState({
    poTotal: 0,
    totalInvoiced: 0,
    remainingAmount: 0,
    invoicingPercentage: 0,
    invoiceCount: 0,
    status: 'Not Invoiced'
  });

  // Currency formatter helper
  const formatCurrency = (amount, currency) => {
    const curr = currency || (purchaseOrder && purchaseOrder.currency) || 'PKR';
    const num = Number(amount || 0);
    // Use toLocaleString for thousands separators
    return `${curr} ${num.toLocaleString()}`;
  };

  const fetchPOSummary = async () => {
    if (!poId) return;
    
    try {
      const response = await fetch(API_ENDPOINTS.PURCHASE_ORDERS.SUMMARY(poId));
      if (response.ok) {
        const summary = await response.json();
        const invoicingPercentage = summary.po_total > 0 ? (summary.total_invoiced / summary.po_total) * 100 : 0;
        
        setPOSummary({
          poTotal: summary.po_total || 0,
          totalInvoiced: summary.total_invoiced || 0,
          remainingAmount: summary.remaining_amount || 0,
          invoicingPercentage: Math.round(invoicingPercentage * 100) / 100,
          invoiceCount: summary.invoice_count || 0,
          status: summary.remaining_amount <= 0 ? 'Fully Invoiced' : 
                  summary.total_invoiced > 0 ? 'Partially Invoiced' : 'Not Invoiced'
        });
        
        console.debug('PO Summary updated:', {
          remaining: summary.remaining_amount,
          total_invoiced: summary.total_invoiced,
          po_total: summary.po_total
        });
      } else {
        console.error('Failed to fetch PO summary');
      }
    } catch (error) {
      console.error('Error fetching PO summary:', error);
    }
  };

  // Legacy function for backward compatibility
  const getPOSummary = () => {
    return poSummary;
  };

  // Fetch PO summary and invoice history when PO ID is loaded
  useEffect(() => {
    if (poId) {
      fetchPOSummary();
      fetchInvoiceHistory();
    }
  }, [poId]);

  // Refresh PO summary when showing payment history
  useEffect(() => {
    if (showPaymentHistory && poId) {
      fetchPOSummary();
      fetchInvoiceHistory();
    }
  }, [showPaymentHistory]);

  // Update invoice status (e.g., mark as paid)
  const updateInvoiceStatus = async (invoiceId, newStatus) => {
    try {
      const response = await fetch(`${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'}/po-invoices/${invoiceId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          status: newStatus,
          payment_date: newStatus === 'Paid' ? new Date().toISOString().split('T')[0] : null
        })
      });

      if (response.ok) {
        // Refresh the invoice history to show updated status
        await fetchInvoiceHistory();
        
        const statusMessage = newStatus === 'Paid' ? 'marked as paid' : `updated to ${newStatus}`;
        alert(`Invoice successfully ${statusMessage}!`);
      } else {
        throw new Error('Failed to update invoice status');
      }
    } catch (error) {
      console.error('Error updating invoice status:', error);
      alert('Failed to update invoice status. Please try again.');
    }
  };

  const generatePDF = () => {
    if (!purchaseOrder) return;
    
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    
    if (!printWindow) {
      alert('Pop-up blocked. Please allow pop-ups for this site to generate PDF.');
      return;
    }

    const printHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Purchase Order ${purchaseOrder.number}</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          @page {
            size: A4;
            margin: 10mm;
          }
          
          body {
            font-family: Arial, sans-serif;
            background: white;
            color: #333;
            line-height: 1.3;
            padding: 0;
            margin: 0;
          }
          
          /* Force an A4 page-sized container so printed output matches A4 */
          .po-container {
            width: 210mm;
            min-height: 297mm;
            margin: 0 auto;
            background: white;
            position: relative;
            box-sizing: border-box;
            overflow: hidden;
            /* allow content to break across pages when it overflows */
            page-break-after: always;
          }
          
          /* Use an inline fixed <img> watermark so it prints reliably on each page */
          .print-watermark {
            position: fixed;
            top: 50%;
            left: 50%;
            /* Keep the image visually centered, but rotate around its left edge for a 'tilt from left' look */
            transform: translate(-50%, -50%) rotate(-14deg);
            transform-origin: 12% 50%; /* pivot near the left side, vertically centered */
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
          
          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 40px;
            padding-bottom: 20px;
            border-bottom: 2px solid #e5e5e5;
          }
          
          .company-info {
            display: block;
            align-items: center;
            gap: 20px;
          }
          
          .company-logo {
            width: 15rem;
            padding-bottom: 20px;
          }
          
          .company-details h2 {
            font-size: 18px;
            font-weight: 600;
            color: #1f2937;
            margin-bottom: 8px;
          }
          
          .company-details p {
            font-size: 12px;
            color: #6b7280;
            margin-bottom: 3px;
          }
          
          .po-meta {
            text-align: right;
          }
          
          .po-title {
            font-size: 24px;
            font-weight: bold;
            color: #1976d2;
            margin-bottom: 8px;
          }
          
          .po-info {
            background: #f8fafc;
            padding: 12px;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
          }
          
          .po-info div {
            margin-bottom: 4px;
            font-size: 12px;
          }
          
          .po-info .label {
            font-weight: 600;
            color: #374151;
          }
          
          .section {
            margin-bottom: 30px;
          }
          
          .section-title {
            font-size: 16px;
            font-weight: 600;
            color: #1f2937;
            margin-bottom: 15px;
            padding-bottom: 8px;
            border-bottom: 1px solid #e5e5e5;
          }
          
          .supplier-info {
            background: #f8fafc;
            padding: 20px;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
          }
          
          .supplier-info h3 {
            font-size: 16px;
            font-weight: 600;
            color: #1f2937;
            margin-bottom: 12px;
          }
          
          .supplier-info p {
            font-size: 13px;
            color: #4b5563;
            margin-bottom: 4px;
          }
          
          .items-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
          }
          
          .items-table th,
          .items-table td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #e5e5e5;
          }
          
          .items-table th {
            background: #f8fafc;
            font-weight: 600;
            color: #374151;
            font-size: 13px;
          }
          
          .items-table td {
            font-size: 13px;
            color: #4b5563;
          }
          
          .items-table .text-right {
            text-align: right;
          }
          
          .summary-section {
            display: flex;
            justify-content: flex-end;
            margin-bottom: 30px;
          }
          
          .summary-table {
            width: 300px;
          }
          
          .summary-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #f0f0f0;
          }
          
          .summary-row.total {
            border-bottom: 2px solid #1976d2;
            border-top: 2px solid #1976d2;
            font-weight: bold;
            font-size: 16px;
            color: #1976d2;
            padding: 12px 0;
          }
          
          .terms {
            background: #f8fafc;
            padding: 20px;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
          }
          
          .terms h4 {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 8px;
            color: #374151;
          }
          
          .terms p {
            font-size: 13px;
            color: #4b5563;
            line-height: 1.6;
          }
          
          .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e5e5e5;
            text-align: center;
            font-size: 12px;
            color: #6b7280;
          }
          
          @media print {
            @page {
              size: A4 portrait;
              margin: 0;
            }
            
            * {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            
            body {
              margin: 0 !important;
              padding: 8mm !important;
              line-height: 1.2 !important;
            }
            
            .po-container {
              width: 210mm !important;
              min-height: 297mm !important;
              margin: 0 auto !important;
              padding: 0 !important;
              box-shadow: none !important;
              page-break-after: always !important;
            }
            
            .content > div {
              padding: 16px !important;
            }
            
            .header {
              margin-bottom: 20px !important;
              padding-bottom: 12px !important;
            }
            
            .company-logo {
              width: 160px !important;
              height: auto !important;
              padding-bottom: 8px !important;
            }
            
            .company-details h2 {
              font-size: 14px !important;
              margin-bottom: 4px !important;
            }
            
            .company-details p {
              font-size: 10px !important;
              margin-bottom: 2px !important;
            }
            
            .po-title {
              font-size: 16px !important;
              margin-bottom: 6px !important;
            }
            
            .po-info {
              padding: 8px !important;
              margin-bottom: 12px !important;
            }
            
            .po-info div {
              font-size: 10px !important;
              margin-bottom: 2px !important;
            }
            
            .section {
              margin-bottom: 16px !important;
              page-break-inside: avoid;
            }
            
            .section-title {
              font-size: 12px !important;
              margin-bottom: 8px !important;
              padding-bottom: 4px !important;
            }
            
            .supplier-info {
              padding: 12px !important;
              margin-bottom: 12px !important;
            }
            
            .supplier-info h3 {
              font-size: 12px !important;
              margin-bottom: 6px !important;
            }
            
            .supplier-info p {
              font-size: 10px !important;
              margin-bottom: 2px !important;
            }
            
            .items-table {
              margin-bottom: 12px !important;
            }
            
            .items-table th,
            .items-table td {
              padding: 6px 8px !important;
              font-size: 10px !important;
            }
            
            .items-table th {
              font-size: 10px !important;
            }
            
            .summary-section {
              margin-bottom: 16px !important;
            }
            
            .summary-table {
              width: 250px !important;
            }
            
            .summary-row {
              padding: 4px 0 !important;
              font-size: 10px !important;
            }
            
            .summary-row.total {
              padding: 6px 0 !important;
              font-size: 12px !important;
            }
            
            .terms {
              padding: 12px !important;
              margin-bottom: 12px !important;
              page-break-inside: avoid;
            }
            
            .terms h4 {
              font-size: 11px !important;
              margin-bottom: 4px !important;
            }
            
            .terms p {
              font-size: 9px !important;
              line-height: 1.3 !important;
            }
            
            .footer {
              margin-top: 16px !important;
              padding-top: 12px !important;
              font-size: 9px !important;
            }
            
            /* Compress inline styles in HTML body */
            div[style*="padding: 32px"] {
              padding: 16px !important;
            }
            
            div[style*="font-size: 20px"] {
              font-size: 14px !important;
            }
            
            div[style*="font-size: 13px"] {
              font-size: 10px !important;
            }
            
            div[style*="margin-bottom: 16px"] {
              margin-bottom: 10px !important;
            }
            
            img[style*="height: 128px"] {
              height: 80px !important;
            }
            
            table td[style*="padding: 12px"],
            table th[style*="padding: 12px"] {
              padding: 6px 8px !important;
            }
          }
        </style>
      </head>
      <body>
          <div class="po-container">
          <!-- Watermark image placed as a fixed element so it appears on every printed page -->
          <img class="print-watermark" src="${Logo}" alt="Watermark" />
          <div class="content">
            <!-- Company Header - Matching On-Screen Layout -->
            <div style="position: relative; padding: 32px; border-bottom: 2px solid #9ca3af;">
              <!-- Company Logo and Info - Centered -->
              <div style="position: relative; z-index: 10; text-align: center; margin-bottom: 16px;">
                <div style="display: flex; justify-content: center; margin-bottom: 12px;">
                  <img src="${Logo}" alt="A Rauf Textile" style="height: 200px; width: auto; max-width: 400px; object-fit: contain;">
                </div>
                <div style="font-size: 13px; color: #374151;">
                  <p style="font-size: 11px; margin: 2px 0;">Deals in all kind of Greige & Dyed Fabric</p>
                  <p style="font-size: 11px; margin: 3px 0;"><strong>STRN #</strong> 32-77-8761-279-54</p>
                  <p style="font-size: 11px; margin: 2px 0;"><strong>NTN #</strong> 7225539-1</p>
                </div>
              </div>

              <!-- Title Section -->
              <div style="position: relative; z-index: 10; text-align: center; margin-bottom: 16px; border-top: 1px solid #d1d5db; padding-top: 16px;">
                <h1 style="font-size: 20px; font-weight: bold; color: #1f2937; text-transform: uppercase; letter-spacing: 1px; margin: 0;">PURCHASE ORDER</h1>
              </div>

              <!-- PO Info Grid -->
              <div style="position: relative; z-index: 10; border-top: 2px solid #9ca3af; padding-top: 16px;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-bottom: 16px;">
                  <!-- Left Column - PO Details -->
                  <div style="font-size: 13px;">
                    <div style="margin-bottom: 6px;">
                      <span style="font-weight: 600; color: #374151; display: inline-block; width: 128px;">PO Number :</span>
                      <span style="color: #1f2937;">${purchaseOrder.number}</span>
                    </div>
                    <div style="margin-bottom: 6px;">
                      <span style="font-weight: 600; color: #374151; display: inline-block; width: 128px;">Date :</span>
                      <span style="color: #1f2937;">${new Date(purchaseOrder.date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                    </div>
                  </div>

                  <!-- Right Column - Delivery & Status -->
                  <div style="text-align: right; font-size: 13px;">
                    <div style="margin-bottom: 6px;">
                      <span style="font-weight: 600; color: #374151;">Delivery Date: </span>
                      <span style="color: #1f2937;">${new Date(purchaseOrder.deliveryDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                    </div>
                    <div style="margin-bottom: 6px;">
                      <span style="font-weight: 600; color: #374151;">Status: </span>
                      <span style="margin-left: 8px; padding: 4px 12px; border-radius: 9999px; font-size: 11px; font-weight: 500; ${
                        purchaseOrder.status === 'Pending' ? 'background: #fed7aa; color: #9a3412;' :
                        purchaseOrder.status === 'Approved' ? 'background: #bfdbfe; color: #1e40af;' :
                        purchaseOrder.status === 'In Transit' ? 'background: #e9d5ff; color: #6b21a8;' :
                        purchaseOrder.status === 'Delivered' ? 'background: #bbf7d0; color: #15803d;' :
                        'background: #fecaca; color: #991b1b;'
                      }">
                        ${purchaseOrder.status}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Supplier Information Section -->
              <div style="position: relative; z-index: 10; border: 1px solid #9ca3af; padding: 16px; margin-bottom: 16px;">
                <h3 style="font-weight: bold; color: #1f2937; margin-bottom: 12px; text-decoration: underline; font-size: 13px;">Supplier Information :</h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px 48px; font-size: 13px;">
                  <div>
                    <span style="font-weight: 600; color: #374151; display: inline-block; width: 160px;">Name :</span>
                    <span style="color: #1f2937; font-weight: bold;">${purchaseOrder.supplier.name}</span>
                  </div>
                  <div>
                    <span style="font-weight: 600; color: #374151; display: inline-block; width: 192px;">Company :</span>
                    <span style="color: #1f2937;">${purchaseOrder.supplier.company}</span>
                  </div>
                  <div>
                    <span style="font-weight: 600; color: #374151; display: inline-block; width: 160px;">Email :</span>
                    <span style="color: #1f2937;">${purchaseOrder.supplier.email}</span>
                  </div>
                  <div>
                    <span style="font-weight: 600; color: #374151; display: inline-block; width: 192px;">Phone :</span>
                    <span style="color: #1f2937;">${purchaseOrder.supplier.phone}</span>
                  </div>
                  <div style="grid-column: 1 / -1;">
                    <span style="font-weight: 600; color: #374151; display: inline-block; width: 160px;">Address :</span>
                    <span style="color: #1f2937;">${purchaseOrder.supplier.address}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Items Table Section -->
            <div style="padding: 32px;">
              <!-- PO Table - Matching On-Screen Style -->
              <div style="margin-bottom: 24px;">
                <div style="overflow-x: auto; border: 2px solid #9ca3af;">
                  <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                      <tr style="background: #e5e7eb; border-bottom: 2px solid #9ca3af;">
                        <th style="padding: 12px 8px; text-align: center; font-size: 11px; font-weight: bold; color: #1f2937; border-right: 1px solid #9ca3af;">S.No</th>
                        <th style="padding: 12px 12px; text-align: center; font-size: 11px; font-weight: bold; color: #1f2937; border-right: 1px solid #9ca3af;">Description</th>
                        <th style="padding: 12px 12px; text-align: center; font-size: 11px; font-weight: bold; color: #1f2937; border-right: 1px solid #9ca3af;">Quantity</th>
                        <th style="padding: 12px 12px; text-align: center; font-size: 11px; font-weight: bold; color: #1f2937; border-right: 1px solid #9ca3af;">Net Weight (KG)</th>
                        <th style="padding: 12px 12px; text-align: center; font-size: 11px; font-weight: bold; color: #1f2937; border-right: 1px solid #9ca3af;">Rate</th>
                        <th style="padding: 12px 12px; text-align: center; font-size: 11px; font-weight: bold; color: #1f2937;">Total Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${(purchaseOrder.items || []).length > 0 ? 
                        purchaseOrder.items.map((item, index) => `
                          <tr style="border-bottom: 1px solid #d1d5db;">
                            <td style="padding: 16px 8px; font-size: 13px; color: #1f2937; text-align: center; border-right: 1px solid #d1d5db; font-weight: 600;">${index + 1}</td>
                            <td style="padding: 16px 12px; font-size: 13px; color: #1f2937; border-right: 1px solid #d1d5db;">
                              <div style="font-weight: 500;">${item.description || 'N/A'}</div>
                            </td>
                            <td style="padding: 16px 12px; font-size: 13px; color: #1f2937; text-align: center; border-right: 1px solid #d1d5db;">${parseFloat(item.quantity || 0).toLocaleString()}</td>
                            <td style="padding: 16px 12px; font-size: 13px; color: #1f2937; text-align: center; border-right: 1px solid #d1d5db;">${parseFloat(item.netWeight || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} KG</td>
                            <td style="padding: 16px 12px; font-size: 13px; color: #1f2937; text-align: center; border-right: 1px solid #d1d5db;">${purchaseOrder.currency} ${parseFloat(item.unitPrice || item.unit_price || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                            <td style="padding: 16px 12px; font-size: 13px; font-weight: 600; color: #111827; text-align: center;">${purchaseOrder.currency} ${parseFloat(item.total || item.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          </tr>
                        `).join('') :
                        '<tr style="border-bottom: 1px solid #d1d5db;"><td colspan="6" style="padding: 32px 16px; text-align: center; font-size: 13px; color: #6b7280;">No items found for this purchase order</td></tr>'
                      }
                      <!-- Total Row -->
                      <tr style="background: #f3f4f6; border-top: 2px solid #9ca3af;">
                        <td style="padding: 12px 8px; border-right: 1px solid #d1d5db;"></td>
                        <td style="padding: 12px 12px; font-size: 13px; font-weight: bold; color: #1f2937; border-right: 1px solid #d1d5db;">TOTAL</td>
                        <td style="padding: 12px 12px; font-size: 13px; color: #1f2937; text-align: center; border-right: 1px solid #d1d5db;">
                          ${purchaseOrder.items ? purchaseOrder.items.reduce((sum, item) => sum + parseFloat(item.quantity || 0), 0).toLocaleString() : 0}
                        </td>
                        <td style="padding: 12px 12px; font-size: 13px; color: #1f2937; text-align: center; border-right: 1px solid #d1d5db;">
                          ${purchaseOrder.items ? purchaseOrder.items.reduce((sum, item) => sum + parseFloat(item.netWeight || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2 }) : 0} KG
                        </td>
                        <td style="padding: 12px 12px; border-right: 1px solid #d1d5db;"></td>
                        <td style="padding: 12px 12px; font-size: 13px; font-weight: bold; color: #111827; text-align: center;">${purchaseOrder.currency} ${parseFloat(purchaseOrder.totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <!-- Summary Section -->
              <div style="margin-bottom: 24px; border: 1px solid #d1d5db; padding: 16px;">
                <div>
                  <div style="margin-bottom: 12px;">
                    <span style="font-weight: 600; color: #1f2937;">Amount Breakdown:</span>
                  </div>
                  <div style="font-size: 13px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                      <span style="color: #374151;">Subtotal:</span>
                      <span style="font-weight: 600; color: #111827;">${purchaseOrder.currency} ${parseFloat(purchaseOrder.subtotal || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                      <span style="color: #374151;">Tax (${purchaseOrder.taxRate}%):</span>
                      <span style="font-weight: 600; color: #111827;">${purchaseOrder.currency} ${parseFloat(purchaseOrder.taxAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding-top: 8px; border-top: 1px solid #d1d5db;">
                      <span style="font-weight: bold; color: #1f2937;">Total Amount:</span>
                      <span style="font-weight: bold; color: #111827;">${purchaseOrder.currency} ${parseFloat(purchaseOrder.totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Terms and Conditions -->
              <div style="margin-bottom: 24px; border: 1px solid #d1d5db; padding: 16px;">
                <h4 style="font-weight: bold; color: #1f2937; margin-bottom: 12px;">Terms and Conditions</h4>
                <p style="font-size: 13px; color: #374151; line-height: 1.6; margin-bottom: 16px;">${purchaseOrder.termsAndConditions}</p>
                ${purchaseOrder.notes ? `
                  <h4 style="font-weight: bold; color: #1f2937; margin-bottom: 12px;">Special Notes</h4>
                  <p style="font-size: 13px; color: #374151; line-height: 1.6;">${purchaseOrder.notes}</p>
                ` : ''}
              </div>

              <!-- Signature Section -->
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 32px; border-top: 2px solid #d1d5db; padding-top: 24px;">
                <div style="text-align: center;">
                  <div style="height: 64px; margin-bottom: 8px;"></div>
                  <div style="border-top: 1px solid #9ca3af; padding-top: 8px;">
                    <span style="font-size: 13px; font-weight: 600; color: #1f2937;">Prepared By</span>
                  </div>
                </div>
                <div style="text-align: center;">
                  <div style="height: 64px; margin-bottom: 8px;"></div>
                  <div style="border-top: 1px solid #9ca3af; padding-top: 8px;">
                    <span style="font-size: 13px; font-weight: 600; color: #1f2937;">Authorized By</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <script>
          // Print when the new window loads. Use native rendering so A4 sizing from CSS is respected.
          window.onload = function(){
            setTimeout(function(){ window.print(); }, 150);
          };
        </script>
      </body>
      </html>
    `;

    printWindow.document.write(printHTML);
    printWindow.document.close();
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: `Purchase Order ${purchaseOrder.number}`,
        text: `Purchase Order details for ${purchaseOrder.supplier.name}`,
        url: window.location.href
      });
    } else {
      // Fallback - copy to clipboard
      navigator.clipboard.writeText(window.location.href);
      alert('Link copied to clipboard!');
    }
  };

  // Function to fetch existing PO invoices for this specific PO (for incremental numbering)
  const fetchPOInvoicesForCurrentPO = async () => {
    try {
      // Use database ID if available, otherwise use the poId (which might be PO number)
      const searchId = purchaseOrder?.databaseId || purchaseOrder?.id || poId;
      const response = await fetch(`${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'}/po-invoices/details?po_id=${searchId}`);
      if (response.ok) {
        const data = await response.json();
  console.debug(`Fetched ${data.length} existing invoices for PO ${searchId}`);
        return data;
      } else {
        console.error('Failed to fetch PO invoices for current PO, using empty array for ID generation');
        return [];
      }
    } catch (error) {
      console.error('Error fetching PO invoices for current PO, using empty array for ID generation:', error);
      return []; // Return empty array on error, will still generate a unique ID
    }
  };

  // Function to fetch all PO invoice numbers for unique ID generation
  const fetchPOInvoiceNumbers = async () => {
    try {
      const response = await fetch(`${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'}/po-invoices`);
      if (response.ok) {
        const invoiceNumbers = await response.json();
  console.debug('Fetched PO invoice numbers for ID generation:', invoiceNumbers.length, 'existing invoice numbers');
        
        // Server returns array of strings, convert to format expected by ID generator
        // ID generator expects array of objects with invoice_number property
        const formattedData = invoiceNumbers.map(number => ({ invoice_number: number }));
        
  console.debug('Formatted for ID Generator:', formattedData.length, 'invoice objects');
        
        return formattedData;
      } else {
        console.error('Failed to fetch PO invoice numbers, using empty array for ID generation');
        return [];
      }
    } catch (error) {
      console.error('Error fetching PO invoice numbers, using empty array for ID generation:', error);
      return []; // Return empty array on error, will still generate a unique ID
    }
  };

  // Invoice Modal Component
  const InvoiceModal = () => {
    const [invoicingMode, setInvoicingMode] = useState('quantity'); // 'quantity' only (Amount-based removed)
    const [poItemsWithTracking, setPOItemsWithTracking] = useState([]);
    const [loadingItems, setLoadingItems] = useState(false);

    // Helper function to safely calculate totals
    const safeParseFloat = (value) => {
      const parsed = parseFloat(value);
      return isNaN(parsed) ? 0 : parsed;
    };

    // Helper function to calculate total quantities
    const calculateTotalQuantity = (items) => {
      return items.reduce((sum, item) => sum + safeParseFloat(item.po_quantity), 0);
    };

    // Helper function to calculate remaining quantities
    const calculateRemainingQuantity = (items) => {
      return items.reduce((sum, item) => sum + safeParseFloat(item.remaining_quantity), 0);
    };
    
    const [invoiceData, setInvoiceData] = useState({
      invoiceNumber: '', // Will be generated after fetching existing invoices
      invoiceDate: new Date().toISOString().split('T')[0],
      dueDate: new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0], // 30 days from now
      paymentDays: purchaseOrder?.paymentDays || 30, // Default from PO, user can override
      supplier: {
        name: purchaseOrder?.supplier?.name || '',
        email: purchaseOrder?.supplier?.email || '',
        phone: purchaseOrder?.supplier?.phone || '',
        address: purchaseOrder?.supplier?.address || ''
      },
      items: purchaseOrder?.items?.map(item => ({
        description: item.description || 'N/A',
        quantity: item.quantity || 0,
        netWeight: item.netWeight || 0,
        unitPrice: item.unitPrice || item.unit_price || 0,
        amount: item.total || item.amount || 0
      })) || [],
      subtotal: purchaseOrder?.subtotal || 0,
      taxRate: purchaseOrder?.taxRate || 0,
      taxAmount: purchaseOrder?.taxAmount || 0,
      total: purchaseOrder?.totalAmount || 0,
      invoiceAmount: 0, // Will be set to remaining amount
      remainingAmount: 0, // Will be calculated
      notes: `Generated from Purchase Order: ${purchaseOrder?.number || ''}`,
      po_id: purchaseOrder?.databaseId || purchaseOrder?.id || poId, // Link to PO with database ID
      quantityItems: [] // For quantity-based invoicing
    });

    // Fetch PO items with quantity tracking when switching to quantity mode
    const fetchPOItemsWithTracking = async () => {
      if (!poId) return;
      
      try {
        setLoadingItems(true);
        const response = await fetch(`${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'}/purchase-orders/${poId}/items/quantity-tracking`);
        if (response.ok) {
          const items = await response.json();
          console.debug('PO Items loaded for quantity tracking:', items.length, 'items');
          console.debug('Raw items from API:', items);
          
          // Ensure all numeric fields are properly converted
          const numericItems = items.map(item => ({
            ...item,
            po_quantity: safeParseFloat(item.po_quantity),
            remaining_quantity: safeParseFloat(item.remaining_quantity),
            unit_price: safeParseFloat(item.unit_price)
          }));
          
          console.debug('Items after numeric conversion:', numericItems);
          
          setPOItemsWithTracking(numericItems);
          
          if (items.length === 0) {
            alert('This Purchase Order has no items available for invoicing.\n\nPlease check if all items have been fully invoiced.');
            return;
          }
          
          // Initialize quantity items with available quantities (ensure numeric conversion)
          const quantityItems = numericItems.map(item => ({
            po_item_id: item.po_item_id,
            description: item.description,
            po_quantity: safeParseFloat(item.po_quantity),
            remaining_quantity: safeParseFloat(item.remaining_quantity),
            unit: item.unit,
            net_weight: safeParseFloat(item.net_weight || 0),
            unit_price: safeParseFloat(item.unit_price),
            invoiced_quantity: 0, // User will set this
            amount: 0,
            item_status: item.item_status
          }));
          
          console.debug('Initialized quantity items:', quantityItems.length, 'items ready for invoicing');
          
          setInvoiceData(prev => ({
            ...prev,
            quantityItems
          }));
        } else {
          console.error('Failed to fetch PO items with tracking');
          alert('Error loading PO items for invoicing. Please try again.');
        }
      } catch (error) {
        console.error('Error fetching PO items:', error);
      }
      setLoadingItems(false);
    };

    // Initialize invoice amount with remaining amount when PO summary is loaded (for amount mode)
    useEffect(() => {
      if (invoicingMode === 'amount' && poSummary.remainingAmount > 0) {
        setInvoiceData(prev => ({
          ...prev,
          invoiceAmount: poSummary.remainingAmount,
          subtotal: poSummary.remainingAmount,
          total: poSummary.remainingAmount,
          remainingAmount: 0 // Will be 0 after this invoice
        }));
      }
    }, [poSummary.remainingAmount, invoicingMode]);
    
    // Load PO items when switching to quantity mode
    useEffect(() => {
      if (invoicingMode === 'quantity') {
        fetchPOItemsWithTracking();
      }
    }, [invoicingMode]);

    // Generate unique incremental PO invoice number on component mount
    useEffect(() => {
      const generateUniquePOInvoiceNumber = async () => {
        try {
          // Fetch existing invoices for this specific PO
          const existingPOInvoices = await fetchPOInvoicesForCurrentPO();
          // Fetch all PO invoices for collision checking
          const allPOInvoices = await fetchPOInvoiceNumbers();
          
          // Generate incremental ID (PI25-001, PI25-001-1, PI25-001-2, etc.)
          const newInvoiceNumber = generateIncrementalPOInvoiceId(existingPOInvoices, allPOInvoices);
          
          console.debug(`Generated PO invoice number for PO ${poId}:`, newInvoiceNumber);
          console.debug(`- Existing invoices for this PO: ${existingPOInvoices.length}`);
          console.debug(`- Total PO invoices in system: ${allPOInvoices.length}`);
          
          setInvoiceData(prev => ({
            ...prev,
            invoiceNumber: newInvoiceNumber
          }));
        } catch (error) {
          console.error('Error generating PO invoice number:', error);
          // Fallback: generate with empty arrays
          const fallbackNumber = generateIncrementalPOInvoiceId([], []);
          console.debug('Using fallback PO invoice number:', fallbackNumber);
          setInvoiceData(prev => ({
            ...prev,
            invoiceNumber: fallbackNumber
          }));
        }
      };
      
      generateUniquePOInvoiceNumber();
    }, []); // Only run once on mount

    const handleInputChange = (e) => {
      const { name, value } = e.target;
      setInvoiceData(prev => {
        const next = { ...prev, [name]: value };

        if (name === 'invoiceDate' || name === 'paymentDays') {
          const base = new Date(name === 'invoiceDate' ? value : next.invoiceDate);
          const days = Number(name === 'paymentDays' ? value : next.paymentDays);
          if (!Number.isNaN(base.getTime()) && !Number.isNaN(days) && days >= 0) {
            const due = new Date(base);
            due.setDate(due.getDate() + days);
            next.dueDate = due.toISOString().split('T')[0];
          }
        }

        if (name === 'dueDate') {
          const base = new Date(next.invoiceDate);
          const due = new Date(value);
          if (!Number.isNaN(base.getTime()) && !Number.isNaN(due.getTime())) {
            const diffMs = due.getTime() - base.getTime();
            const dayDiff = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
            next.paymentDays = dayDiff;
          }
        }

        return next;
      });
    };

    const handleSupplierChange = (e) => {
      const { name, value } = e.target;
      setInvoiceData(prev => ({
        ...prev,
        supplier: {
          ...prev.supplier,
          [name]: value
        }
      }));
    };

    // Handle quantity changes for quantity-based invoicing
    const handleQuantityChange = (itemIndex, newQuantity) => {
      const quantity = parseFloat(newQuantity) || 0;
      
      setInvoiceData(prev => {
        const updatedItems = [...prev.quantityItems];
        const item = updatedItems[itemIndex];
        
        if (item) {
          // Ensure quantity doesn't exceed remaining quantity and is not negative
          const maxQuantity = Math.max(0, safeParseFloat(item.remaining_quantity));
          const validQuantity = Math.min(Math.max(0, quantity), maxQuantity);
          
          // Update item quantities and amount
          item.invoiced_quantity = validQuantity;
          item.amount = validQuantity * safeParseFloat(item.unit_price);
          
          // Update remaining quantity for this item
          item.current_remaining = item.remaining_quantity - validQuantity;
          
          console.debug(`Quantity change for item ${itemIndex}:`, {
            description: item.description,
            requested: quantity,
            valid: validQuantity,
            remaining: item.remaining_quantity,
            amount: item.amount
          });
        }
        
        // Calculate totals for quantity-based invoice with proper numeric conversion
        const totalQuantity = updatedItems.reduce((sum, item) => {
          const qty = parseFloat(item.invoiced_quantity) || 0;
          return sum + qty;
        }, 0);
        
        const totalAmount = updatedItems.reduce((sum, item) => {
          const amount = parseFloat(item.amount) || 0;
          return sum + amount;
        }, 0);
        
        const totalItems = updatedItems.filter(item => parseFloat(item.invoiced_quantity) > 0).length;
        
        console.debug('Quantity-based invoice totals:', {
          totalItems,
          totalQuantity,
          totalAmount,
          itemsWithQuantity: updatedItems.filter(item => item.invoiced_quantity > 0).length
        });
        
        return {
          ...prev,
          quantityItems: updatedItems,
          invoiceAmount: totalAmount,
          subtotal: totalAmount,
          total: totalAmount,
          totalQuantity,
          selectedItemsCount: totalItems
        };
      });
    };

    // Items are now read-only since they come from PO (for amount-based invoicing)
    // Only the invoice amount can be changed to control partial invoicing

    const handleInvoiceAmountChange = (e) => {
      const invoiceAmount = parseFloat(e.target.value) || 0;
      
      // Use current PO summary data
      const availableAmount = poSummary.remainingAmount;
      
      // Ensure invoice amount doesn't exceed available amount
      const validInvoiceAmount = Math.min(invoiceAmount, availableAmount);
      const newRemainingAmount = Math.max(0, availableAmount - validInvoiceAmount);
      
      // Use the invoice amount directly (tax already included in PO total)
      setInvoiceData(prev => ({
        ...prev,
        invoiceAmount: validInvoiceAmount,
        remainingAmount: newRemainingAmount,
        subtotal: validInvoiceAmount, // Invoice amount is the total including tax
        taxAmount: 0, // No additional tax since it's already in the PO total
        total: validInvoiceAmount,
        // Show warning if user entered more than available
        exceedsAvailable: invoiceAmount > availableAmount
      }));
    };

    const handleCreateInvoice = async () => {
      try {
        let invoicePayload;
        let apiEndpoint;
        
        if (invoicingMode === 'quantity') {
          // Validate that at least one item has quantity > 0
          const itemsWithQuantity = invoiceData.quantityItems.filter(item => item.invoiced_quantity > 0);
          
          if (itemsWithQuantity.length === 0) {
            alert('Please specify quantities for at least one item from the PO.\n\nIn the "Select Quantities to Invoice" table above, enter the quantities you want to invoice for each item.');
            return;
          }
          
          // Validate that all selected quantities are valid
          const invalidItems = itemsWithQuantity.filter(item => 
            item.invoiced_quantity > item.remaining_quantity || 
            item.invoiced_quantity <= 0
          );
          
          if (invalidItems.length > 0) {
            const itemNames = invalidItems.map(item => `"${item.description}"`).join(', ');
            alert(`Invalid quantities detected for: ${itemNames}\n\nPlease ensure all quantities are positive and don't exceed the remaining quantities.`);
            return;
          }
          
          console.debug('Quantity-based invoice validation passed:', {
            totalItems: invoiceData.quantityItems.length,
            selectedItems: itemsWithQuantity.length,
            selectedItemDetails: itemsWithQuantity.map(item => ({
              description: item.description,
              invoiced_quantity: item.invoiced_quantity,
              amount: item.amount
            }))
          });
          
          // Prepare quantity-based invoice payload
          invoicePayload = {
            invoice_number: invoiceData.invoiceNumber,
            invoice_date: invoiceData.invoiceDate,
            due_date: invoiceData.dueDate,
            po_id: purchaseOrder?.databaseId || purchaseOrder?.id,
            po_number: purchaseOrder?.number,
            customer_name: invoiceData.supplier.name,
            customer_email: invoiceData.supplier.email,
            customer_phone: invoiceData.supplier.phone,
            customer_address: invoiceData.supplier.address,
            currency: purchaseOrder?.currency || 'PKR',
            status: 'Draft',
            payment_days: invoiceData.paymentDays || 30,
            notes: invoiceData.notes,
            tax_rate: purchaseOrder?.taxRate || 0,
            tax_amount: purchaseOrder?.taxAmount || 0,
            items: itemsWithQuantity.map(item => ({
              po_item_id: item.po_item_id,
              invoiced_quantity: item.invoiced_quantity,
              net_weight: item.net_weight || 0
            }))
          };
          
          console.log('🔍 [DEBUG] PurchaseOrder object:', purchaseOrder);
          console.log('🔍 [DEBUG] Tax values being sent:', { tax_rate: invoicePayload.tax_rate, tax_amount: invoicePayload.tax_amount });
          
          apiEndpoint = `${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'}/po-invoices/quantity-based`;
        } else {
          // Amount-based invoice (existing logic)
          invoicePayload = {
            invoice_number: invoiceData.invoiceNumber,
            invoice_date: invoiceData.invoiceDate,
            due_date: invoiceData.dueDate,
            po_id: purchaseOrder?.databaseId || purchaseOrder?.id,
            po_number: purchaseOrder?.number,
            customer_name: invoiceData.supplier.name,
            customer_email: invoiceData.supplier.email,
            customer_phone: invoiceData.supplier.phone,
            customer_address: invoiceData.supplier.address,
            subtotal: invoiceData.subtotal,
            tax_rate: invoiceData.taxRate,
            tax_amount: invoiceData.taxAmount,
            total_amount: invoiceData.invoiceAmount,
            currency: purchaseOrder?.currency || 'PKR',
            status: 'Draft',
            payment_days: invoiceData.paymentDays || 30,
            notes: invoiceData.notes,
            items: invoiceData.items.filter(item => item.description && item.quantity > 0)
          };
          
          apiEndpoint = `${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'}/po-invoices`;
        }

        console.debug(`Creating ${invoicingMode}-based invoice:`, invoicePayload);
        
        const response = await fetch(apiEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(invoicePayload)
        });

        if (response.ok) {
          const result = await response.json();
          
          // Refresh PO summary to get updated remaining amount
          await fetchPOSummary();
          
          // Refresh invoice history to show the new invoice
          await fetchInvoiceHistory();
          
          if (invoicingMode === 'quantity') {
            alert(`Quantity-based invoice ${invoiceData.invoiceNumber} created successfully!\nTotal Items: ${result.invoice?.items?.length || 0}\nTotal Quantity: ${invoiceData.totalQuantity || 0}\nTotal Amount: PKR ${invoiceData.invoiceAmount.toLocaleString()}`);
          } else {
            alert(`Amount-based invoice ${invoiceData.invoiceNumber} created successfully!\nInvoice Amount: PKR ${invoiceData.invoiceAmount.toLocaleString()}\nRemaining PO Amount: PKR ${invoiceData.remainingAmount.toLocaleString()}`);
          }
          
          setShowInvoiceModal(false);
        } else {
          const errorData = await response.json().catch(() => ({ message: 'Failed to create invoice' }));
          throw new Error(errorData.details || errorData.message || 'Failed to create invoice');
        }
      } catch (error) {
        console.error('Error creating invoice:', error);
        alert(`Error creating ${invoicingMode}-based invoice: ${error.message}\n\nPlease try again.`);
      }
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-semibold text-gray-900">Create Invoice from PO</h2>
            <button
              onClick={() => setShowInvoiceModal(false)}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          
          <div className="space-y-6">
            {/* Invoicing Mode Toggle - Amount-Based removed per request */}
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <h4 className="font-medium text-blue-800 mb-3">Invoicing Method</h4>
              <div className="flex gap-4">
                {/* Amount-Based option removed - keeping only Quantity-Based
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="radio"
                    name="invoicingMode"
                    value="amount"
                    checked={invoicingMode === 'amount'}
                    onChange={(e) => setInvoicingMode(e.target.value)}
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <span className="font-medium text-gray-700">Amount-Based</span>
                  <span className="text-sm text-gray-500">(Invoice by total amount)</span>
                </label>
                */}
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="radio"
                    name="invoicingMode"
                    value="quantity"
                    checked={invoicingMode === 'quantity'}
                    onChange={(e) => setInvoicingMode(e.target.value)}
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <span className="font-medium text-gray-700">Quantity-Based</span>
                  <span className="text-sm text-gray-500">(Invoice by item quantities)</span>
                </label>
              </div>
              <p className="text-xs text-blue-600 mt-2">
                💡 Specify quantities for each item you want to invoice. Each item can have different quantities.
              </p>
            </div>

            {/* Invoice Basic Info */}
            <div className="grid md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Invoice Number</label>
                <input
                  type="text"
                  name="invoiceNumber"
                  value={invoiceData.invoiceNumber || 'Generating...'}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-gray-50"
                  readOnly
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Invoice Date</label>
                <input
                  type="date"
                  name="invoiceDate"
                  value={invoiceData.invoiceDate}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Payment Terms (Days)</label>
                <input
                  type="number"
                  name="paymentDays"
                  value={invoiceData.paymentDays}
                  onChange={handleInputChange}
                  min="1"
                  max="365"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., 30"
                />
                <p className="text-xs text-gray-500 mt-1">Days for payment (default from PO: {purchaseOrder?.paymentDays || 30})</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Payment Deadline</label>
                <input
                  type="date"
                  name="dueDate"
                  value={invoiceData.dueDate}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* PO Information & Invoice Amount/Quantity */}
            {invoicingMode === 'amount' ? (
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <div className="flex justify-between items-center mb-3">
                <h4 className="font-medium text-blue-800">Purchase Order Information</h4>
                {(() => {
                  const poSummary = getPOSummary();
                  return (
                    <div className="flex items-center space-x-2">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        poSummary.status === 'Fully Invoiced' ? 'bg-green-100 text-green-800' :
                        poSummary.status === 'Partially Invoiced' ? 'bg-blue-100 text-blue-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {poSummary.status}
                      </span>
                      <span className="text-xs text-blue-600 font-medium">
                        {Number(poSummary.invoicingPercentage || 0).toFixed(1)}% Invoiced
                      </span>
                    </div>
                  );
                })()}
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-blue-700 mb-2">PO Number</label>
                    <input
                      type="text"
                      value={purchaseOrder?.number || ''}
                      className="w-full px-3 py-2 border border-blue-300 rounded-lg bg-blue-25 text-blue-800"
                      readOnly
                    />
                  </div>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-blue-700 mb-2">PO Total Amount</label>
                    <input
                      type="text"
                      value={`PKR ${(purchaseOrder?.totalAmount || 0).toLocaleString()}`}
                      className="w-full px-3 py-2 border border-blue-300 rounded-lg bg-blue-25 text-blue-800"
                      readOnly
                    />
                  </div>
                  {(() => {
                    const poSummary = getPOSummary();
                    return (
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-blue-700 mb-2">Already Invoiced</label>
                        <input
                          type="text"
                          value={`PKR ${poSummary.totalInvoiced.toLocaleString()}`}
                          className="w-full px-3 py-2 border border-blue-300 rounded-lg bg-orange-25 text-orange-800"
                          readOnly
                        />
                      </div>
                    );
                  })()}
                </div>
                <div>
                  {(() => {
                    const poSummary = getPOSummary();
                    const availableAmount = poSummary.remainingAmount;
                    
                    return (
                      <>
                        <div className="mb-4">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Available to Invoice</label>
                          <input
                            type="text"
                            value={`PKR ${availableAmount.toLocaleString()}`}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
                            readOnly
                          />
                        </div>
                        <div className="mb-4">
                          <label className="block text-sm font-medium text-blue-700 mb-2">
                            Invoice Amount * (This controls the total invoice value)
                          </label>
                          <p className="text-xs text-blue-600 mb-2">
                            💡 Enter the amount you want to invoice from this PO. You can create partial invoices.
                          </p>
                          <input
                            type="number"
                            value={invoiceData.invoiceAmount}
                            onChange={handleInvoiceAmountChange}
                            className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
                              invoiceData.exceedsAvailable ? 'border-red-300 bg-red-50' : 'border-blue-300'
                            }`}
                            min="0"
                            max={availableAmount}
                            step="0.01"
                            placeholder="Enter amount to invoice"
                          />
                          {invoiceData.exceedsAvailable && (
                            <div className="text-xs text-red-600 mt-1">
                              ⚠️ Amount exceeds available balance. Maximum allowed: PKR {availableAmount.toLocaleString()}
                            </div>
                          )}
                          <div className="text-xs text-gray-600 mt-1">
                            After this invoice, remaining: PKR {(() => {
                              const summary = getPOSummary();
                              return (summary.remainingAmount - (invoiceData.invoiceAmount || 0)).toLocaleString();
                            })()}
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
            ) : (
            // Quantity-based PO Information
            <div className="bg-white p-4 rounded-lg border border-gray-300">
              <div className="flex justify-between items-center mb-3">
                <h4 className="font-medium text-gray-900">Purchase Order - Quantity-Based Invoicing</h4>
                <div className="flex items-center space-x-2">
                  <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700">
                    Quantity Based
                  </span>
                </div>
              </div>
              
              <div className="grid md:grid-cols-2 gap-4 mb-4">
                <div>
                  <div className="mb-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">PO Number</label>
                    <input
                      type="text"
                      value={purchaseOrder?.number || ''}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
                      readOnly
                    />
                  </div>
                  <div className="mb-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">PO Total Amount</label>
                    <input
                      type="text"
                      value={`PKR ${(purchaseOrder?.totalAmount || 0).toLocaleString()}`}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
                      readOnly
                    />
                  </div>
                </div>
                <div>
                  {loadingItems ? (
                    <div className="flex items-center justify-center py-4">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-500"></div>
                      <span className="ml-2 text-gray-700">Loading items...</span>
                    </div>
                  ) : (
                    <>
                      <div className="mb-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Total PO Quantity</label>
                        <input
                          type="text"
                          value={calculateTotalQuantity(poItemsWithTracking).toLocaleString()}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
                          readOnly
                        />
                      </div>
                      <div className="mb-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Available to Invoice (Qty)</label>
                        <input
                          type="text"
                          value={calculateRemainingQuantity(poItemsWithTracking).toLocaleString()}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
                          readOnly
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Quantity Items Table */}
              {!loadingItems && poItemsWithTracking.length > 0 && (
                <div className="mt-4">
                  <h5 className="font-medium text-gray-700 mb-3">Select Quantities</h5>
                  <div className="overflow-x-auto max-h-64 overflow-y-auto">
                    <table className="w-full border-collapse border border-gray-300">
                      <thead className="bg-gray-100 sticky top-0">
                        <tr>
                          <th className="border border-gray-300 px-3 py-2 text-left text-sm font-medium text-gray-900">Item</th>
                          <th className="border border-gray-300 px-3 py-2 text-center text-sm font-medium text-gray-900">PO Qty</th>
                          <th className="border border-gray-300 px-3 py-2 text-center text-sm font-medium text-gray-900">Net Weight (KG)</th>
                          <th className="border border-gray-300 px-3 py-2 text-center text-sm font-medium text-gray-900">Available</th>
                          <th className="border border-gray-300 px-3 py-2 text-center text-sm font-medium text-gray-900">Invoice Qty</th>
                          <th className="border border-gray-300 px-3 py-2 text-center text-sm font-medium text-gray-900">Rate</th>
                          <th className="border border-gray-300 px-3 py-2 text-center text-sm font-medium text-gray-900">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoiceData.quantityItems.map((item, index) => (
                          <tr key={index} className={
                            safeParseFloat(item.remaining_quantity) <= 0 
                              ? 'bg-red-50' 
                              : safeParseFloat(item.invoiced_quantity) > 0 
                                ? 'bg-gray-50 border-gray-300' 
                                : 'bg-white hover:bg-gray-50'
                          }>
                            <td className="border border-gray-300 px-3 py-2 text-sm">
                              <div className="font-medium">{item.description}</div>
                              <div className="text-xs text-gray-500">Unit: {item.unit}</div>
                              {item.item_status !== 'Not Invoiced' && (
                                <span className={`text-xs px-2 py-1 rounded ${
                                  item.item_status === 'Fully Invoiced' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                                }`}>
                                  {item.item_status}
                                </span>
                              )}
                            </td>
                            <td className="border border-gray-300 px-3 py-2 text-center text-sm">
                              {safeParseFloat(item.po_quantity).toLocaleString()}
                            </td>
                            <td className="border border-gray-300 px-3 py-2 text-center text-sm">
                              {safeParseFloat(item.net_weight || 0).toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="border border-gray-300 px-3 py-2 text-center text-sm">
                              <span className={safeParseFloat(item.remaining_quantity) <= 0 ? 'text-red-600 font-medium' : 'text-gray-600'}>
                                {safeParseFloat(item.remaining_quantity).toLocaleString()}
                              </span>
                            </td>
                            <td className="border border-gray-300 px-3 py-2 text-center">
                              <input
                                type="number"
                                min="0"
                                max={safeParseFloat(item.remaining_quantity)}
                                step="0.01"
                                value={item.invoiced_quantity}
                                onChange={(e) => handleQuantityChange(index, e.target.value)}
                                disabled={safeParseFloat(item.remaining_quantity) <= 0}
                                className={`w-20 px-2 py-1 border rounded text-center text-sm ${
                                  safeParseFloat(item.remaining_quantity) <= 0 
                                    ? 'border-red-300 bg-red-50 text-red-500' 
                                    : 'border-gray-300 focus:ring-2 focus:ring-blue-500'
                                }`}
                                placeholder="0"
                              />
                            </td>
                            <td className="border border-gray-300 px-3 py-2 text-center text-sm">
                              PKR {safeParseFloat(item.unit_price).toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="border border-gray-300 px-3 py-2 text-center text-sm font-medium">
                              PKR {(item.amount || 0).toLocaleString('en-PK', { minimumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  
                  {/* Quantity Summary */}
                  <div className="mt-4 bg-gray-100 p-3 rounded border border-gray-300">
                    <div className="flex justify-between items-center text-sm">
                      <span className="font-medium text-gray-700">Total Quantity:</span>
                      <span className="font-bold text-gray-900">{invoiceData.totalQuantity || 0}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="font-medium text-gray-700">Total Invoice Amount:</span>
                      <span className="font-bold text-gray-900">PKR {(invoiceData.invoiceAmount || 0).toLocaleString('en-PK')}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
            )}

            {/* Customer Info */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <h4 className="font-medium text-gray-700 mb-3">Supplier Information</h4>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Supplier Name</label>
                  <input
                    type="text"
                    name="name"
                    value={invoiceData.supplier.name}
                    onChange={handleSupplierChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    name="email"
                    value={invoiceData.supplier.email}
                    onChange={handleSupplierChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input
                    type="tel"
                    name="phone"
                    value={invoiceData.supplier.phone}
                    onChange={handleSupplierChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    pattern="[0-9\-\+\(\)\s]*"
                    placeholder="Enter phone number"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                  <input
                    type="text"
                    name="address"
                    value={invoiceData.supplier.address}
                    onChange={handleSupplierChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Items Table - Different for each mode */}
            {invoicingMode === 'amount' ? (
            <div className="bg-gray-50 p-4 rounded-lg">
              <h4 className="font-medium text-gray-700 mb-3">Invoice Items (From Purchase Order)</h4>
              <p className="text-sm text-gray-600 mb-3">
                ℹ️ Items are from the Purchase Order and cannot be modified in amount-based invoicing
              </p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse border border-gray-300">
                  <thead>
                    <tr className="bg-gray-200">
                      <th className="border border-gray-300 px-3 py-2 text-left text-sm font-medium">Description</th>
                      <th className="border border-gray-300 px-3 py-2 text-center text-sm font-medium">Quantity</th>
                      <th className="border border-gray-300 px-3 py-2 text-center text-sm font-medium">Net Weight (KG)</th>
                      <th className="border border-gray-300 px-3 py-2 text-center text-sm font-medium">Rate</th>
                      <th className="border border-gray-300 px-3 py-2 text-center text-sm font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoiceData.items.map((item, index) => (
                      <tr key={index} className="bg-gray-100">
                        <td className="border border-gray-300 px-3 py-2">
                          <div className="px-2 py-1 text-gray-700 bg-gray-100 rounded">
                            {item.description}
                          </div>
                        </td>
                        <td className="border border-gray-300 px-3 py-2 text-center">
                          <div className="px-2 py-1 text-gray-700 bg-gray-100 rounded text-center">
                            {item.quantity}
                          </div>
                        </td>
                        <td className="border border-gray-300 px-3 py-2 text-center">
                          <div className="px-2 py-1 text-gray-700 bg-gray-100 rounded text-center">
                            {(item.netWeight || 0).toLocaleString('en-PK', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2
                            })} KG
                          </div>
                        </td>
                        <td className="border border-gray-300 px-3 py-2 text-center print:text-center">
                          <div className="px-2 py-1 text-gray-700 bg-gray-100 rounded text-center">
                            {(item.unitPrice || 0).toLocaleString('en-PK', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2
                            })}
                          </div>
                        </td>
                        <td className="border border-gray-300 px-3 py-2 text-center font-medium print:text-center">
                          <div className="px-2 py-1 text-gray-700 bg-gray-100 rounded text-center font-medium">
                            PKR {(item.amount || 0).toLocaleString('en-PK', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2
                            })}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            ) : (
            <div className="bg-green-50 p-4 rounded-lg">
              <h4 className="font-medium text-green-700 mb-3">Quantity-Based Invoice Items</h4>
              <p className="text-sm text-green-600 mb-3">
                ✅ Items with specified quantities will be included in the invoice
              </p>
              <div className="text-sm text-green-700">
                Items to be invoiced: <strong>{invoiceData.quantityItems?.filter(item => item.invoiced_quantity > 0).length || 0}</strong> of <strong>{invoiceData.quantityItems?.length || 0}</strong> available
              </div>
              <div className="text-sm text-green-700">
                Total quantity: <strong>{invoiceData.totalQuantity || 0}</strong> units
              </div>
              <div className="text-sm text-green-700">
                Invoice amount: <strong>PKR {(invoiceData.invoiceAmount || 0).toLocaleString('en-PK')}</strong>
              </div>
            </div>
            )}

            {/* Summary Totals */}
            <div className={`p-6 rounded-lg border ${invoicingMode === 'quantity' ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'}`}>
              <h4 className="font-semibold text-gray-800 mb-4 text-lg">
                {invoicingMode === 'quantity' ? 'Quantity-Based Invoice Summary' : 'Amount-Based Invoice Summary'}
              </h4>
              <div className="space-y-3">
                {/* Total PO Amount/Quantity */}
                <div className="flex justify-between items-center py-2 border-b border-gray-200">
                  <span className="font-medium text-gray-700">Total PO {invoicingMode === 'quantity' ? 'Quantity' : 'Amount'}:</span>
                  <span className="font-bold text-lg">
                    {invoicingMode === 'quantity' 
                      ? `${calculateTotalQuantity(poItemsWithTracking).toLocaleString()} units`
                      : `PKR ${(purchaseOrder?.totalAmount || 0).toLocaleString('en-PK')}/-`
                    }
                  </span>
                </div>
                
                {/* Total Invoice Amount/Quantity */}
                <div className={`flex justify-between items-center py-2 border-b ${invoicingMode === 'quantity' ? 'border-green-200' : 'border-blue-200'}`}>
                  <span className={`font-medium ${invoicingMode === 'quantity' ? 'text-green-700' : 'text-blue-700'}`}>
                    Total Invoice {invoicingMode === 'quantity' ? 'Quantity' : 'Amount'}:
                  </span>
                  <span className={`font-bold text-lg ${invoicingMode === 'quantity' ? 'text-green-600' : 'text-blue-600'}`}>
                    {invoicingMode === 'quantity' 
                      ? `${invoiceData.totalQuantity || 0} units`
                      : `PKR ${(invoiceData.invoiceAmount || 0).toLocaleString('en-PK')}/-`
                    }
                  </span>
                </div>
                
                {/* Invoice Amount (for quantity mode) */}
                {invoicingMode === 'quantity' && (
                  <div className="flex justify-between items-center py-2 border-b border-green-200">
                    <span className="font-medium text-green-700">Total Invoice Amount:</span>
                    <span className="font-bold text-lg text-green-600">PKR {(invoiceData.invoiceAmount || 0).toLocaleString('en-PK')}/-</span>
                  </div>
                )}
                
                {/* Remaining Amount/Quantity */}
                <div className="flex justify-between items-center py-2 bg-gray-50 px-4 rounded-md border border-gray-200">
                  <span className="font-medium text-gray-700">
                    Remaining {invoicingMode === 'quantity' ? 'Quantity' : 'Amount'}:
                  </span>
                  <span className="font-bold text-lg text-gray-600">
                    {invoicingMode === 'quantity' 
                      ? `${Math.max(0, calculateRemainingQuantity(poItemsWithTracking) - safeParseFloat(invoiceData.totalQuantity)).toLocaleString()} units`
                      : `PKR ${((purchaseOrder?.totalAmount || 0) - (invoiceData.invoiceAmount || 0)).toLocaleString('en-PK')}/-`
                    }
                  </span>
                </div>

                {/* Tax Rate (Read-only) */}
                <div className="flex justify-between items-center py-2 bg-blue-50 px-4 rounded-md border border-blue-200">
                  <span className="font-medium text-blue-700">Tax Rate (Fixed at PO Creation):</span>
                  <span className="font-bold text-lg text-blue-600">{purchaseOrder?.taxRate || 0}%</span>
                </div>

                {/* Tax Amount (Read-only) */}
                <div className="flex justify-between items-center py-2 bg-blue-50 px-4 rounded-md border border-blue-200">
                  <span className="font-medium text-blue-700">Tax Amount:</span>
                  <span className="font-bold text-lg text-blue-600">PKR {(purchaseOrder?.taxAmount || 0).toLocaleString('en-PK')}/-</span>
                </div>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
              <textarea
                name="notes"
                value={invoiceData.notes}
                onChange={handleInputChange}
                rows="3"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="Additional notes or terms..."
              />
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
              <button
                type="button"
                onClick={() => setShowInvoiceModal(false)}
                className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateInvoice}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Create Invoice
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        <span className="ml-2 text-gray-600">Loading purchase order...</span>
      </div>
    );
  }

  if (!purchaseOrder) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">Purchase order not found</p>
        <button 
          onClick={onBack}
          className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
        >
          Back to List
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 p-4 sm:p-6 border-b border-gray-200">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Back to Purchase Orders</span>
          </button>
        </div>
        
        <div className="flex gap-2">
          {/* Make Invoice button: show if PO status allows invoicing, regardless of remaining amount */}
          {(() => {
            const blockedStatuses = ['Draft', 'Pending'];
            const isBlocked = blockedStatuses.includes(purchaseOrder?.status);
            const isFullyInvoiced = poSummary.remainingAmount <= 0 && poSummary.totalInvoiced > 0;
            const btnDisabled = isBlocked || loadingHistory;

            return (
              <button
                onClick={async () => {
                  // Prevent action when blocked
                  if (isBlocked) return;

                  // Refresh PO summary and fetch latest invoice history before opening modal
                  setLoadingHistory(true);
                  await fetchPOSummary();
                  await fetchInvoiceHistory();
                  setLoadingHistory(false);
                  setShowInvoiceModal(true);
                }}
                disabled={btnDisabled}
                title={isBlocked ? 'Cannot create invoice for Draft or Pending purchase orders' : isFullyInvoiced ? 'This PO is already fully invoiced' : 'Create an invoice from this PO'}
                className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors ${btnDisabled ? 'bg-gray-200 text-gray-600 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
              >
                {loadingHistory ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>Loading...</span>
                  </>
                ) : (
                  <>
                    <Edit className="w-4 h-4" />
                    <span>{isBlocked ? 'Cannot Make Invoice' : isFullyInvoiced ? 'Fully Invoiced' : 'Make Invoice'}</span>
                  </>
                )}
              </button>
            );
          })()}
          
          {/* Show fully invoiced message when PO is complete */}
          {poSummary.remainingAmount <= 0 && poSummary.totalInvoiced > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 bg-green-100 text-green-700 rounded-md">
              <div className="w-4 h-4 rounded-full bg-green-500"></div>
              <span>Fully Invoiced</span>
            </div>
          )}
          <button
            onClick={() => setShowPaymentHistory(!showPaymentHistory)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
          >
            {showPaymentHistory ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            <span>{showPaymentHistory ? 'Hide' : 'Show'} Invoice & Payment History</span>
          </button>

          <button
            onClick={generatePDF}
            className="flex items-center gap-2 px-4 py-2 bg-green-100 text-green-700 rounded-md hover:bg-green-200 transition-colors"
          >
            <Printer className="w-4 h-4" />
            <span>Print</span>
          </button>

        </div>
      </div>

      {/* Purchase Order Content */}
      <div ref={poRef} className="bg-white rounded-lg shadow-sm overflow-hidden">
        
        {/* Company Header - Matching Invoice Layout */}
        <div className="relative px-8 py-6 border-b border-gray-400">
          {/* Company Logo and Info - Centered */}
          <div className="relative z-10 text-center mb-4">
            <div className="flex justify-center mb-3">
              <img src={Logo} alt="A Rauf Textile" className="h-32 w-auto object-contain" style={{ maxWidth: '280px' }} />
            </div>
            <div className="text-sm text-gray-700">
              <p className="text-xs">Deals in all kind of Greige & Dyed Fabric</p>
              <p className="text-xs mt-1"><strong>STRN #</strong> 32-77-8761-279-54</p>
              <p className="text-xs"><strong>NTN #</strong> 7225539-1</p>
            </div>
          </div>

          {/* Title Section */}
          <div className="relative z-10 text-center mb-4 border-t border-gray-300 pt-4">
            <h1 className="text-xl font-bold text-gray-800 uppercase tracking-wide">PURCHASE ORDER</h1>
          </div>

          {/* PO Info Grid */}
          <div className="relative z-10 border-t border-gray-400 pt-4">
            <div className="grid grid-cols-2 gap-8 mb-4">
              {/* Left Column - PO Details */}
              <div className="space-y-1 text-sm">
                <div className="flex">
                  <span className="font-semibold text-gray-700 w-32">PO Number :</span>
                  <span className="text-gray-800">{purchaseOrder.number}</span>
                </div>
                <div className="flex">
                  <span className="font-semibold text-gray-700 w-32">Date :</span>
                  <span className="text-gray-800">{new Date(purchaseOrder.date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                </div>
              </div>

              {/* Right Column - Delivery & Status */}
              <div className="text-right space-y-1">
                <div className="text-sm">
                  <span className="font-semibold text-gray-700">Delivery Date: </span>
                  <span className="text-gray-800">{new Date(purchaseOrder.deliveryDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                </div>
                <div className="text-sm">
                  <span className="font-semibold text-gray-700">Status: </span>
                  <span className={`ml-2 px-3 py-1 rounded-full text-xs font-medium ${
                    purchaseOrder.status === 'Pending' ? 'bg-orange-100 text-orange-800' :
                    purchaseOrder.status === 'Approved' ? 'bg-blue-100 text-blue-800' :
                    purchaseOrder.status === 'In Transit' ? 'bg-purple-100 text-purple-800' :
                    purchaseOrder.status === 'Delivered' ? 'bg-green-100 text-green-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {purchaseOrder.status}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Supplier Information Section */}
          <div className="relative z-10 border border-gray-400 p-4 mb-4">
            <h3 className="font-bold text-gray-800 mb-3 underline text-sm">Supplier Information :</h3>
            <div className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm">
              <div className="flex">
                <span className="font-semibold text-gray-700 w-40">Name :</span>
                <span className="text-gray-800 font-bold">{purchaseOrder.supplier.name}</span>
              </div>
              <div className="flex">
                <span className="font-semibold text-gray-700 w-48">Company :</span>
                <span className="text-gray-800">{purchaseOrder.supplier.company}</span>
              </div>
              <div className="flex">
                <span className="font-semibold text-gray-700 w-40">Email :</span>
                <span className="text-gray-800">{purchaseOrder.supplier.email}</span>
              </div>
              <div className="flex">
                <span className="font-semibold text-gray-700 w-48">Phone :</span>
                <span className="text-gray-800">{purchaseOrder.supplier.phone}</span>
              </div>
              <div className="flex col-span-2">
                <span className="font-semibold text-gray-700 w-40">Address :</span>
                <span className="text-gray-800">{purchaseOrder.supplier.address}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Items Table Section */}
        <div className="px-8 py-6">
          {/* PO Table - Invoice Style */}
          <div className="mb-6">
            <div className="overflow-x-auto border-2 border-gray-400">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-200 border-b-2 border-gray-400">
                    <th className="py-3 px-2 text-center text-xs font-bold text-gray-800 border-r border-gray-400">S.No</th>
                    <th className="py-3 px-3 text-center text-xs font-bold text-gray-800 border-r border-gray-400">Description</th>
                    <th className="py-3 px-3 text-center text-xs font-bold text-gray-800 border-r border-gray-400">Quantity</th>
                    <th className="py-3 px-3 text-center text-xs font-bold text-gray-800 border-r border-gray-400">Net Weight (KG)</th>
                    <th className="py-3 px-3 text-center text-xs font-bold text-gray-800 border-r border-gray-400">Rate</th>
                    <th className="py-3 px-3 text-center text-xs font-bold text-gray-800">Total Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(purchaseOrder.items || []).length > 0 ? (
                    purchaseOrder.items.map((item, index) => (
                      <tr key={index} className="border-b border-gray-300">
                        <td className="py-4 px-2 text-sm text-gray-800 text-center border-r border-gray-300 font-semibold">{index + 1}</td>
                        <td className="py-4 px-3 text-sm text-gray-800 border-r border-gray-300">
                          <div className="font-medium">{item.description || 'N/A'}</div>
                        </td>
                        <td className="py-4 px-3 text-sm text-gray-800 text-center border-r border-gray-300">{parseFloat(item.quantity || 0).toLocaleString()}</td>
                        <td className="py-4 px-3 text-sm text-gray-800 text-center border-r border-gray-300">{parseFloat(item.netWeight || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} KG</td>
                        <td className="py-4 px-3 text-sm text-gray-800 text-center border-r border-gray-300">{purchaseOrder.currency} {parseFloat(item.unitPrice || item.unit_price || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        <td className="py-4 px-3 text-sm font-semibold text-gray-900 text-center">{purchaseOrder.currency} {parseFloat(item.total || item.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    ))
                  ) : (
                    <tr className="border-b border-gray-300">
                      <td colSpan="6" className="py-8 px-4 text-center text-sm text-gray-500">
                        No items found for this purchase order
                      </td>
                    </tr>
                  )}
                  {/* Total Row */}
                  <tr className="bg-gray-100 border-t-2 border-gray-400">
                    <td className="py-3 px-2 border-r border-gray-300"></td>
                    <td className="py-3 px-3 text-sm font-bold text-gray-800 border-r border-gray-300">TOTAL</td>
                    <td className="py-3 px-3 text-sm text-gray-800 text-center border-r border-gray-300">
                      {purchaseOrder.items ? purchaseOrder.items.reduce((sum, item) => sum + parseFloat(item.quantity || 0), 0).toLocaleString() : 0}
                    </td>
                    <td className="py-3 px-3 text-sm text-gray-800 text-center border-r border-gray-300">
                      {purchaseOrder.items ? purchaseOrder.items.reduce((sum, item) => sum + parseFloat(item.netWeight || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2 }) : 0} KG
                    </td>
                    <td className="py-3 px-3 border-r border-gray-300"></td>
                    <td className="py-3 px-3 text-sm font-bold text-gray-900 text-center">{purchaseOrder.currency} {parseFloat(purchaseOrder.totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Summary Section */}
          <div className="mb-6 border border-gray-300 p-4">
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <div className="mb-3">
                  <span className="font-semibold text-gray-800">Amount Breakdown:</span>
                </div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-700">Subtotal:</span>
                    <span className="font-semibold text-gray-900">{purchaseOrder.currency} {parseFloat(purchaseOrder.subtotal || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-700">Tax ({purchaseOrder.taxRate}%):</span>
                    <span className="font-semibold text-gray-900">{purchaseOrder.currency} {parseFloat(purchaseOrder.taxAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-gray-300">
                    <span className="font-bold text-gray-800">Total Amount:</span>
                    <span className="font-bold text-gray-900">{purchaseOrder.currency} {parseFloat(purchaseOrder.totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

        {/* Invoice & Payment History */}
        {showPaymentHistory && (
          <div className="mb-8">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900 pb-2 border-b border-gray-200">Invoice & Payment History</h3>
              <button
                onClick={fetchInvoiceHistory}
                className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                disabled={loadingHistory}
              >
                {loadingHistory ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
            
            {loadingHistory ? (
              <div className="flex justify-center items-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
                <span className="ml-2 text-gray-600">Loading history...</span>
              </div>
            ) : invoiceHistory.length > 0 ? (
              <div className="space-y-4">
                {/* Enhanced Summary Card */}
                {(() => {
                  const summary = getPOSummary();
                  return (
                    <div className="bg-gradient-to-r from-blue-50 to-green-50 p-6 rounded-lg border border-blue-200 shadow-sm">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 text-sm">
                        <div className="text-center">
                          <p className="font-semibold text-blue-800 mb-1">PO Total Amount</p>
                          <p className="text-xl font-bold text-blue-600">PKR {summary.poTotal.toLocaleString()}</p>
                        </div>
                        <div className="text-center">
                          <p className="font-semibold text-green-800 mb-1">Total Invoiced</p>
                          <p className="text-xl font-bold text-green-600">PKR {summary.totalInvoiced.toLocaleString()}</p>
                          <p className="text-xs text-green-500">{summary.invoicingPercentage}% of PO</p>
                        </div>
                        <div className="text-center">
                          <p className="font-semibold text-orange-800 mb-1">Remaining to Invoice</p>
                          <p className="text-xl font-bold text-orange-600">PKR {summary.remainingAmount.toLocaleString()}</p>
                          <p className="text-xs text-orange-500">{Number(100 - Number(summary.invoicingPercentage || 0)).toFixed(2)}% remaining</p>
                        </div>
                        <div className="text-center">
                          <p className="font-semibold text-purple-800 mb-1">Invoice Count</p>
                          <p className="text-xl font-bold text-purple-600">{summary.invoiceCount}</p>
                          <p className="text-xs text-purple-500">{summary.invoiceCount > 1 ? 'Multiple invoices' : summary.invoiceCount === 1 ? 'Single invoice' : 'No invoices'}</p>
                        </div>
                        <div className="text-center">
                          <p className="font-semibold text-gray-800 mb-1">Status</p>
                          <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
                            summary.status === 'Fully Invoiced' ? 'bg-green-100 text-green-800' :
                            summary.status === 'Partially Invoiced' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {summary.status}
                          </span>
                        </div>
                      </div>
                      
                      {/* Progress Bar */}
                      <div className="mt-4">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-xs font-medium text-gray-700">Invoicing Progress</span>
                          <span className="text-xs font-medium text-gray-700">{summary.invoicingPercentage}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div 
                            className={`h-2 rounded-full transition-all duration-300 ${
                              summary.invoicingPercentage === 100 ? 'bg-green-500' : 
                              summary.invoicingPercentage > 50 ? 'bg-yellow-500' : 'bg-blue-500'
                            }`}
                            style={{ width: `${Math.min(summary.invoicingPercentage, 100)}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Invoice List */}
                {invoiceHistory.map((invoice, index) => (
                  <div key={invoice.id || index} className="bg-white border rounded-lg p-4 shadow-sm">
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h4 className="font-semibold text-gray-900">{invoice.invoice_number}</h4>
                          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                            invoice.status === 'Paid' ? 'bg-green-100 text-green-800' :
                            invoice.status === 'Sent' ? 'bg-blue-100 text-blue-800' :
                            invoice.status === 'Draft' ? 'bg-gray-100 text-gray-800' :
                            invoice.status === 'Overdue' ? 'bg-red-100 text-red-800' :
                            'bg-orange-100 text-orange-800'
                          }`}>
                            {invoice.status}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
                          <div>
                            <p className="font-medium">Invoice Date:</p>
                            <p>{new Date(invoice.invoice_date).toLocaleDateString()}</p>
                          </div>
                          <div>
                            <p className="font-medium">Supplier:</p>
                            <p>{purchaseOrder.supplier.name || 'N/A'}</p>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-blue-600">
                          PKR {(parseFloat(invoice.invoice_amount || invoice.total_amount) || 0).toLocaleString()}
                        </p>
                        <p className="text-xs text-gray-500">
                          Created: {new Date(invoice.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>

                    {/* Payment Information */}
                    {invoice.status === 'Paid' && (
                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <div className="flex items-center gap-2 text-sm text-green-700">
                          <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                          <span className="font-medium">Payment Completed</span>
                          <span className="text-gray-500">•</span>
                          <span>Full amount received</span>
                        </div>
                      </div>
                    )}

                    {invoice.status === 'Overdue' && (
                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <div className="flex items-center gap-2 text-sm text-red-700">
                          <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                          <span className="font-medium">Payment Overdue</span>
                          <span className="text-gray-500">•</span>
                          <span>
                            {invoice.due_date && new Date() > new Date(invoice.due_date) 
                              ? `${Math.ceil((new Date() - new Date(invoice.due_date)) / (1000 * 60 * 60 * 24))} days overdue`
                              : 'Payment pending'
                            }
                          </span>
                        </div>
                      </div>
                    )}

                    {invoice.status === 'Pending' && (
                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-sm text-orange-700">
                            <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                            <span className="font-medium">Pending Payment</span>
                            <span className="text-gray-500">•</span>
                            <span>
                              {invoice.due_date 
                                ? `Due ${new Date(invoice.due_date).toLocaleDateString()}`
                                : 'No due date set'
                              }
                            </span>
                          </div>
                          <button
                            onClick={() => updateInvoiceStatus(invoice.id, 'Paid')}
                            className="px-3 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200"
                          >
                            Mark as Paid
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Notes */}
                    {invoice.notes && (
                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <p className="text-sm text-gray-600">
                          <span className="font-medium">Notes:</span> {invoice.notes}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                <p className="text-gray-500 mb-2">No invoices created for this purchase order yet</p>
                <p className="text-sm text-gray-400">Click "Make Invoice" to create the first invoice</p>
              </div>
            )}
          </div>
        )}

          {/* Terms and Conditions - Inside PO Card */}
          <div className="mb-6 border border-gray-300 p-4">
            <h4 className="font-bold text-gray-800 mb-3">Terms and Conditions</h4>
            <p className="text-sm text-gray-700 leading-relaxed mb-4">{purchaseOrder.termsAndConditions}</p>
            
            {purchaseOrder.notes && (
              <>
                <h4 className="font-bold text-gray-800 mb-3">Special Notes</h4>
                <p className="text-sm text-gray-700 leading-relaxed">{purchaseOrder.notes}</p>
              </>
            )}
          </div>

          {/* Signature Section */}
          <div className="grid grid-cols-2 gap-8 border-t-2 border-gray-300 pt-6 mb-6">
            <div className="text-center">
              <div className="h-16 mb-2"></div>
              <div className="border-t border-gray-400 pt-2">
                <span className="text-sm font-semibold text-gray-800">Prepared By</span>
              </div>
            </div>
            <div className="text-center">
              <div className="h-16 mb-2"></div>
              <div className="border-t border-gray-400 pt-2">
                <span className="text-sm font-semibold text-gray-800">Authorized By</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer - Company Info */}
        <div className="relative z-10 bg-[#E8D5A8] text-center py-3 rounded-b-lg border-t-2 border-gray-400">
          <p className="text-xs text-gray-700 mt-1">
            Deals in all kind of Greige & Dyed Fabric
          </p>
          <p className="text-xs text-gray-500 mt-2">
            Generated on {new Date().toLocaleDateString()} | Created by {purchaseOrder.createdBy}
            {purchaseOrder.approvedBy && ` | Approved by ${purchaseOrder.approvedBy}`}
          </p>
        </div>
      </div>
      
      {/* Invoice Modal */}
      {showInvoiceModal && <InvoiceModal />}
    </div>
  );
};

export default PurchaseOrderDetails;