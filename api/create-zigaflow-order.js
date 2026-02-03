const lineItems = input.lineItems || [];
const trigger = input.trigger || {};
const lookup2 = input.lookup2 || {};
const agg = input.aggregations || {};

// ============ STEP 1: Calculate Section Names ============
const productCodeGroups = {};

lineItems.forEach(item => {
  const code = item.productCode || '';
  if (!productCodeGroups[code]) {
    productCodeGroups[code] = {
      productRange: item.productRange || '',
      finish: item.finish || '',
      thickness: item.thickness || '',
      backing: item.backing || '',
      size: item.size || '',
      totalSheets: 0,
      totalPrints: 0,
      orderMultiple: parseInt(item.orderMultiple) || 1
    };
  }
  productCodeGroups[code].totalSheets += parseInt(item.sheets) || 0;
  productCodeGroups[code].totalPrints += parseInt(item.prints) || 0;
});

// Convert prints to sheets when >= orderMultiple
Object.keys(productCodeGroups).forEach(code => {
  const group = productCodeGroups[code];
  const orderMultiple = group.orderMultiple;
  if (group.totalPrints >= orderMultiple && orderMultiple > 0) {
    const additionalSheets = Math.floor(group.totalPrints / orderMultiple);
    group.totalSheets += additionalSheets;
    group.totalPrints = group.totalPrints % orderMultiple;
  }
});

// Build section names
const sectionNames = {};
Object.keys(productCodeGroups).forEach(code => {
  const g = productCodeGroups[code];
  sectionNames[code] = `${g.productRange} - ${g.finish} - ${g.thickness} - ${g.backing} - ${g.size} - Total Sheets (${g.totalSheets}), Total Prints (${g.totalPrints})`;
});

// Get unique sections for creation
const uniqueSections = [...new Set(Object.values(sectionNames))];

// ============ STEP 2: Build Payload ============
const payload = {
  customerName: lookup2['Customer Name'] || '',
  zigaflowClientId: lookup2['Zigaflow Client ID'] || '',
  mainContactName: lookup2['Main Contact'] || '',
  mainContactId: lookup2['Main Contact ID'] || '',
  mainContactEmail: lookup2['Main Contact Email'] || '',
  poNumber: trigger['PO Number'] || '',
  priceList: lookup2['Price List'] || '',
  orderDate: trigger['Order Date'] || new Date().toISOString().split('T')[0],
  requiredDeliveryDate: trigger['Required Delivery Date'] || '',
  customerMessage: trigger['Customer Message'] || '',
  assignedUserEmail: lookup2['Assigned User Email'] || '',
  initialAssignedUserEmail: lookup2['Initial Assigned User Email'] || '',
  
  aggregations: {
    gloss3mm: parseInt(agg.gloss3mm) || 0,
    gloss4mm: parseInt(agg.gloss4mm) || 0,
    matt3mm: parseInt(agg.matt3mm) || 0,
    matt4mm: parseInt(agg.matt4mm) || 0
  },
  
  deliveryDetails: {
    contactName: trigger['Ship Contact'] || '',
    companyName: trigger['Ship Company'] || '',
    address: trigger['Ship Address'] || '',
    number: String(trigger['Ship Number'] || ''),
    email: trigger['Ship Email'] || ''
  },
  
  // Sections to create
  sections: uniqueSections.map(name => ({
    name: name,
    style_name: 'Default'
  })),
  
  // Line items with section assignment
  lineItems: lineItems.map(item => {
    const sectionName = sectionNames[item.productCode] || '';
    const detailedDescription = `${item.size || ''}, ${item.finish || ''}, ${item.thickness || ''}, ${item.backing || ''} - ${item.design || ''}`;
    
    // Woodgrain type formatting
    const woodgrainValue = item.bespokeBacking 
      ? `Bespoke Woodgrain - ${item.bespokeBacking}` 
      : (item.woodgrainType || '');
    
    return {
      productCode: item.productCode || '',
      productRange: item.productRange || '',
      design: item.design || '',
      size: item.size || '',
      thickness: item.thickness || '',
      backing: item.backing || '',
      bespokeBacking: item.bespokeBacking || '',
      finish: item.finish || '',
      quantity: parseInt(item.quantity) || 0,
      sheets: parseInt(item.sheets) || 0,
      prints: parseInt(item.prints) || 0,
      woodgrainType: woodgrainValue,
      woodgrainSheets: parseInt(item.woodgrainSheets) || 0,
      woodgrainPrints: parseInt(item.woodgrainPrints) || 0,
      orderMultiple: parseInt(item.orderMultiple) || 1,
      salesCode: item.salesCode || '',
      jigId: item.jigId || '',
      backJigId: item.backJigId || '',
      sectionName: sectionName,
      detailedDescription: detailedDescription,
      price: parseFloat(item.price) || 0,
      lineTotal: parseFloat(item.lineTotal) || 0
    };
  })
};

console.log('Built Zigaflow payload with', payload.lineItems.length, 'line items and', payload.sections.length, 'sections');

return JSON.stringify(payload);
