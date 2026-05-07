import React, { useState, useEffect } from "react";
import { API_ENDPOINTS } from '../config/api';

const InvoiceForm = ({ initialData, onSubmit, onCancel }) => {
  // State for customers from database
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [filteredCustomers, setFilteredCustomers] = useState([]);
  const [companySettings, setCompanySettings] = useState(null);

  // State for invoice items (multiple items support)
  const [invoiceItems, setInvoiceItems] = useState([{
    id: 1,
    description: "",
    quantity: "",
    unit: "",
    rate: "",
    net_weight: "",
    amount: 0
  }]);

  const [formData, setFormData] = useState({
    invoiceNumber: "",
    customerName: "",
    customerEmail: "",
    phone: "",
    a_p_Name: "",
    address: "",
    stRegNo: "",
    ntnNumber: "",
    currency: "PKR",
    salesTax: 0,
    subtotal: 0,
    taxAmount: 0,
    totalAmount: 0,
    billDate: new Date().toISOString().split('T')[0], // Default to today
    paymentDeadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    paymentDays: 30, // Default to 30 days (user-editable)
    note: "",
  });

  // Fetch customers and company settings from database
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Fetch customers
        const customersResponse = await fetch(API_ENDPOINTS.CUSTOMERS.LIST);
        if (customersResponse.ok) {
          const customersData = await customersResponse.json();
          setCustomers(customersData);
          setFilteredCustomers(customersData);
        } else {
          console.error('Failed to fetch customers');
        }

        // Fetch company settings
        const settingsResponse = await fetch(API_ENDPOINTS.SETTINGS.COMPANY);
        if (settingsResponse.ok) {
          const settingsData = await settingsResponse.json();
          setCompanySettings(settingsData);
        }
        
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Filter customers based on search term
  useEffect(() => {
    if (searchTerm.length === 0) {
      setFilteredCustomers(customers);
      setShowDropdown(false);
    } else {
      const filtered = customers.filter(customer =>
        customer.customer.toLowerCase().includes(searchTerm.toLowerCase()) ||
        customer.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (customer.company && customer.company.toLowerCase().includes(searchTerm.toLowerCase()))
      );
      setFilteredCustomers(filtered);
      setShowDropdown(filtered.length > 0 && searchTerm.length > 0);
    }
  }, [searchTerm, customers]);

  // Handle initial data for editing
  useEffect(() => {
    if (initialData) {
      // Populate form with existing invoice data
      setFormData({
        invoiceNumber: initialData.invoice_number || initialData.invoiceNumber || '',
        customerName: initialData.customer_name || initialData.customerName || '',
        customerEmail: initialData.customer_email || initialData.customerEmail || '',
        phone: initialData.customer_phone || initialData.phone || '',
        a_p_Name: initialData.a_p_Name || '',
        address: initialData.customer_address || initialData.address || '',
        stRegNo: initialData.stRegNo || '',
        ntnNumber: initialData.ntnNumber || '',
        currency: initialData.currency || 'PKR',
        salesTax: initialData.tax_rate || initialData.salesTax,
        subtotal: initialData.subtotal || 0,
        taxAmount: initialData.tax_amount || initialData.taxAmount || 0,
        totalAmount: initialData.total_amount || initialData.totalAmount || 0,
        billDate: initialData.bill_date || initialData.billDate || new Date().toISOString().split('T')[0],
        paymentDeadline: initialData.payment_deadline || initialData.paymentDeadline || '',
        paymentDays: initialData.payment_days || initialData.paymentDays || 30,
        note: initialData.note || initialData.notes || '',
      });

      // Set search term to customer name for display
      setSearchTerm(initialData.customer_name || initialData.customerName || '');

      // Handle invoice items if they exist
      if (initialData.items && Array.isArray(initialData.items) && initialData.items.length > 0) {
        const mappedItems = initialData.items.map((item, index) => ({
          id: index + 1,
          description: item.description || item.item_name || '',
          quantity: item.quantity || '',
          unit: item.unit || item.uom || item.unit_name || '',
          rate: item.rate || item.unit_price || '',
          net_weight: item.net_weight !== undefined && item.net_weight !== null ? item.net_weight : '',
          amount: item.amount || item.total || 0
        }));
        setInvoiceItems(mappedItems);
      } else if (initialData.item_name) {
        // Handle single item format
        setInvoiceItems([{
          id: 1,
          description: initialData.item_name,
          quantity: initialData.quantity || '',
          unit: initialData.unit || '',
          rate: initialData.rate || '',
          amount: initialData.total_amount || initialData.totalAmount || 0
        }]);
      }
    }
  }, [initialData]);

  // Handle customer selection from dropdown
  const handleCustomerSelect = (customer) => {
    setSearchTerm(customer.customer);
    setFormData((prev) => ({
      ...prev,
      customerName: customer.customer,
      customerEmail: customer.email,
      phone: customer.phone,
      a_p_Name: "", // Database doesn't have alternate phone, so keep empty
      address: customer.address,
      stRegNo: "", // Database doesn't have ST reg no, so keep empty
      ntnNumber: "", // Database doesn't have NTN number, so keep empty
    }));
    setShowDropdown(false);
  };

  // Check if customer exists in database
  const checkCustomerExists = (customerName) => {
    return customers.some(customer => 
      customer.customer.toLowerCase() === customerName.toLowerCase()
    );
  };

  // Handle input change for search
  const handleSearchChange = (e) => {
    // Allow letters and spaces only for customer name search
    let value = e.target.value || '';
    value = value.toString().replace(/[^A-Za-z\s]/g, '');
    // collapse multiple spaces to single space
    value = value.replace(/\s+/g, ' ');
    setSearchTerm(value);

    // Clear customer data if search term is cleared
    if (value === '') {
      setFormData((prev) => ({
        ...prev,
        customerName: "",
        customerEmail: "",
        phone: "",
        a_p_Name: "",
        address: "",
        stRegNo: "",
        ntnNumber: "",
      }));
    }
  };

  // Handle input focus
  const handleInputFocus = () => {
    if (searchTerm.length > 0) {
      setShowDropdown(filteredCustomers.length > 0);
    }
  };

  // Handle input blur
  const handleInputBlur = () => {
    // Delay hiding dropdown to allow for click events
    setTimeout(() => {
      setShowDropdown(false);
    }, 200);
  };

  // Handle form data changes
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  // Currency is fixed to PKR; no select or change handler required

  // Handle invoice item changes
  const handleItemChange = (index, field, value) => {
    const updatedItems = [...invoiceItems];
    updatedItems[index] = {
      ...updatedItems[index],
      [field]: value
    };

    // Calculate amount for this item
    if (field === 'quantity' || field === 'rate') {
      const quantity = parseFloat(updatedItems[index].quantity) || 0;
      const rate = parseFloat(updatedItems[index].rate) || 0;
      updatedItems[index].amount = quantity * rate;
    }

    setInvoiceItems(updatedItems);
  };

  // Add new item
  const addNewItem = () => {
    const newItem = {
      id: Date.now(),
      description: "",
      quantity: "",
      unit: '',
      rate: "",
      net_weight: "",
      amount: 0
    };
    setInvoiceItems([...invoiceItems, newItem]);
  };

  // Remove item
  const removeItem = (index) => {
    if (invoiceItems.length > 1) {
      const updatedItems = invoiceItems.filter((_, i) => i !== index);
      setInvoiceItems(updatedItems);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Ensure the typed name (either selected or manually entered) matches a loaded customer.
    // If the user typed the exact name but didn't click the suggestion, try to match and populate.
    const typedName = (formData.customerName || searchTerm || '').toString().trim();
    const matchedCustomer = customers.find(c => c.customer && c.customer.toLowerCase() === typedName.toLowerCase());
    if (matchedCustomer) {
      // populate form data from the matched customer (synchronous helper)
      handleCustomerSelect(matchedCustomer);
    }

    const exists = customers.some(c => c.customer && c.customer.toLowerCase() === typedName.toLowerCase());
    if (!exists) {
      alert("Contact Person not present. Kindly create new Contact Person first.");
      return;
    }

    if (!formData.customerName || !formData.customerEmail) {
      alert("Please fill in required contact person information (Name and Email are required).");
      return;
    }

    // Validate contact person name contains only letters and spaces
    const nameVal = (formData.customerName || '').toString().trim();
    if (!/^[A-Za-z]+(?:\s[A-Za-z]+)*$/.test(nameVal)) {
      alert('Contact Person name can contain letters and spaces only');
      return;
    }

    // Validate that at least one item exists and has required fields
    const validItems = invoiceItems.filter(item => 
      item.description && item.quantity && item.rate
    );

    if (validItems.length === 0) {
      alert("Please add at least one item with description, quantity, and rate.");
      return;
    }

    // Validate required dates
    if (!formData.billDate) {
      alert("Bill Date is required.");
      return;
    }

    // Payment days is required (user-editable)
    if (formData.paymentDays === null || formData.paymentDays === undefined || formData.paymentDays === '') {
      alert("Payment Days is required");
      return;
    }
    if (!formData.paymentDeadline) {
      alert("Payment Deadline is required.");
      return;
    }


    const parsedPaymentDays = Number(formData.paymentDays);
    if (isNaN(parsedPaymentDays) || parsedPaymentDays < 0 || parsedPaymentDays > 365) {
      alert('Payment Days must be a number between 0 and 365');
      return;
    }

    try {
  console.debug("Submitting invoice with data:", { formData, invoiceItems }); // Debug log
      
      // Prepare invoice data
      const invoiceData = {
        invoice_number: formData.invoiceNumber || undefined,
        customer_name: formData.customerName,
        customer_email: formData.customerEmail,
        p_number: formData.phone,
        a_p_number: formData.a_p_Name,
        address: formData.address,
        st_reg_no: formData.stRegNo,
        ntn_number: formData.ntnNumber,
  // Currency is fixed to PKR (no dropdown)
  currency: 'PKR',
        subtotal: parseFloat(formData.subtotal) || 0,
        tax_rate: parseFloat(formData.salesTax) || 0,
        tax_amount: parseFloat(formData.taxAmount) || 0,
        total_amount: parseFloat(formData.totalAmount) || 0,
  bill_date: formData.billDate,
  payment_deadline: formData.paymentDeadline,
  payment_days: Number(formData.paymentDays),
        note: formData.note,
        status: "Pending",
        items: validItems.map((item, index) => ({
          item_no: index + 1,
          description: item.description,
          quantity: parseFloat(item.quantity) || 0,
          unit: item.unit || '',
          rate: parseFloat(item.rate) || 0,
          net_weight: item.net_weight !== undefined && item.net_weight !== '' ? parseFloat(item.net_weight) : 0,
          amount: parseFloat(item.amount) || 0
        }))
      };

  console.debug("Sending invoice data to API:", invoiceData); // Debug log

      // Use onSubmit prop if provided (for integration), otherwise make direct API call
      if (onSubmit) {
        await onSubmit(invoiceData);
        return; // Exit early, let parent handle the success flow
      }

      // Direct API call for standalone usage
      const response = await fetch(API_ENDPOINTS.INVOICES.CREATE, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(invoiceData),
      });

      const data = await response.json();
  console.debug("API response:", data); // Debug log

      if (response.ok) {
        alert(`✅ Invoice created successfully! Invoice ID: ${data.id}`);
  console.debug("Invoice created:", data);
        
        // Reset form after successful submission
        setFormData({
          invoiceNumber: "",
          customerName: "",
          customerEmail: "",
          phone: "",
          a_p_Name: "",
          address: "",
          stRegNo: "",
          ntnNumber: "",
          currency: "PKR",
          salesTax: 0,
          subtotal: 0,
          taxAmount: 0,
          totalAmount: 0,
          billDate: new Date().toISOString().split('T')[0],
          paymentDeadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          paymentDays: 30,
          note: "",
        });
        
        // Reset items
        setInvoiceItems([{
          id: 1,
          description: "",
          quantity: "",
          unit: '',
          rate: "",
          net_weight: "",
          amount: 0
        }]);
        
        // Reset search term
        setSearchTerm("");
        
      } else {
        console.error("API Error:", data);
        let errorMessage = data.error || data.message || "Failed to create invoice";
        alert(`❌ Error: ${errorMessage}`);
      }
    } catch (err) {
      console.error("Network/Parse Error:", err);
      alert("❌ Something went wrong while saving the invoice. Please check your internet connection and server status.");
    }
  };

  // Calculate subtotal, tax, and total amounts based on all items
  useEffect(() => {
    const subtotal = invoiceItems.reduce((sum, item) => {
      return sum + (parseFloat(item.amount) || 0);
    }, 0);

    const taxRate = parseFloat(formData.salesTax) || 0;
    const taxAmount = subtotal * (taxRate / 100);
    const totalAmount = subtotal + taxAmount;

    setFormData(prev => ({
      ...prev,
      subtotal: subtotal,
      taxAmount: taxAmount,
      totalAmount: totalAmount
    }));
  }, [invoiceItems, formData.salesTax]);

  // Keep payment deadline aligned with bill date + payment days.
  useEffect(() => {
    if (!formData.billDate) return;
    const days = Number(formData.paymentDays);
    if (Number.isNaN(days) || days < 0) return;
    const baseDate = new Date(formData.billDate);
    if (Number.isNaN(baseDate.getTime())) return;
    const due = new Date(baseDate);
    due.setDate(due.getDate() + days);
    const computed = due.toISOString().split('T')[0];
    if (formData.paymentDeadline !== computed) {
      setFormData(prev => ({ ...prev, paymentDeadline: computed }));
    }
  }, [formData.billDate, formData.paymentDays]);

  return (
    <div className="max-w-5xl mx-auto bg-white p-8 sm:p-12 transition-all duration-300">
      {/* Company Header with Logo */}
      <div className="text-center mb-8">
        {companySettings?.logo_path && (
          <div className="mb-4">
            <img 
              src={companySettings.logo_path} 
              alt="Company Logo"
              className="mx-auto h-20 w-auto object-contain"
              onError={(e) => {
                // Fallback to logo from public assets if API logo fails
                e.target.src = '/assets/Logo/Logo.png';
              }}
            />
          </div>
        )}
        <h1 className="text-2xl font-bold text-gray-800 mb-2">
          {companySettings?.company_name || 'A Rauf Brother Textile'}
        </h1>
        <p className="text-sm text-gray-600">Create New Invoice</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-12">
        {/* Customer Information */}
        <section>
          <h2 className="text-2xl font-semibold text-gray-800 mb-6 border-b pb-3">
            Contact Person Details
          </h2>
          <div className="grid sm:grid-cols-1 gap-6">
            <div className="relative">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Contact Person Name
                <span className="text-red-500 ml-1">*</span>
              </label>
              <input
                type="text"
                value={searchTerm}
                onChange={handleSearchChange}
                onFocus={handleInputFocus}
                onBlur={handleInputBlur}
                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-300 transition"
                placeholder={loading ? "Loading customers..." : "Type customer name to search..."}
                required
                disabled={loading}
              />
              
              {/* Dropdown suggestions */}
              {showDropdown && (
                <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {filteredCustomers.map((customer) => (
                    <div
                      key={customer.customer_id}
                      onClick={() => handleCustomerSelect(customer)}
                      className="px-4 py-3 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0 transition-colors"
                    >
                      <div className="flex items-start space-x-3">
                        <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                          <span className="text-blue-600 font-semibold text-sm">
                            {customer.customer.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-900 truncate">
                            {customer.customer}
                          </div>
                          {customer.company && (
                            <div className="text-sm text-gray-500 truncate">
                              {customer.company}
                            </div>
                          )}
                          <div className="text-sm text-gray-500 truncate">
                            {customer.email}
                          </div>
                          {customer.phone && (
                            <div className="text-xs text-gray-400">
                              {customer.phone}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  
                  {/* No results message */}
                  {filteredCustomers.length === 0 && searchTerm.length > 0 && (
                    <div className="p-4 text-center text-gray-500">
                      <div className="text-sm">No customers found</div>
                      <div className="text-xs text-gray-400">Try a different search term</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          
          {/* Customer Information Display - Shows when customer is selected */}
          {formData.customerName && (
            <div className="mt-6 p-4 bg-gray-50 rounded-lg">
              <h3 className="text-lg font-medium text-gray-700 mb-3">Selected Contact Person Information</h3>
              <div className="grid sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-semibold text-gray-600">Name:</span>
                  <span className="ml-2 text-gray-800">{formData.customerName}</span>
                </div>
                <div>
                  <span className="font-semibold text-gray-600">Email:</span>
                  <span className="ml-2 text-gray-800">{formData.customerEmail}</span>
                </div>
                <div>
                  <span className="font-semibold text-gray-600">Phone:</span>
                  <span className="ml-2 text-gray-800">{formData.phone}</span>
                </div>
                <div className="sm:col-span-2">
                  <span className="font-semibold text-gray-600">Address:</span>
                  <span className="ml-2 text-gray-800">{formData.address}</span>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Invoice Items */}
        <section>
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-semibold text-gray-800 border-b pb-3">
              Invoice Items
            </h2>
            <button
              type="button"
              onClick={addNewItem}
              className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              + Add Item
            </button>
          </div>

          {/* Items Table */}
          <div className="overflow-x-auto">
            <table className="w-full border border-gray-300 rounded-lg">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 border-b">
                    Description *
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 border-b">
                    Quantity *
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 border-b">
                    Net Weight (KG)
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 border-b">
                    Unit
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 border-b">
                    Rate *
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 border-b">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {invoiceItems.map((item, index) => (
                  <tr key={item.id} className="border-b">
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={item.description}
                        onChange={(e) => handleItemChange(index, 'description', e.target.value)}
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                        placeholder="Item description"
                        required
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                        placeholder="0"
                        min="0"
                        step="0.01"
                        required
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        value={item.net_weight || ''}
                        onChange={(e) => handleItemChange(index, 'net_weight', e.target.value)}
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                        placeholder="0.00"
                        min="0"
                        step="0.01"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={item.unit || ''}
                        onChange={(e) => handleItemChange(index, 'unit', e.target.value)}
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                        placeholder="Unit (e.g., MTR)"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        value={item.rate}
                        onChange={(e) => handleItemChange(index, 'rate', e.target.value)}
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                        placeholder="0.00"
                        min="0"
                        step="0.01"
                        required
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={item.amount ? item.amount.toFixed(2) : '0.00'}
                        readOnly
                        className="w-full bg-gray-50 border border-gray-300 rounded px-3 py-2 text-sm"
                      />
                    </td>
                    {/* removed Action column per request */}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Invoice Totals */}
          <div className="mt-6 border-t pt-4">
            <div className="grid sm:grid-cols-2 gap-6">
              <div className="grid gap-3">
                <Input
                  label="Currency"
                  type="text"
                  name="currency"
                  value={'PKR'}
                  readOnly
                  className="bg-gray-50 border-gray-200 font-medium"
                />

                <Input
                  label="Sales Tax (%)"
                  type="number"
                  name="salesTax"
                  value={formData.salesTax}
                  onChange={handleChange}
                  step="0.5"
                  min="0"
                />
              </div>

              <div className="grid gap-3">
                <Input
                  label="Subtotal (PKR)"
                  type="text"
                  value={formData.subtotal ? formData.subtotal.toFixed(2) : '0.00'}
                  readOnly
                  className="bg-blue-50 border-blue-200 font-medium"
                />

                <Input
                  label="Tax Amount (PKR)"
                  type="text"
                  value={formData.taxAmount ? formData.taxAmount.toFixed(2) : '0.00'}
                  readOnly
                  className="bg-blue-50 border-blue-200 font-medium"
                />

                <Input
                  label="Total Amount (PKR)"
                  type="text"
                  value={formData.totalAmount ? formData.totalAmount.toFixed(2) : '0.00'}
                  readOnly
                  className="bg-green-50 border-green-200 font-bold text-lg"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Dates and Note */}
        <section>
          <h2 className="text-2xl font-semibold text-gray-800 mb-6 border-b pb-3">
            Invoice Info
          </h2>
          <div className="grid sm:grid-cols-2 gap-6">
            <Input
              label="Invoice Number (Optional)"
              type="text"
              name="invoiceNumber"
              value={formData.invoiceNumber}
              onChange={handleChange}
              placeholder="e.g., INV-1001"
            />
            <Input
              label="Bill Date"
              type="date"
              name="billDate"
              value={formData.billDate}
              onChange={handleChange}
              required
            />
            <Input
              label="Payment Days (editable)"
              type="number"
              name="paymentDays"
              value={formData.paymentDays}
              onChange={handleChange}
              required
              min="0"
              max="365"
            />
            <Input
              label="Payment Deadline"
              type="date"
              name="paymentDeadline"
              value={formData.paymentDeadline}
              onChange={handleChange}
              required
            />
          </div>
          <div className="mt-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Note
            </label>
            <textarea
              name="note"
              rows={4}
              value={formData.note}
              onChange={handleChange}
              className="w-full border border-gray-300 rounded-xl p-3 bg-white shadow-sm focus:ring-2 focus:ring-blue-200 outline-none transition"
              placeholder="Enter a message for the customer..."
            ></textarea>
          </div>
        </section>

        {/* Submit */}
        <div className="text-center mt-10 flex flex-col sm:flex-row justify-center gap-4">
          <button
            type="button"
            className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold px-10 py-3 rounded-xl shadow-lg transition duration-300"
            onClick={onCancel || (() => window.history.back())}
          >
            {onCancel ? 'Cancel' : 'Back'}
          </button>
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-10 py-3 rounded-xl shadow-lg transition duration-300"
          >
            {initialData ? 'Update Invoice' : 'Send Invoice'}
          </button>
        </div>
      </form>
    </div>
    // </div>
  );
};

// Reusable Input Component
const Input = ({
  label,
  name,
  type = "text",
  value,
  onChange,
  required = false,
  readOnly = false,
  className = "",
  ...props
}) => (
  <div className={`flex flex-col ${className}`}>
    <label className="text-sm font-semibold text-gray-700 mb-2">
      {label}
      {required && <span className="text-red-500 ml-1">*</span>}
    </label>
    <input
      type={type}
      name={name}
      value={value}
      onChange={onChange}
      required={required}
      readOnly={readOnly}
      className={`rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-300 transition ${
        readOnly ? "bg-gray-50" : ""
      }`}
      {...props}
    />
  </div>
);

export default InvoiceForm;
