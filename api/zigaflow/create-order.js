export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const {
      customerName,
      zigaflowClientId,
      mainContactName,
      mainContactId,
      mainContactEmail,
      poNumber,
      orderDate,
      requiredDeliveryDate,
      customerMessage,
      assignedUserEmail,
      aggregations, // {gloss3mm, gloss4mm, matt3mm, matt4mm}
      deliveryDetails, // {contactName, companyName, address, number, email}
      lineItems // [{productCode, quantity, price, ...}]
    } = req.body;

    console.log('📦 Creating Zigaflow order for:', customerName);
    console.log('   Client ID:', zigaflowClientId);
    console.log('   Contact ID:', mainContactId);
    console.log('   Line items:', lineItems?.length || 0);

    // Validate required fields
    if (!zigaflowClientId || !mainContactId || !lineItems || lineItems.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: zigaflowClientId, mainContactId, or lineItems'
      });
    }

    // Format dates
    const orderDateFormatted = orderDate ? new Date(orderDate).toISOString() : new Date().toISOString();
    const deliveryDateFormatted = requiredDeliveryDate ? new Date(requiredDeliveryDate).toISOString() : null;

    // Build custom fields array
    const customFields = [];
    
    // Aggregations (Custom[Gloss4.8mm], Custom[Gloss3m], Custom[Matt4mm], Custom[Matt3mm])
    if (aggregations) {
      customFields.push(
        { label: 'Gloss4mm', value: String(aggregations.gloss4mm || 0) },
        { label: 'Gloss3mm', value: String(aggregations.gloss3mm || 0) },
        { label: 'Matt4mm', value: String(aggregations.matt4mm || 0) },
        { label: 'Matt3mm', value: String(aggregations.matt3mm || 0) }
      );
    }

    // Shipping details (Custom[ShiptoContactName], etc.)
    if (deliveryDetails) {
      customFields.push(
        { label: 'ShiptoContactName', value: deliveryDetails.contactName || '' },
        { label: 'ShiptoCompanyName', value: deliveryDetails.companyName || '' },
        { label: 'ShiptoAddress', value: deliveryDetails.address || '' },
        { label: 'ShiptoNumber', value: deliveryDetails.number || '' },
        { label: 'ShiptoEmail', value: deliveryDetails.email || '' }
      );
    }

    // Build one_off_delivery_address
    const deliveryAddress = {};
    if (deliveryDetails?.address) {
      const addressLines = deliveryDetails.address.split('\n').filter(Boolean);
      deliveryAddress.address1 = addressLines[0] || '';
      deliveryAddress.address2 = addressLines[1] || '';
      
      // Try to extract postcode (usually last line)
      const lastLine = addressLines[addressLines.length - 1] || '';
      const postcodeMatch = lastLine.match(/[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}/i);
      if (postcodeMatch) {
        deliveryAddress.postcode = postcodeMatch[0];
      }
    }

    // Step 1: Create Job in Zigaflow
    console.log('   📝 Creating job...');
    
    const jobPayload = {
      client: {
        id: zigaflowClientId,
        value: customerName
      },
      contact: {
        id: mainContactId,
        value: mainContactName
      },
      reference: 'ORC-O',
      client_reference: customerMessage || '',
      po_number: poNumber || '',
      description: `Import ID: ${orderDateFormatted}`,
      template_name: 'Job Upload Template',
      estimated_start: orderDateFormatted,
      estimated_delivery: deliveryDateFormatted,
      custom_fields: customFields
    };

    // Add delivery address if we have it
    if (Object.keys(deliveryAddress).length > 0) {
      jobPayload.one_off_delivery_address = deliveryAddress;
    }

    console.log('   Job payload:', JSON.stringify(jobPayload, null, 2));

    const createJobResponse = await fetch(
      `${process.env.ZIGAFLOW_BASE_URL}/v1/jobs`,
      {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ZIGAFLOW_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(jobPayload)
      }
    );

    if (!createJobResponse.ok) {
      const errorText = await createJobResponse.text();
      console.error('   ❌ Job creation failed:', errorText);
      throw new Error(`Failed to create job: ${createJobResponse.status} - ${errorText}`);
    }

    const jobResult = await createJobResponse.json();
    const jobId = jobResult.data?.id || jobResult.id;
    const jobNumber = jobResult.data?.number || jobResult.number;

    console.log('   ✅ Job created! ID:', jobId, 'Number:', jobNumber);

    // Step 2: Add Line Items
    console.log('   📦 Adding line items...');
    
    let addedCount = 0;
    const lineItemErrors = [];

    for (const item of lineItems) {
      try {
        // Build line item payload with all available fields
        const lineItemPayload = {
          product_code: item.productCode || '',
          price: parseFloat(item.price) || 0,
          quantity: parseInt(item.quantity) || 0,
          category: item.productRange || ''
        };

        console.log(`      Adding: ${item.productCode} (${item.design}) x${item.quantity}`);

        const addItemResponse = await fetch(
          `${process.env.ZIGAFLOW_BASE_URL}/v1/jobs/${jobId}/addItem`,
          {
            method: 'POST',
            headers: {
              'x-api-key': process.env.ZIGAFLOW_API_KEY,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(lineItemPayload)
          }
        );

        if (!addItemResponse.ok) {
          const errorText = await addItemResponse.text();
          console.error(`      ❌ Failed to add ${item.productCode}:`, errorText);
          lineItemErrors.push({
            productCode: item.productCode,
            design: item.design,
            error: errorText
          });
        } else {
          addedCount++;
          console.log(`      ✅ Added`);
        }

      } catch (error) {
        console.error(`      ❌ Error adding ${item.productCode}:`, error.message);
        lineItemErrors.push({
          productCode: item.productCode,
          design: item.design,
          error: error.message
        });
      }
    }

    console.log('   ✅ Line items complete:', addedCount, 'of', lineItems.length);
    console.log('═══════════════════════════════════════');
    console.log('✅ ZIGAFLOW ORDER CREATED');
    console.log(`   Job ID: ${jobId}`);
    console.log(`   Job Number: ${jobNumber}`);
    console.log(`   Customer: ${customerName}`);
    console.log(`   Line Items: ${addedCount}/${lineItems.length}`);
    console.log('═══════════════════════════════════════');

    return res.status(200).json({
      success: true,
      data: {
        jobId: jobId,
        jobNumber: jobNumber,
        customerName: customerName,
        lineItemsAdded: addedCount,
        lineItemsTotal: lineItems.length,
        errors: lineItemErrors.length > 0 ? lineItemErrors : undefined
      }
    });

  } catch (error) {
    console.error('❌ Zigaflow order creation error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
