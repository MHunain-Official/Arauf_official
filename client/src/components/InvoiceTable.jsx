/* Invoicetable.js */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { filterInvoices } from '../utils/invoiceFilter';
import { 
  Search, Filter, Ellipsis, Edit, Trash2, Plus, Loader, Eye, ChevronDown, X
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { generateInvoiceId } from '../utils/idGenerator';
import { useClickOutside } from '../hooks/useClickOutside';
import { API_ENDPOINTS } from '../config/api';

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

// Invoice Form Component with Multiple Items Support
const InvoiceForm = ({ onSubmit, onCancel, initialData = null }) => {
  // State for invoice items (multiple items support)
  const [invoiceItems, setInvoiceItems] = useState([{
    id: 1,
    description: "",
    quantity: "",
    unit: '',
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
    salesTax: 0 ,
    subtotal: 0,
    taxAmount: 0,
    totalAmount: 0,
    billDate: new Date().toISOString().split('T')[0],
  paymentDays: 30,
    note: "",
    status: "Pending"
  });

  const [customers, setCustomers] = useState([]);
  const [knownInvoiceNumbers, setKnownInvoiceNumbers] = useState([]);
  const [invoiceSuggestion, setInvoiceSuggestion] = useState("");
  const [invoiceNumberValidation, setInvoiceNumberValidation] = useState({ type: "idle", message: "" });
  const [searchTerm, setSearchTerm] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [filteredCustomers, setFilteredCustomers] = useState([]);
  const [isCreatingCustomer, setIsCreatingCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    customer: "",
    company: "",
    date: new Date().toISOString().split('T')[0],
    phone: "",
    address: "",
    email: "",
    stn: "",
    ntn: ""
  });
  const invoiceValidationTimerRef = useRef(null);

  const normalizeInvoiceNumber = (value = "") => value.toString().trim();
  const isInvoiceFormatValid = (value) => /^INV\d{2}-\d{1,2}-\d{3,}(?:-\d+)?$/.test(value);

  const isInvoiceNumberDuplicate = useCallback((invoiceNumber, allInvoiceNumbers = knownInvoiceNumbers) => {
    const candidate = normalizeInvoiceNumber(invoiceNumber).toLowerCase();
    if (!candidate) return false;

    const editingNumber = normalizeInvoiceNumber(initialData?.invoice_number || "").toLowerCase();
    return (allInvoiceNumbers || []).some((row) => {
      const existing = normalizeInvoiceNumber(row?.invoice_number || "").toLowerCase();
      if (!existing) return false;
      if (editingNumber && existing === editingNumber) return false;
      return existing === candidate;
    });
  }, [knownInvoiceNumbers, initialData]);

  const fetchInvoiceNumbers = useCallback(async () => {
    const baseUrl = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api';
    const response = await fetch(`${baseUrl}/invoice-numbers`);
    if (!response.ok) {
      throw new Error("Failed to fetch invoice numbers");
    }
    const numbers = await response.json();
    const sanitized = Array.isArray(numbers) ? numbers : [];
    setKnownInvoiceNumbers(sanitized);
    const suggestion = generateInvoiceId(sanitized);
    setInvoiceSuggestion(suggestion);
    return sanitized;
  }, []);

  // Handle customer selection from autocomplete
  const handleCustomerSelect = (customer) => {
    setSearchTerm(customer.customer);
    setFormData((prev) => ({
      ...prev,
      customerName: customer.customer,
      customerEmail: customer.email,
      phone: customer.phone,
      address: customer.address,
      stRegNo: customer.stn || "",
      ntnNumber: customer.ntn || "",
    }));
    setShowDropdown(false);
  };

  // Handle input change for search
  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearchTerm(value);
    
    // Clear customer data if search term is cleared
    if (value === '') {
      setFormData((prev) => ({
        ...prev,
        customerName: '',
        customerEmail: '',
        phone: '',
        address: '',
        stRegNo: '',
        ntnNumber: '',
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

  // Fetch customers from database
  useEffect(() => {
    const fetchCustomers = async () => {
      try {
        const response = await fetch(`${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'}/v1/customertable`);
        if (response.ok) {
          const customersData = await response.json();
          setCustomers(customersData);
          setFilteredCustomers(customersData);
        } else {
          console.error('Failed to fetch contact persons');
        }
      } catch (error) {
        console.error('Error fetching contact persons:', error);
      }
    };

    fetchCustomers();
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

  // Initialize form with existing data if editing
  useEffect(() => {
    if (initialData) {
  // initialize form with invoice data
      
      // Set form data
      setFormData({
        invoiceNumber: initialData.invoice_number || "",
        customerName: initialData.customer_name || "",
        customerEmail: initialData.customer_email || "",
        phone: initialData.p_number || "",
        a_p_Name: initialData.a_p_number || "",
        address: initialData.address || "",
        stRegNo: initialData.st_reg_no || "",
        ntnNumber: initialData.ntn_number || "",
        currency: initialData.currency || "PKR",
        salesTax: parseFloat(initialData.tax_rate || initialData.salesTax || 0),
        subtotal: parseFloat(initialData.subtotal || 0),
        taxAmount: parseFloat(initialData.tax_amount || 0),
        totalAmount: parseFloat(initialData.total_amount || 0),
        billDate: initialData.bill_date ? initialData.bill_date.split('T')[0] : new Date().toISOString().split('T')[0],
  paymentDays: initialData && (initialData.payment_days || initialData.paymentDays) ? (initialData.payment_days || initialData.paymentDays) : 30,
        note: initialData.note || initialData.Note || "",
        status: initialData.status || "Pending"
      });

      // Set search term for customer display
      setSearchTerm(initialData.customer_name || "");

      // Handle invoice items - check if there are multiple items or single item
      if (initialData.items && Array.isArray(initialData.items) && initialData.items.length > 0) {
        // Multiple items structure
        const mappedItems = initialData.items.map((item, index) => {
          const quantity = parseFloat(item.quantity || 0);
          const rate = parseFloat(item.rate || 0);
          const amount = item.amount !== undefined && item.amount !== null ? parseFloat(item.amount) : (quantity * rate);
          return {
            id: index + 1,
            description: item.description || item.item_name || "",
            quantity: item.quantity?.toString() || "",
            unit: item.unit || item.uom || item.unit_name || "",
            rate: item.rate?.toString() || "",
            net_weight: item.net_weight !== undefined && item.net_weight !== null ? item.net_weight : '',
            amount: amount
          };
        });
        setInvoiceItems(mappedItems);
  // set multiple invoice items
      } else if (initialData.item_name || initialData.quantity || initialData.rate) {
        // Single item structure (legacy)
        const quantity = parseFloat(initialData.quantity || 0);
        const rate = parseFloat(initialData.rate || 0);
        const amount = initialData.item_amount !== undefined && initialData.item_amount !== null 
          ? parseFloat(initialData.item_amount) 
          : (initialData.subtotal || (quantity * rate));
        const singleItem = [{
          id: 1,
          description: initialData.item_name || "",
          quantity: initialData.quantity?.toString() || "",
          unit: initialData.unit || "",
          rate: initialData.rate?.toString() || "",
          net_weight: initialData.net_weight || '',
          amount: amount
        }];
        setInvoiceItems(singleItem);
  // set single invoice item
      } else {
        // No item data, use default empty item
        setInvoiceItems([{
          id: 1,
          description: "",
          quantity: "",
          unit: '',
          rate: "",
          net_weight: "",
          amount: 0
        }]);
  // no item data found, using default
      }
    }
  }, [initialData]);

  useEffect(() => {
    const loadInvoiceNumbers = async () => {
      try {
        const existingNumbers = await fetchInvoiceNumbers();
        if (!initialData) {
          const nextInvoiceNumber = generateInvoiceId(existingNumbers || []);
          setFormData((prev) => ({
            ...prev,
            invoiceNumber: prev.invoiceNumber || nextInvoiceNumber
          }));
        }
      } catch (error) {
        console.error('Error generating next invoice number:', error);
      }
    };

    loadInvoiceNumbers();
  }, [initialData, fetchInvoiceNumbers]);

  useEffect(() => {
    const invoiceNumber = normalizeInvoiceNumber(formData.invoiceNumber);

    if (invoiceValidationTimerRef.current) {
      clearTimeout(invoiceValidationTimerRef.current);
    }

    if (!invoiceNumber) {
      setInvoiceNumberValidation({
        type: "warning",
        message: invoiceSuggestion
          ? `No number entered. Suggested: ${invoiceSuggestion}`
          : "Invoice number will be generated automatically."
      });
      return;
    }

    setInvoiceNumberValidation({ type: "checking", message: "Checking invoice number..." });

    invoiceValidationTimerRef.current = setTimeout(() => {
      if (!isInvoiceFormatValid(invoiceNumber)) {
        setInvoiceNumberValidation({
          type: "error",
          message: "Use format INVyy-m-### (minimum 3 digits, e.g., INV26-5-001 or INV26-5-1234)."
        });
        return;
      }

      if (isInvoiceNumberDuplicate(invoiceNumber)) {
        setInvoiceNumberValidation({
          type: "error",
          message: invoiceSuggestion
            ? `This number already exists. Try: ${invoiceSuggestion}`
            : "This number already exists."
        });
        return;
      }

      setInvoiceNumberValidation({
        type: "success",
        message: "Invoice number is available."
      });
    }, 250);

    return () => {
      if (invoiceValidationTimerRef.current) {
        clearTimeout(invoiceValidationTimerRef.current);
      }
    };
  }, [formData.invoiceNumber, invoiceSuggestion, isInvoiceNumberDuplicate]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    const nextValue = name === "invoiceNumber" ? value.replace(/\s/g, "") : value;
  // form change
    setFormData((prev) => ({
      ...prev,
      [name]: nextValue,
    }));
  };

  const handleNewCustomerChange = (e) => {
    const { name, value } = e.target;
    setNewCustomer((prev) => ({
      ...prev,
      [name]: value,
    }));
  };


  // Handle invoice item changes
  const handleItemChange = (index, field, value) => {
    const updatedItems = [...invoiceItems];
    const numericFields = ['quantity', 'rate', 'net_weight'];
    const sanitizedValue = numericFields.includes(field)
      ? String(value ?? '').replace(/[^0-9.]/g, '')
      : value;

    updatedItems[index] = {
      ...updatedItems[index],
      [field]: sanitizedValue
    };

    // Always derive amount from quantity * rate so totals never go stale.
    const quantity = parseFloat(updatedItems[index].quantity) || 0;
    const rate = parseFloat(updatedItems[index].rate) || 0;
    updatedItems[index].amount = quantity * rate;

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

  // Check if customer exists in database
  const checkCustomerExists = (customerName) => {
    return customers.some(customer => 
      customer.customer.toLowerCase() === customerName.toLowerCase()
    );
  };

  // Check if contact person exists (alias for checkCustomerExists but
  // tolerant of different form field names). Used by the form submit
  // validation to ensure the selected/entered Contact Person is present
  // in the loaded customers list.
  const checkContactPersonExists = (contactPersonName) => {
    const nameToCheck = contactPersonName || '';
    if (!nameToCheck) return false;
    return customers.some(c => c.customer && c.customer.toLowerCase() === nameToCheck.toLowerCase());
  };

  const handleCreateCustomer = async () => {
    try {
      // Validate required fields
      if (!newCustomer.customer || !newCustomer.email || !newCustomer.phone || 
          !newCustomer.address || !newCustomer.stn || !newCustomer.ntn) {
        alert('Please fill in all required fields (Contact Person Name, Email, Phone, Address, STN, and NTN)');
        return;
      }

      // Check for duplicate email, phone, STN, or NTN
      const duplicateCheck = customers.find(customer => {
        const emailMatch = customer.email && newCustomer.email && 
                          customer.email.toLowerCase() === newCustomer.email.toLowerCase();
        const phoneMatch = customer.phone && newCustomer.phone && 
                          customer.phone === newCustomer.phone;
        const stnMatch = customer.stn && newCustomer.stn && 
                        customer.stn === newCustomer.stn;
        const ntnMatch = customer.ntn && newCustomer.ntn && 
                        customer.ntn === newCustomer.ntn;

        return emailMatch || phoneMatch || stnMatch || ntnMatch;
      });

      if (duplicateCheck) {
        // Determine which field is duplicate
        let duplicateFields = [];
        if (duplicateCheck.email.toLowerCase() === newCustomer.email.toLowerCase()) {
          duplicateFields.push('Email');
        }
        if (duplicateCheck.phone === newCustomer.phone) {
          duplicateFields.push('Phone Number');
        }
        if (duplicateCheck.stn === newCustomer.stn) {
          duplicateFields.push('STN');
        }
        if (duplicateCheck.ntn === newCustomer.ntn) {
          duplicateFields.push('NTN');
        }

        alert(`A customer with the same ${duplicateFields.join(', ')} already exists: "${duplicateCheck.customer}". Please use different values.`);
        return;
      }

      console.log('Creating customer with data:', newCustomer);
      
      const response = await fetch(`${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'}/v1/customertable`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(newCustomer)
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('API Error Response:', errorData);
        throw new Error(errorData.message || 'Failed to create customer');
      }
      
      const result = await response.json();
      console.log('Customer created successfully:', result);
      
      // Refresh customers list
      const customersResponse = await fetch(`${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'}/v1/customertable`);
      if (customersResponse.ok) {
        const customersData = await customersResponse.json();
        setCustomers(customersData);
      }
      
      // Select the newly created customer
      const customerData = result.customer || result;
      const newCustomerData = { 
        customer_id: customerData.customer_id, 
        customer: customerData.customer || newCustomer.customer,
        email: customerData.email || newCustomer.email,
        phone: customerData.phone || newCustomer.phone,
        address: customerData.address || newCustomer.address,
        stn: customerData.stn || newCustomer.stn,
        ntn: customerData.ntn || newCustomer.ntn
      };
      
      console.log('New customer data to select:', newCustomerData);
      
      handleCustomerSelect(newCustomerData);
      setIsCreatingCustomer(false);
      setNewCustomer({
        customer: "",
        company: "",
        date: new Date().toISOString().split('T')[0],
        phone: "",
        address: "",
        email: "",
        stn: "",
        ntn: ""
      });
      
      alert('Contact Person created successfully!');
    } catch (error) {
      console.error('Error creating contact person:', error);
      alert(error.message || 'Failed to create contact person');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // If user typed a name but didn't select from dropdown, try to match it against loaded customers
    const typedName = (formData.customerName || searchTerm || '').toString().trim();
    const matchedCustomer = customers.find(c => c.customer && c.customer.toLowerCase() === typedName.toLowerCase());
    if (matchedCustomer) {
      handleCustomerSelect(matchedCustomer);
    }

    // Check if contact person exists in database after attempting to match
    const exists = customers.some(c => c.customer && c.customer.toLowerCase() === typedName.toLowerCase());
    if (!exists) {
      alert("Contact Person not present. Kindly create new Contact Person first.");
      return;
    }

    if (!formData.customerName || !formData.customerEmail) {
      alert("Please fill in required customer information (Name and Email are required).");
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

    let latestNumbers = knownInvoiceNumbers;
    try {
      latestNumbers = await fetchInvoiceNumbers();
    } catch (error) {
      console.error('Error refreshing invoice numbers for validation:', error);
    }

    let normalizedInvoiceNumber = normalizeInvoiceNumber(formData.invoiceNumber);
    if (!normalizedInvoiceNumber) {
      normalizedInvoiceNumber = invoiceSuggestion || generateInvoiceId(latestNumbers || []);
      setFormData((prev) => ({ ...prev, invoiceNumber: normalizedInvoiceNumber }));
    }

    if (normalizedInvoiceNumber) {
      if (!isInvoiceFormatValid(normalizedInvoiceNumber)) {
        alert('Invalid invoice number format. Use INVyy-m-### with minimum 3 digits (e.g., INV26-5-001 or INV26-5-1234).');
        return;
      }

      if (isInvoiceNumberDuplicate(normalizedInvoiceNumber, latestNumbers)) {
        const suggestion = generateInvoiceId(latestNumbers || []);
        setInvoiceSuggestion(suggestion);
        alert(`Invoice number already exists. Try this: ${suggestion}`);
        return;
      }
    }

    // Prepare invoice data with multiple items
    const invoiceData = {
      invoice_number: normalizedInvoiceNumber || undefined,
      customer_name: formData.customerName,
      customer_email: formData.customerEmail,
      p_number: formData.phone,
      a_p_number: formData.a_p_Name,
      address: formData.address,
      st_reg_no: formData.stRegNo,
  ntn_number: formData.ntnNumber,
  // Currency is fixed to PKR per requirement
  currency: 'PKR',
      subtotal: parseFloat(formData.subtotal) || 0,
      tax_rate: parseFloat(formData.salesTax) || 0,
      tax_amount: parseFloat(formData.taxAmount) || 0,
      total_amount: parseFloat(formData.totalAmount) || 0,
  bill_date: formData.billDate,
  payment_days: formData.paymentDays !== undefined ? Number(formData.paymentDays) : 30,
      note: formData.note,
      status: formData.status,
      items: validItems.map((item, index) => ({
        item_no: index + 1,
        description: item.description,
        quantity: parseFloat(item.quantity) || 0,
        unit: item.unit || '',
        rate: parseFloat(item.rate) || 0,
        net_weight: item.net_weight !== undefined && item.net_weight !== '' ? parseFloat(item.net_weight) : 0,
        amount: (parseFloat(item.quantity) || 0) * (parseFloat(item.rate) || 0)
      }))
    };

    onSubmit(invoiceData);
  };

  // Calculate subtotal, tax, and total amounts based on all items
  useEffect(() => {
    const subtotal = invoiceItems.reduce((sum, item) => {
      const quantity = parseFloat(item.quantity) || 0;
      const rate = parseFloat(item.rate) || 0;
      return sum + (quantity * rate);
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

  return (
    <div className="max-w-5xl mx-auto bg-white">
      <form onSubmit={handleSubmit} className="space-y-8">
        <section className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div className="w-full sm:max-w-md">
              <Input
                label="Invoice Number"
                type="text"
                name="invoiceNumber"
                value={formData.invoiceNumber}
                onChange={handleChange}
                placeholder="e.g., INV26-5-001"
                readOnly={Boolean(initialData)}
              />
            </div>
            <button
              type="button"
              className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
              onClick={() => {
                if (!invoiceSuggestion) return;
                setFormData((prev) => ({ ...prev, invoiceNumber: invoiceSuggestion }));
              }}
            >
              Use Suggested: {invoiceSuggestion || "N/A"}
            </button>
          </div>
          <p
            className={`mt-2 text-sm ${
              invoiceNumberValidation.type === "error"
                ? "text-red-600"
                : invoiceNumberValidation.type === "success"
                ? "text-green-600"
                : invoiceNumberValidation.type === "checking"
                ? "text-blue-600"
                : "text-gray-600"
            }`}
          >
            {initialData
              ? "Invoice number is locked for edits. You can update all other fields."
              : (invoiceNumberValidation.message || "Invoice number can be edited manually.")}
          </p>
        </section>

        {/* Customer Information */}
        <section>
          <h2 className="text-xl font-semibold text-gray-800 mb-4 border-b pb-2">
            Contact Person Details
          </h2>
          <div className="grid sm:grid-cols-2 gap-4 relative">
            <div className="relative sm:col-span-2">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-gray-700">
                  Contact Person Name*
                </label>
                <button
                  type="button"
                  className="text-sm text-blue-600 hover:text-blue-800"
                  onClick={() => setIsCreatingCustomer(!isCreatingCustomer)}
                >
                  {isCreatingCustomer ? 'Select Existing Contact Person' : 'Create New Contact Person'}
                </button>
              </div>
              
              {isCreatingCustomer ? (
                <div className="grid sm:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg mb-4">
                  
                  <Input
                    label="Company"
                    name="company"
                    value={newCustomer.company}
                    onChange={handleNewCustomerChange}
                  />

                  <Input
                    label="Contact Person Name *"
                    name="customer"
                    value={newCustomer.customer}
                    onChange={handleNewCustomerChange}
                    required
                  />
                  
                  <Input
                    label="Email"
                    type="email"
                    name="email"
                    value={newCustomer.email}
                    onChange={handleNewCustomerChange}
                    required
                  />
                  <Input
                    label="Phone"
                    type="tel"
                    name="phone"
                    value={newCustomer.phone}
                    onChange={(e) => {
                      // Allow only numbers, spaces, parentheses, +, and -
                      const filteredValue = e.target.value.replace(/[^0-9\-\+\(\)\s]/g, '');
                      handleNewCustomerChange({
                        target: {
                          name: 'phone',
                          value: filteredValue,
                        },
                      });
                    }}
                    required
                    placeholder="Enter phone number"
                  />

                  <Input
                    label="Address"
                    name="address"
                    value={newCustomer.address}
                    onChange={handleNewCustomerChange}
                    required
                    className="sm:col-span-2"
                  />
                  <Input
                    label="STN Number"
                    name="stn"
                    value={newCustomer.stn}
                    onChange={handleNewCustomerChange}
                    required
                    placeholder="Sales Tax Number"
                  />
                  <Input
                    label="NTN Number"
                    name="ntn"
                    value={newCustomer.ntn}
                    onChange={handleNewCustomerChange}
                    required
                    placeholder="National Tax Number"
                  />
                  
                  <div className="sm:col-span-2 flex justify-end gap-2">
                    <button
                      type="button"
                      className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold px-4 py-2 rounded-xl transition duration-300"
                      onClick={() => setIsCreatingCustomer(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded-xl transition duration-300"
                      onClick={handleCreateCustomer}
                    >
                      Create Contact Person
                    </button>
                  </div>
                </div>
              ) : (
                <div className="relative">
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={handleSearchChange}
                    onFocus={handleInputFocus}
                    onBlur={handleInputBlur}
                    className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-300 transition"
                    placeholder="Type customer name to search..."
                    required={true}
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
                          <div className="text-sm">No results found</div>
                          <div className="text-xs text-gray-400">Try a different search term</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>           
            
          </div>
        </section>

        {/* Invoice Items */}
        <section>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-800 border-b pb-2">
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
          <div className="overflow-x-auto mb-4">
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
                        value={(((parseFloat(item.quantity) || 0) * (parseFloat(item.rate) || 0)).toFixed(2))}
                        readOnly
                        className="w-full bg-gray-50 border border-gray-300 rounded px-3 py-2 text-sm"
                      />
                    </td>
                    {/* Action column removed per request */}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Invoice Totals */}
          <div className="border-t pt-4">
            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Currency
                </label>
                <input
                  type="text"
                  readOnly
                  value="PKR"
                  className="w-full rounded-xl border border-gray-300 bg-gray-50 px-4 py-2 text-sm shadow-sm focus:outline-none transition"
                />
              </div>

              <Input
                label="Sales Tax (%)"
                type="number"
                name="salesTax"
                value={formData.salesTax}
                onChange={handleChange}
                step="0.5"
                min="0"
              />

              <div className="grid gap-3">
                <Input
                  label="Subtotal"
                  type="text"
                  value={formData.subtotal ? formData.subtotal.toFixed(2) : '0.00'}
                  readOnly
                  className="bg-blue-50 border-blue-200 font-medium"
                />

                <Input
                  label="Tax Amount"
                  type="text"
                  value={formData.taxAmount ? formData.taxAmount.toFixed(2) : '0.00'}
                  readOnly
                  className="bg-blue-50 border-blue-200 font-medium"
                />

                <Input
                  label="Total Amount"
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
          <h2 className="text-xl font-semibold text-gray-800 mb-4 border-b pb-2">
            Invoice Info
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <Input
              label="Bill Date"
              type="date"
              name="billDate"
              value={formData.billDate}
              onChange={handleChange}
            />
            <Input
              label="Payment Days (editable)"
              type="number"
              name="paymentDays"
              value={formData.paymentDays}
              onChange={handleChange}
              min="0"
              max="365"
            />
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Status
              </label>
              <select
                name="status"
                value={formData.status}
                onChange={handleChange}
                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-300 transition"
              >
                <option value="Pending">Pending</option>
                <option value="Paid">Paid</option>
                <option value="Overdue">Overdue</option>
              </select>
            </div>
          </div>
          <div className="mt-4">
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
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button
            type="button"
            className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold px-8 py-2 rounded-xl transition duration-300"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-2 rounded-xl transition duration-300"
          >
            {initialData ? 'Update Invoice' : 'Create Invoice'}
          </button>
        </div>
      </form>
    </div>
  );
};

// Invoice View Template Component
const InvoiceViewTemplate = ({ invoiceId, onClose, onEdit }) => {
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch invoice data
  useEffect(() => {
    const fetchInvoice = async () => {
      try {
        setLoading(true);
        const response = await fetch(`${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'}/invoices/${invoiceId}`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch invoice');
        }
        
        const data = await response.json();
        setInvoice(data);
      } catch (err) {
        console.error('Error fetching invoice:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    if (invoiceId) {
      fetchInvoice();
    }
  }, [invoiceId]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"></div>
        <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto p-6 flex items-center justify-center">
          <div className="flex flex-col items-center">
            <Loader className="w-8 h-8 animate-spin text-blue-500 mb-2" />
            <div className="text-gray-500">Loading invoice...</div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"></div>
        <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto p-6 flex items-center justify-center">
          <div className="text-center">
            <div className="text-red-500 mb-2">Error loading invoice</div>
            <div className="text-sm text-gray-500 mb-4">{error || 'Invoice not found'}</div>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  const formatCurrency = (amount, currency) => {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : parseFloat(amount || 0);
    if (isNaN(numAmount)) return `${currency} 0.00`;
    return `${currency} ${numAmount.toLocaleString('en-PK', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  };

  const formatDate = (dateString) => {
    try {
      const date = new Date(dateString);
      if (isNaN(date)) return dateString;
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch {
      return dateString;
    }
  };

  const getStatusClass = (status) => {
    const statusClasses = {
      'Paid': 'bg-green-100 text-green-800',
      'Pending': 'bg-yellow-100 text-yellow-800',
      'Overdue': 'bg-red-100 text-red-800',
      'Sent': 'bg-green-100 text-green-800',
      'Not Sent': 'bg-orange-100 text-orange-800',
      'Draft': 'bg-gray-100 text-gray-800'
    };
    return statusClasses[status] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm" onClick={onClose}></div>
      
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 p-6 rounded-t-2xl flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Invoice #{invoice.id}</h2>
            <p className="text-sm text-gray-500">Created on {formatDate(invoice.bill_date)}</p>
          </div>
          
            <div className="flex items-center gap-2">
            <span className={`px-3 py-1 inline-flex items-center justify-center text-sm font-semibold rounded-full ${getStatusClass(invoice.status)}`}>
              {invoice.status}
            </span>
            
            <button
              onClick={() => onEdit(invoice)}
              className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <Edit className="w-4 h-4" />
              Edit
            </button>
            
            <button
              onClick={onClose}
              className="ml-2 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Invoice Content */}
        <div className="p-6">
          {/* Company & Client Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
            <div>
              <h3 className="text-lg font-semibold text-gray-800 mb-3">From</h3>
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="font-semibold">Your Company Name</p>
                <p className="text-sm text-gray-600">Your Company Address</p>
                <p className="text-sm text-gray-600">Phone: Your Company Phone</p>
                <p className="text-sm text-gray-600">Email: your.company@email.com</p>
              </div>
            </div>
            
            <div>
              <h3 className="text-lg font-semibold text-gray-800 mb-3">Bill To</h3>
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="font-semibold">{invoice.customer_name}</p>
                {invoice.address && <p className="text-sm text-gray-600">{invoice.address}</p>}
                <p className="text-sm text-gray-600">{invoice.customer_email}</p>
                {invoice.p_number && <p className="text-sm text-gray-600">Phone: {invoice.p_number}</p>}
                {invoice.st_reg_no && <p className="text-sm text-gray-600">ST Reg: {invoice.st_reg_no}</p>}
                {invoice.ntn_number && <p className="text-sm text-gray-600">NTN: {invoice.ntn_number}</p>}
              </div>
            </div>
          </div>

          {/* Invoice Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
            <div>
              <h3 className="text-lg font-semibold text-gray-800 mb-3">Invoice Details</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">Invoice ID:</span>
                  <span className="font-medium">INV-{invoice.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Issue Date:</span>
                  <span className="font-medium">{formatDate(invoice.bill_date)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Due Date:</span>
                  <span className="font-medium">{formatDate(invoice.payment_deadline)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Currency:</span>
                  <span className="font-medium">{invoice.currency}</span>
                </div>
              </div>
            </div>
            
            <div>
              <h3 className="text-lg font-semibold text-gray-800 mb-3">Amount Summary</h3>
              <div className="bg-blue-50 p-4 rounded-lg">
                <div className="flex justify-between mb-2">
                  <span className="text-gray-700">Subtotal:</span>
                  <span className="font-medium">{formatCurrency(invoice.item_amount, invoice.currency)}</span>
                </div>
                <div className="flex justify-between mb-2">
                  <span className="text-gray-700">Tax ({invoice.salesTax}%):</span>
                  <span className="font-medium">{formatCurrency(invoice.tax_amount, invoice.currency)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-blue-200">
                  <span className="text-lg font-semibold text-gray-800">Total:</span>
                  <span className="text-lg font-bold text-blue-700">
                    {formatCurrency(invoice.total_amount, invoice.currency)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Item Details */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-gray-800 mb-3">Item Details</h3>
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Description</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">Quantity</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">Rate</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {invoice.items && invoice.items.length > 0 ? (
                    invoice.items.map((item, index) => (
                      <tr key={item.id || index}>
                        <td className="px-4 py-3 text-sm">
                          <div className="font-medium text-gray-900">{item.description || "Item"}</div>
                        </td>
                        <td className="px-4 py-3 text-sm text-right">{item.quantity}</td>
                        <td className="px-4 py-3 text-sm text-right">{formatCurrency(item.rate, invoice.currency)}</td>
                        <td className="px-4 py-3 text-sm text-right font-medium">
                          {formatCurrency(item.amount, invoice.currency)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    // Fallback to old single item structure
                    <tr>
                      <td className="px-4 py-3 text-sm">
                        <div className="font-medium text-gray-900">{invoice.item_name || "Item"}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-right">{invoice.quantity}</td>
                      <td className="px-4 py-3 text-sm text-right">{formatCurrency(invoice.rate, invoice.currency)}</td>
                      <td className="px-4 py-3 text-sm text-right font-medium">
                        {formatCurrency(invoice.item_amount, invoice.currency)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Notes */}
          {invoice.Note && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-3">Notes</h3>
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-sm text-gray-700">{invoice.Note}</p>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="pt-6 border-t border-gray-200">
            <div className="flex flex-col sm:flex-row justify-between items-center">
              <div className="text-xs text-gray-500 mb-4 sm:mb-0">
                Thank you for your business!
              </div>
              <div className="flex gap-2">
                <button className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                  Download PDF
                </button>
                <button className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors">
                  Send Email
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Main Invoice Management Component
const InvoiceManagement = () => {
  const navigate = useNavigate();
  
  // State management
  const [invoicesData, setInvoicesData] = useState([]);
  const [selectedRows, setSelectedRows] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  // Default items per page - set to 10 so page 2 is shown after 11 items
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('All');
  const [filters, setFilters] = useState({
    minAmount: '',
    maxAmount: '',
    dateFrom: '',
    dateTo: '',
    customer: '',
    company: '',
    status: ''
  });
  const [showFilters, setShowFilters] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [companyExists, setCompanyExists] = useState(null); // null = unknown, true/false = existence
  const [activeDropdown, setActiveDropdown] = useState(null);
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [viewingInvoiceId, setViewingInvoiceId] = useState(null);
  const [notification, setNotification] = useState(null);
  const [loading, setLoading] = useState(true);
  const dropdownRefs = useRef([]);
  const filterPanelRef = useRef(null);

  // Add click outside handler for invoice form
  const invoiceFormRef = useClickOutside(() => {
    if (showInvoiceForm) {
      setShowInvoiceForm(false);
      setEditingInvoice(null);
    }
  }, showInvoiceForm);

  // State for tab counts
  const [tabCounts, setTabCounts] = useState({
    'All': 0,
    'Paid': 0,
    'Pending': 0,
    'Overdue': 0,
    'PO Invoices': 0
  });

  // Fetch counts for all tabs separately to ensure accuracy
  const fetchTabCounts = useCallback(async () => {
    try {
  console.debug('Fetching fresh tab counts...');
      
      const [regularResponse, poResponse] = await Promise.all([
        // Get all regular invoices (excluding PO invoices)
        fetch(`${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'}/invoices?exclude_po=true&limit=1000&_t=${Date.now()}`),
        // Get all PO invoices
        fetch(`${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'}/invoices?invoice_type=po_invoice&limit=1000&_t=${Date.now()}`)
      ]);
      
      const [regularData, poData] = await Promise.all([
        regularResponse.ok ? regularResponse.json() : { data: [] },
        poResponse.ok ? poResponse.json() : { data: [] }
      ]);
      
      const regularInvoices = regularData.data || regularData || [];
      const poInvoices = poData.data || poData || [];
      const combinedInvoices = [...regularInvoices, ...poInvoices];
      
  console.debug('Raw data - Regular invoices:', regularInvoices.length, 'PO invoices:', poInvoices.length);
      
      const counts = {
        'All': combinedInvoices.length, // ALL tab shows everything (regular + PO)
        'Paid': combinedInvoices.filter(inv => inv.status === 'Paid').length,
        'Pending': combinedInvoices.filter(inv => inv.status === 'Pending').length,
        'Overdue': combinedInvoices.filter(inv => inv.status === 'Overdue').length,
        'PO Invoices': poInvoices.length
      };
      
  console.debug('Updated tab counts:', counts);
      setTabCounts(counts);
      
    } catch (error) {
      console.error('Error fetching tab counts:', error);
    }
  }, []);

  // Calculate counts for tabs from current data (fallback)
  const getTabCounts = () => {
    const counts = {
      'All': 0,
      'Paid': 0,
      'Pending': 0,
      'Overdue': 0,
      'Sent': 0,
      'Not Sent': 0,
      'PO Invoices': 0
    };

    invoicesData.forEach(invoice => {
      // Count ALL invoices (regular + PO) in "All" tab
      counts['All']++;
      
      // Count PO Invoices separately
      if (invoice.invoice_type === 'po_invoice') {
        counts['PO Invoices']++;
      }
      
      // Count ALL invoices (both regular and PO) by status
      if (invoice.status === 'Paid') {
        counts['Paid']++;
      } else if (invoice.status === 'Pending') {
        counts['Pending']++;
      } else if (invoice.status === 'Overdue') {
        counts['Overdue']++;
      } else if (invoice.status === 'Sent') {
        counts['Sent']++;
      } else if (invoice.status === 'Not Sent' || invoice.status === 'Draft') {
        counts['Not Sent']++;
      }
    });

    // Ensure 'All' definitely includes both regular and PO invoices: compute from status sums + PO invoices
    const statusSum = (counts['Paid'] || 0) + (counts['Pending'] || 0) + (counts['Overdue'] || 0) + (counts['Sent'] || 0) + (counts['Not Sent'] || 0);
    counts['All'] = statusSum + (counts['PO Invoices'] || 0);

    // Use fetched counts if they're more reliable (not zero)
    Object.keys(counts).forEach(key => {
      if (tabCounts[key] > 0 && counts[key] === 0) {
        counts[key] = tabCounts[key];
      }
    });

    return counts;
  };

  // Fetch invoices from API with filters
  const fetchInvoicesRef = useRef();
  
  fetchInvoicesRef.current = async (customFilters = null) => {
    try {
      setLoading(true);
      
      // Use current state filters if no custom filters provided
      const currentFilters = customFilters !== null ? customFilters : filters;
      
      // Build query parameters
      const queryParams = new URLSearchParams();
      
      // Add search term
      if (searchTerm.trim()) {
        queryParams.append('search', searchTerm.trim());
      }
      
      // Add active tab as status filter (but don't override explicit status filter)
      if (activeTab === 'PO Invoices') {
        queryParams.append('invoice_type', 'po_invoice');
      } else if (activeTab === 'All') {
        // For "All" tab, show ALL invoices (including PO invoices)
        // DO NOT add exclude_po or invoice_type - fetch everything
      } else if (activeTab !== 'All' && (!currentFilters.status || currentFilters.status === '')) {
        // For status-specific tabs (Paid, Pending, Overdue), filter by status
        // INCLUDE both regular and PO invoices with matching status
        queryParams.append('status', activeTab);
        // DO NOT exclude PO invoices - we want to see all invoices with this status
      }
      
      // Add filters
      Object.entries(currentFilters).forEach(([key, value]) => {
        if (value && value !== '') {
          if (key === 'account') {
            queryParams.append('customer', value);
          } else if (key === 'dateFrom') {
            queryParams.append('dateFrom', value);
          } else if (key === 'dateTo') {
            queryParams.append('dateTo', value);
          } else {
            queryParams.append(key, value);
          }
        }
      });
      
      // Add sorting and pagination - sort by created_at for latest first (most reliable timestamp)
      queryParams.append('sortBy', 'created_at');
      queryParams.append('sortOrder', 'DESC');
      queryParams.append('limit', '100'); // Get more records for client-side pagination
      
      const url = `${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'}/invoices?${queryParams.toString()}`;
  console.debug('Fetching invoices with URL:', url);
  console.debug('Current filters:', currentFilters);
  console.debug('Search term:', searchTerm);
  console.debug('Active tab:', activeTab);
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch invoices');
      }
      
      const result = await response.json();
  console.debug('API Response count:', result.data ? result.data.length : 'No data');
  console.debug('API Response data:', result.data);
      
      // Handle new API response structure
      const invoicesArray = result.data || result; // Support both new and old response formats
      setInvoicesData(Array.isArray(invoicesArray) ? invoicesArray : []);
      
      // Update tab counts after data change
      setTimeout(() => {
        fetchTabCounts();
      }, 100);
      
    } catch (error) {
      console.error('Error fetching invoices:', error);
      showNotification("Error", "Failed to fetch invoices");
      setInvoicesData([]);
    } finally {
      setLoading(false);
    }
  };
  
  const fetchInvoices = useCallback((customFilters = null) => {
    return fetchInvoicesRef.current(customFilters);
  }, [fetchTabCounts]);

  // REMOVED: Debounced auto-filtering that caused focus loss
  // Now filtering only happens when user clicks "Search" button

  // Load invoices and tab counts on component mount
  useEffect(() => {
    console.debug('Component mounted - loading initial data');
    fetchInvoices({});
    fetchTabCounts();
  }, [fetchTabCounts]);

  // Refetch when activeTab changes (tab navigation)
  useEffect(() => {
    console.debug('Active tab changed:', activeTab);
    // Reset to first page whenever the user switches tabs to avoid stale page numbers
    setCurrentPage(1);
    fetchInvoices();
  }, [activeTab]);

  // Show notification
  const showNotification = (title, description, duration = 3000) => {
    setNotification({ title, description });
    setTimeout(() => setNotification(null), duration);
  };

  // Fetch unique companies when filter panel is shown
  useEffect(() => {
    const fetchCompanies = async () => {
      try {
        const res = await fetch(`${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'}/v1/customertable`);
        if (!res.ok) return;
        const data = await res.json();
        const unique = Array.from(new Set((data || []).map(c => (c.company || '').trim()).filter(Boolean)));
        setCompanies(unique.sort((a,b) => a.localeCompare(b)));
      } catch (err) {
        console.error('Failed to fetch companies', err);
      }
    };

    if (showFilters && companies.length === 0) {
      fetchCompanies();
    }
  }, [showFilters]);

  // If company exists (exact match), auto-apply the filter to show only that company's invoices
  useEffect(() => {
    if (companyExists === true && filters.company && filters.company.trim() !== '') {
      console.debug('Auto-applying company filter for:', filters.company);
      setCurrentPage(1);
      // fetchInvoices is stable via useCallback
      fetchInvoices();
    }
  }, [companyExists, filters.company, fetchInvoices]);

  // Handle filter changes - NO auto-search, just update state
  const handleFilterChange = useCallback((e) => {
    const { name, value } = e.target;
    setFilters(prev => ({
      ...prev,
      [name]: value
    }));
  }, []);

  // Clear all filters
  const clearFilters = () => {
    setFilters({
      minAmount: '',
      maxAmount: '',
      dateFrom: '',
      dateTo: '',
      customer: '',
      company: '',
      status: ''
    });
    setSearchTerm('');
    setCompanyExists(null);
    setActiveTab('All');
  };

  // Reset filters and trigger search
  const resetFilters = useCallback(() => {
    clearFilters();
    setCurrentPage(1);
    showNotification("Filters reset", "All filters have been cleared");
    // Fetch with empty filters after a short delay
    setTimeout(() => {
      fetchInvoices({});
    }, 100);
  }, [fetchInvoices]);

  // Apply filters - triggered by Search button click
  const applyFilters = useCallback(() => {
    console.debug('Search button clicked - applying filters');
    setCurrentPage(1); // Reset to first page
    fetchInvoices();
  }, [fetchInvoices]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      // Ignore clicks inside the filter panel so inputs keep focus
      if (filterPanelRef.current && filterPanelRef.current.contains(event.target)) return;
      if (dropdownRefs.current.every(ref => !ref?.contains(event.target))) {
        setActiveDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Use centralized filter utility for consistency and testability
  const filteredInvoices = useCallback(() => {
    return filterInvoices(invoicesData, activeTab, filters, searchTerm);
  }, [invoicesData, activeTab, filters, searchTerm]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredInvoices().length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const visibleInvoices = filteredInvoices().slice(startIndex, startIndex + itemsPerPage);

  // Ensure currentPage is within bounds when filtered data or itemsPerPage changes
  useEffect(() => {
    if (totalPages === 0) {
      setCurrentPage(1);
      return;
    }
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  // Compute pages to display in pagination (max 10 visible pages, with ellipses)
  const maxVisiblePages = 10;
  const pages = [];
  if (totalPages <= maxVisiblePages) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    const half = Math.floor(maxVisiblePages / 2);
    let startPage = Math.max(1, currentPage - half);
    let endPage = startPage + maxVisiblePages - 1;

    if (endPage > totalPages) {
      endPage = totalPages;
      startPage = endPage - maxVisiblePages + 1;
    }

    if (startPage > 1) {
      pages.push(1);
      if (startPage > 2) pages.push('...');
    }

    for (let i = startPage; i <= endPage; i++) pages.push(i);

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) pages.push('...');
      pages.push(totalPages);
    }
  }

  // Format date for display
  const formatDate = (dateString) => {
    try {
      const date = new Date(dateString);
      if (isNaN(date)) return dateString;
      const month = date.toLocaleString('default', { month: 'short' });
      const day = date.getDate().toString().padStart(2, '0');
      const year = date.getFullYear();
      return `${month} ${day}, ${year}`;
    } catch {
      return dateString;
    }
  };

  // Selection handlers
  const toggleSelectAll = () => {
    setSelectedRows(prev =>
      prev.length === visibleInvoices.length ? [] : visibleInvoices.map(invoice => invoice.id)
    );
  };

  const toggleSelectRow = (id) => {
    setSelectedRows(prev =>
      prev.includes(id) ? prev.filter(rowId => rowId !== id) : [...prev, id]
    );
  };

  // Pagination handler
  const handlePageChange = (page) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
      setSelectedRows([]);
    }
  };

  // duplicate resetFilters removed (kept single implementation above)

  // UI helpers
  const getStatusClass = (status) => {
    const statusClasses = {
      'Paid': 'bg-green-100 text-green-800',
      'Pending': 'bg-yellow-100 text-yellow-800',
      'Overdue': 'bg-red-100 text-red-800',
      'Sent': 'bg-green-100 text-green-800',
      'Not Sent': 'bg-orange-100 text-orange-800',
      'Draft': 'bg-gray-100 text-gray-800'
    };
    return statusClasses[status] || 'bg-gray-100 text-gray-800';
  };

  const toggleDropdown = (invoiceId, e) => {
    e.stopPropagation();
    setActiveDropdown(activeDropdown === invoiceId ? null : invoiceId);
  };

  // Invoice actions
  const handleCreateInvoice = () => {
    setEditingInvoice(null);
    setShowInvoiceForm(true);
  };

  const handleViewInvoice = (invoice) => {
    if (invoice.invoice_type === 'po_invoice') {
      // For PO invoices, navigate to invoice details with PO invoice ID
      navigate(`/invoice/po/${invoice.id}`);
    } else {
      // Navigate to the full-page invoice component for regular invoices
      navigate(`/invoice/${invoice.id}`);
    }
    setActiveDropdown(null);
  };

  const handleEditInvoice = async (invoice) => {
    if (invoice.invoice_type === 'po_invoice') {
      // For PO invoices we want to open the Purchase Order in edit mode.
      // Pass the PO number through location state so the PurchaseOrder page
      // can forward it to the PO table which will open the Edit modal.
      navigate('/purchase-order', { state: { editPOId: invoice.po_number } });
    } else {
      try {
        // Fetch complete invoice data from API
        const response = await fetch(`${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'}/invoices/${invoice.id}`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch invoice details');
        }
        
        const completeInvoiceData = await response.json();
  console.debug('Complete invoice data for editing:', completeInvoiceData);
        
        setEditingInvoice(completeInvoiceData);
        setShowInvoiceForm(true);
      } catch (error) {
        console.error('Error fetching invoice for editing:', error);
        showNotification("Error", "Failed to load invoice details for editing");
      }
    }
    setActiveDropdown(null);
  };

  const handleDeleteInvoice = async (invoice) => {
    const invoiceDisplayId = invoice.invoice_type === 'po_invoice' ? invoice.invoice_number : invoice.id;
    const confirmMessage = invoice.invoice_type === 'po_invoice' 
      ? `Are you sure you want to delete PO invoice ${invoiceDisplayId}?\n\nThis will:\n- Remove the invoice from the system\n- Restore ${invoice.currency || 'PKR'} ${parseFloat(invoice.total_amount || 0).toLocaleString()} to PO ${invoice.po_number}\n- Add deletion to PO history`
      : `Are you sure you want to delete invoice ${invoiceDisplayId}?`;
      
    if (window.confirm(confirmMessage)) {
      try {
        let response;
        if (invoice.invoice_type === 'po_invoice') {
          response = await fetch(`${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'}/po-invoices/${invoice.id}`, {
            method: 'DELETE'
          });
        } else {
          response = await fetch(`${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'}/invoices/${invoice.id}`, {
            method: 'DELETE'
          });
        }
        
        if (!response.ok) {
          throw new Error('Failed to delete invoice');
        }
        
        // Get the response data for PO invoices to show restoration details
        let responseData = null;
        if (invoice.invoice_type === 'po_invoice') {
          responseData = await response.json();
        }
        
        setInvoicesData(prev => prev.filter(item => item.id !== invoice.id));
        
        // Update tab counts after deletion
        fetchTabCounts();
        
        if (invoice.invoice_type === 'po_invoice' && responseData) {
          showNotification(
            "PO Invoice Deleted", 
            `PO invoice ${invoiceDisplayId} deleted successfully.\n${responseData.poUpdate.message}`,
            "success"
          );
        } else {
          showNotification("Invoice deleted", `Invoice ${invoiceDisplayId} has been deleted`);
        }
      } catch (error) {
        console.error('Error deleting invoice:', error);
        showNotification("Error", "Failed to delete invoice", "error");
      }
    }
    setActiveDropdown(null);
  };

  const handleBulkDelete = async () => {
    if (!Array.isArray(selectedRows) || selectedRows.length === 0) return;
    
    if (window.confirm(`Are you sure you want to delete ${selectedRows.length} selected invoices?`)) {
      try {
        // Validate IDs are numbers
        const validIds = selectedRows.filter(id => typeof id === 'number' || !isNaN(id)).map(id => Number(id));
        
        if (validIds.length === 0) {
          showNotification("Error", "Invalid invoice IDs selected");
          return;
        }
        
        const apiBaseUrl = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api';
        const response = await fetch(`${apiBaseUrl}/invoices/bulk-delete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ ids: validIds })
        });
        
        const responseData = await response.json();
        
        if (!response.ok) {
          throw new Error(responseData?.error || 'Failed to delete invoices');
        }
        
        setInvoicesData(prev => prev.filter(item => !validIds.includes(Number(item.id))));
        setSelectedRows([]);
        
        // Update tab counts after bulk deletion
        fetchTabCounts();
        
        showNotification("Bulk delete successful", `${validIds.length} invoices have been deleted`);
      } catch (error) {
        console.error('Error deleting invoices:', error);
        showNotification("Error", error?.message || "Failed to delete invoices");
      }
    }
  };

  // Form handlers
  const handleFormSubmit = async (invoiceData) => {
    try {
      let response;
      
      if (editingInvoice) {
        // Update existing invoice
        response = await fetch(`${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'}/invoices/${editingInvoice.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(invoiceData)
        });
      } else {
        // Create new invoice
        response = await fetch(`${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'}/invoices`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(invoiceData)
        });
      }
      
      if (!response.ok) {
        throw new Error(`Failed to ${editingInvoice ? 'update' : 'create'} invoice`);
      }
      
      // Refresh the invoice list and tab counts
      await fetchInvoices();
      await fetchTabCounts();
      
      showNotification(
        `Invoice ${editingInvoice ? 'updated' : 'created'}`,
        `Invoice has been ${editingInvoice ? 'updated' : 'created'} successfully`
      );
    } catch (error) {
      console.error('Error saving invoice:', error);
      showNotification("Error", `Failed to ${editingInvoice ? 'update' : 'create'} invoice`);
    }
    
    setShowInvoiceForm(false);
    setEditingInvoice(null);
  };

  const handleFormCancel = () => {
    setShowInvoiceForm(false);
    setEditingInvoice(null);
  };

  if (loading) {
    return (
      <div className="p-4 flex justify-center items-center h-64">
        <div className="flex flex-col items-center">
          <Loader className="w-8 h-8 animate-spin text-blue-500 mb-2" />
          <div className="text-gray-500">Loading invoices...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* Notification */}
      {notification && (
        <div className="fixed top-4 right-4 z-50 bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded">
          <div className="font-bold">{notification.title}</div>
          <div>{notification.description}</div>
        </div>
      )}

      {/* Invoice Form Modal */}
      {showInvoiceForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"></div>
          <div ref={invoiceFormRef} className="relative bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto m-4 p-6">
            <div className="mb-4">
              <h2 className="text-2xl font-bold text-gray-800">
                {editingInvoice ? `Edit Invoice ${editingInvoice.id}` : 'Create New Invoice'}
              </h2>
            </div>
            <InvoiceForm
              initialData={editingInvoice}
              onSubmit={handleFormSubmit}
              onCancel={handleFormCancel}
            />
          </div>
        </div>
      )}


      {/* Main Invoice Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-5">
          <div>
            <h2 className="text-xl font-semibold">Invoices</h2>
            <p className="text-sm text-gray-500">
              Manage your billing and invoices efficiently
            </p>
          </div>
          
          <div className="flex flex-col xs:flex-row gap-3 w-full sm:w-auto">
            <div className="relative flex-grow">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Search invoices..."
                className="pl-10 pr-3 py-2 border rounded-md text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={searchTerm}
                onChange={(e) => {
                  // search term changed
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
              />
            </div>
            
            <div className="flex gap-2">
              <button
                onClick={handleCreateInvoice}
                className="flex items-center gap-1 bg-[#1976D2] text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-600 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Create Invoice
              </button>

              <button 
                className={`flex items-center gap-1 border rounded-md px-3 py-2 text-sm transition-colors ${
                  showFilters ? 'bg-gray-100 border-gray-300' : 'bg-white hover:bg-gray-50'
                }`}
                onClick={() => setShowFilters(!showFilters)}
              >
                <Filter className="w-4 h-4" />
                Filter
              </button>
            </div>
          </div>
        </div>

        {/* Bulk Actions */}
        {/* {selectedRows.length > 0 && (
          <div className="mb-4 p-3 bg-blue-50 rounded-md flex justify-between items-center">
            <div className="text-sm text-blue-800">
              {selectedRows.length} invoice(s) selected
            </div>
            <button
              onClick={handleBulkDelete}
              className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-600 rounded-md text-xs hover:bg-red-100"
            >
              <Trash2 className="w-3 h-3" />
              Delete Selected
            </button>
          </div>
        )} */}

        {/* Filter Panel */}
        {showFilters && (
          <div ref={filterPanelRef} className="bg-gray-50 p-4 rounded-lg mb-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Min Amount</label>
                <input
                  type="number"
                  name="minAmount"
                  placeholder="Min amount"
                  className="w-full p-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={filters.minAmount}
                  onChange={handleFilterChange}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Max Amount</label>
                <input
                  type="number"
                  name="maxAmount"
                  placeholder="Max amount"
                  className="w-full p-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={filters.maxAmount}
                  onChange={handleFilterChange}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">From Date</label>
                <input
                  type="date"
                  name="dateFrom"
                  className="w-full p-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={filters.dateFrom}
                  onChange={handleFilterChange}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">To Date</label>
                <input
                  type="date"
                  name="dateTo"
                  className="w-full p-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={filters.dateTo}
                  onChange={handleFilterChange}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Contact Person Name</label>
                <input
                  type="text"
                  name="customer"
                  className="w-full p-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={filters.customer}
                  onChange={handleFilterChange}
                  placeholder="Type Contact Person name..."
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Company</label>
                <input
                  list="company-list"
                  type="text"
                  name="company"
                  className="w-full p-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={filters.company}
                  onChange={(e) => {
                    handleFilterChange(e);
                    const val = (e.target.value || '').trim();
                    if (val === '') {
                      setCompanyExists(null);
                    } else {
                      setCompanyExists(companies.some(c => c.toLowerCase() === val.toLowerCase()));
                    }
                  }}
                  placeholder="Type company name..."
                />
                <datalist id="company-list">
                  {(() => {
                    const searchTerm = (filters.company || '').trim().toLowerCase();
                    if (!searchTerm) return companies.map((c) => <option key={c} value={c} />);
                    
                    // Filter companies based on fuzzy matching
                    const filtered = companies
                      .filter(c => c.toLowerCase().includes(searchTerm))
                      .sort((a, b) => {
                        const aLower = a.toLowerCase();
                        const bLower = b.toLowerCase();
                        
                        // Exact match first
                        if (aLower === searchTerm) return -1;
                        if (bLower === searchTerm) return 1;
                        
                        // Starts with search term
                        const aStarts = aLower.startsWith(searchTerm);
                        const bStarts = bLower.startsWith(searchTerm);
                        if (aStarts && !bStarts) return -1;
                        if (!aStarts && bStarts) return 1;
                        
                        // Alphabetical order
                        return a.localeCompare(b);
                      })
                      .slice(0, 10); // Show only top 10 matches
                    
                    return filtered.map((c) => <option key={c} value={c} />);
                  })()}
                </datalist>

                {/* Company existence hint */}
                {companyExists === true && (
                  <div className="mt-1 text-xs text-green-600">✓ Company found</div>
                )}
                {companyExists === false && filters.company.trim() !== '' && (
                  <div className="mt-1 text-xs text-red-600">✗ No matching company</div>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
                <select
                  name="status"
                  className="w-full p-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={filters.status}
                  onChange={handleFilterChange}
                >
                  <option value="">All Status</option>
                  <option value="Draft">Draft</option>
                  <option value="Not Sent">Not Sent</option>
                  <option value="Sent">Sent</option>
                  <option value="Pending">Pending</option>
                  <option value="Paid">Paid</option>
                  
                  <option value="Overdue">Overdue</option>
                </select>
              </div>
              {/* currency filter removed per request */}
            </div>
            
            {/* Action Buttons */}
            <div className="flex justify-between items-center pt-4 border-t border-gray-200">
              <div className="flex items-center gap-3">
                <button
                  onClick={applyFilters}
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium transition-colors shadow-sm flex items-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Search
                </button>
                <button
                  onClick={resetFilters}
                  className="px-4 py-2.5 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-sm font-medium transition-colors"
                >
                  Reset
                </button>
              </div>
              
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-gray-700">Items per page:</label>
                <select
                  value={itemsPerPage}
                  onChange={(e) => {
                    setItemsPerPage(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="p-2 border rounded text-sm focus:ring-2 focus:ring-blue-500"
                >
                  {[10, 20, 50, 100].map(option => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="overflow-x-auto mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex border-b w-max min-w-full">
              {['All', 'Paid', 'Pending', 'Overdue', 'Sent', 'Not Sent', 'PO Invoices'].map(status => {
                const counts = getTabCounts();
                return (
                  <button
                    key={status}
                    className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 ${
                      activeTab === status
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                    onClick={() => {
                      // tab clicked
                      setActiveTab(status);
                      setCurrentPage(1);
                      // Clear status filter when clicking tabs to avoid conflicts
                      if (status !== 'All' && status !== 'PO Invoices') {
                        setFilters(prev => ({ ...prev, status: '' }));
                      }
                    }}
                >
                  {status} ({counts[status] || 0})
                </button>
                );
              })}
            </div>

          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-white">
              <tr className="text-center text-sm font-normal text-black">
                <th className="pb-3 px-2 whitespace-nowrap w-10">
                  <input
                    type="checkbox"
                    checked={visibleInvoices.length > 0 && selectedRows.length === visibleInvoices.length}
                    onChange={toggleSelectAll}
                    className="rounded text-blue-500 focus:ring-blue-500"
                  />
                </th>
                <th className="pb-3 px-2 whitespace-nowrap text-left">Invoice ID</th>
                <th className="pb-3 px-2 whitespace-nowrap text-left">Billing Date</th>
                <th className="pb-3 px-2 whitespace-nowrap text-left">Contact Person</th>
                <th className="pb-3 px-2 whitespace-nowrap text-right">Amount</th>
                <th className="pb-3 px-2 whitespace-nowrap">Status</th>
                <th className="pb-3 px-2 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleInvoices.length === 0 ? (
                <tr>
                  <td colSpan="7" className="py-8 text-center text-sm text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <Search className="w-8 h-8 text-gray-300 mb-2" />
                      No invoices found matching your criteria
                      {searchTerm || Object.values(filters).some(Boolean) ? (
                        <button
                          onClick={resetFilters}
                          className="mt-2 text-blue-500 hover:text-blue-700 text-sm"
                        >
                          Clear filters
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ) : (
                visibleInvoices.map((invoice, index) => (
                  <tr 
                    key={invoice.id} 
                    className={`hover:bg-gray-50 ${selectedRows.includes(invoice.id) ? 'bg-blue-50' : ''}`}
                  >
                    <td className="px-4 py-4 whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={selectedRows.includes(invoice.id)}
                        onChange={() => toggleSelectRow(invoice.id)}
                        className="rounded text-blue-500 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-4 py-4 text-sm font-medium text-gray-900 whitespace-nowrap">
                      <div className="flex flex-col">
                        <div className="flex items-center space-x-2">
                          <span>{invoice.invoice_number || `INV-${invoice.id}`}</span>
                          {invoice.invoice_type === 'po_invoice' && (
                            <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
                              PO
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-gray-500">
                          Due: {formatDate(invoice.payment_deadline)}
                        </span>
                        {invoice.po_number && (
                          <span className="text-xs text-blue-600">
                            From: {invoice.po_number}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-500 whitespace-nowrap">
                      {formatDate(invoice.bill_date)}
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-500">
                      <div className="line-clamp-1">{invoice.customer_name}</div>
                    </td>
                    <td className="px-4 py-4 text-sm font-medium text-gray-900 whitespace-nowrap text-right">
                      {invoice.currency} {invoice.total_amount?.toLocaleString()}
                    </td>
                    <td className="px-4 py-4 text-sm whitespace-nowrap text-center">
                      <span className={`px-2 py-1 inline-flex items-center justify-center text-xs font-semibold rounded-full ${getStatusClass(invoice.status)}`}>
                        {invoice.status || 'Pending'}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm whitespace-nowrap relative">
                      <div className="flex justify-center">
                        <button 
                          className="text-gray-400 hover:text-gray-600"
                          onClick={(e) => toggleDropdown(invoice.id, e)}
                          aria-label="Invoice actions"
                        >
                          <Ellipsis className="h-5 w-5" />
                        </button>
                        
                        {activeDropdown === invoice.id && (
                          <div 
                            ref={el => dropdownRefs.current[index] = el}
                            className="absolute right-0 z-50 mt-2 w-48 bg-white rounded-md shadow-lg border border-gray-200"
                          >
                            <div className="py-1">
                              <button
                                onClick={() => handleViewInvoice(invoice)}
                                className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 w-full text-left"
                              >
                                <Eye className="w-4 h-4 mr-2" />
                                {invoice.invoice_type === 'po_invoice' ? 'View PO Inovice' : 'View'}
                              </button>
                              {invoice.invoice_type !== 'po_invoice' && (
                                <>
                                  <button
                                    onClick={() => handleEditInvoice(invoice)}
                                    className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 w-full text-left"
                                  >
                                    <Edit className="w-4 h-4 mr-2" />
                                    Edit
                                  </button>
                                </>
                              )}
                              {/* Edit in PO option intentionally hidden for PO invoices */}
                              <button
                                onClick={() => handleDeleteInvoice(invoice)}
                                className="flex items-center px-4 py-2 text-sm text-red-600 hover:bg-red-50 w-full text-left"
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Delete
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row justify-between items-center px-4 py-3 border-t border-gray-200 bg-white gap-3">
            <div className="text-sm text-gray-700">
              Showing {startIndex + 1}-{Math.min(startIndex + itemsPerPage, filteredInvoices().length)} of {filteredInvoices().length} invoices
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="px-3 py-1 border border-gray-300 rounded-md text-sm bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                Previous
              </button>
              
              {pages.map((p, idx) => (
                p === '...' ? (
                  <div key={`dots-${idx}`} className="px-3 py-1 text-sm rounded-md min-w-[36px] flex items-center justify-center">...</div>
                ) : (
                  <button
                    key={p}
                    onClick={() => handlePageChange(p)}
                    className={`px-3 py-1 text-sm rounded-md min-w-[36px] ${
                      currentPage === p
                        ? "bg-blue-500 text-white border-blue-500"
                        : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                    } border`}
                  >
                    {p}
                  </button>
                )
              ))}
              
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="px-3 py-1 border border-gray-300 rounded-md text-sm bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default InvoiceManagement;