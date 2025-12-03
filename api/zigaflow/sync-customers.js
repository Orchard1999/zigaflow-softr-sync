export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Security (allow Vercel Cron OR admin API key)
  const isVercelCron = req.headers['user-agent']?.includes('vercel-cron');
  const authHeader = req.headers['authorization'];

  // DEBUG LOGGING
  console.log('🔍 Received authHeader:', authHeader);
  console.log('🔍 Expected:', `Bearer ${process.env.ADMIN_API_KEY}`);
  console.log('🔍 ADMIN_API_KEY value:', process.env.ADMIN_API_KEY);
  console.log('🔍 Match:', authHeader === `Bearer ${process.env.ADMIN_API_KEY}`);

  if (!isVercelCron && authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('🔄 Starting Zigaflow → Softr customer sync...');

    // Step 1: Fetch ALL clients from Zigaflow (with pagination)
    let allClients = [];
    let skip = 0;
    const top = 100;
    let hasMore = true;
    let totalCount = 0;

    console.log('📥 Fetching all clients from Zigaflow...');

    while (hasMore) {
      const clientsResponse = await fetch(
        `${process.env.ZIGAFLOW_BASE_URL}/v1/clients?skip=${skip}&top=${top}`,
        {
          headers: {
            'x-api-key': process.env.ZIGAFLOW_API_KEY
          }
        }
      );

      if (!clientsResponse.ok) {
        const errorText = await clientsResponse.text();
        throw new Error(`Zigaflow API error: ${clientsResponse.status} - ${errorText}`);
      }

      const clientsData = await clientsResponse.json();
      const batch = clientsData.data || [];
      totalCount = clientsData.total_count || 0;
      
      allClients = allClients.concat(batch);
      console.log(`   📄 Page ${Math.floor(skip / top) + 1}: Fetched ${batch.length} clients (Total: ${allClients.length}/${totalCount})`);
      
      // If we got fewer than 'top' results, we've reached the end
      hasMore = batch.length === top;
      skip += top;
    }

    const clients = allClients;
    console.log(`✅ Fetched ${clients.length} total clients from Zigaflow`);

    // Step 2: Get Softr table schema
    const schemaResponse = await fetch(
      `https://tables-api.softr.io/api/v1/databases/${process.env.SOFTR_DATABASE_ID}/tables/${process.env.SOFTR_CUSTOMERS_TABLE_ID}`,
      {
        headers: {
          'Softr-Api-Key': process.env.SOFTR_API_KEY
        }
      }
    );

    if (!schemaResponse.ok) {
      throw new Error('Failed to fetch Softr table schema');
    }

    const schemaData = await schemaResponse.json();
    const fields = schemaData.data.fields || [];
    
    // Create field mapping
    const fieldMap = {};
    fields.forEach(field => {
      fieldMap[field.name] = field.id;
    });

    console.log('📋 Softr field mapping created:', Object.keys(fieldMap).length, 'fields');

    // Step 3: Get existing Softr customers
    const existingResponse = await fetch(
      `https://tables-api.softr.io/api/v1/databases/${process.env.SOFTR_DATABASE_ID}/tables/${process.env.SOFTR_CUSTOMERS_TABLE_ID}/records?limit=5000`,
      {
        headers: {
          'Softr-Api-Key': process.env.SOFTR_API_KEY
        }
      }
    );

    const existingData = await existingResponse.json();
    const existingCustomers = existingData.data || [];
    
    console.log(`📊 Found ${existingCustomers.length} existing customers in Softr`);

    let createdCount = 0;
    let updatedCount = 0;
    let errorCount = 0;
    const errors = [];

    // Step 4: Sync each client
    for (const client of clients) {
      try {
        console.log(`\n🔍 Processing: ${client.name}`);

        // Get primary contact from embedded contacts array
        const primaryContact = client.contacts && client.contacts.length > 0 ? client.contacts[0] : null;

        // Fetch addresses for this client
        let primaryAddress = null;
        try {
          const addressesResponse = await fetch(
            `${process.env.ZIGAFLOW_BASE_URL}/v1/clients/${client.id}/addresses`,
            {
              headers: {
                'x-api-key': process.env.ZIGAFLOW_API_KEY
              }
            }
          );

          if (addressesResponse.ok) {
            const addresses = await addressesResponse.json();
            primaryAddress = addresses.length > 0 ? addresses[0] : null;
          }
        } catch (error) {
          console.log('   ⚠️ Could not fetch addresses:', error.message);
        }

        // Build billing address string
        let billingAddress = '';
        if (primaryAddress) {
          const parts = [
            primaryAddress.address1,
            primaryAddress.address2,
            primaryAddress.address3,
            primaryAddress.town,
            primaryAddress.county,
            primaryAddress.postcode,
            primaryAddress.country
          ].filter(Boolean);
          billingAddress = parts.join('\n');
        }

        // Build main contact name (FIXED: use first_name and last_name)
        let mainContact = '';
        if (primaryContact) {
          const nameParts = [
            primaryContact.title,
            primaryContact.first_name,
            primaryContact.last_name
          ].filter(Boolean);
          mainContact = nameParts.join(' ');
        }

        // Extract tags values from objects (FIXED: tags are objects with id and value)
        let tagsString = '';
        if (Array.isArray(client.tags) && client.tags.length > 0) {
          tagsString = client.tags.map(tag => tag.value || tag).filter(Boolean).join(', ');
        }

        // Map Zigaflow data to Softr fields
        const softrData = {
          [fieldMap['Customer Name']]: client.name || '',
          [fieldMap['Email']]: primaryContact?.email || client.email || '',
          [fieldMap['Main Contact']]: mainContact,
          [fieldMap['Billing Address']]: billingAddress,
          [fieldMap['Zigaflow Client ID']]: client.id.toString(),
          [fieldMap['Price List']]: client.price_list || '',  // FIXED: use price_list
          [fieldMap['Account Manager']]: client.account_manager || '',  // Try account_manager
          [fieldMap['Tags']]: tagsString,  // FIXED: extract value from tag objects
          [fieldMap['Last Synced']]: new Date().toISOString()
        };

        // Check if customer already exists
        const existingCustomer = existingCustomers.find(record => 
          record.fields[fieldMap['Zigaflow Client ID']] === client.id.toString() ||
          record.fields[fieldMap['Customer Name']] === client.name
        );

        if (existingCustomer) {
          // Update existing
          console.log(`   🔄 Updating existing customer (ID: ${existingCustomer.id})`);
          
          await fetch(
            `https://tables-api.softr.io/api/v1/databases/${process.env.SOFTR_DATABASE_ID}/tables/${process.env.SOFTR_CUSTOMERS_TABLE_ID}/records/${existingCustomer.id}`,
            {
              method: 'PATCH',
              headers: {
                'Softr-Api-Key': process.env.SOFTR_API_KEY,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ fields: softrData })
            }
          );
          
          updatedCount++;
          console.log(`   ✅ Updated`);

        } else {
          // Create new
          console.log(`   ✨ Creating new customer`);
          
          await fetch(
            `https://tables-api.softr.io/api/v1/databases/${process.env.SOFTR_DATABASE_ID}/tables/${process.env.SOFTR_CUSTOMERS_TABLE_ID}/records`,
            {
              method: 'POST',
              headers: {
                'Softr-Api-Key': process.env.SOFTR_API_KEY,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ fields: softrData })
            }
          );
          
          createdCount++;
          console.log(`   ✅ Created`);
        }

      } catch (error) {
        console.error(`   ❌ Error processing ${client.name}:`, error.message);
        errorCount++;
        errors.push({
          client: client.name,
          error: error.message
        });
      }
    }

    console.log('\n═══════════════════════════════════════');
    console.log('✅ SYNC COMPLETE');
    console.log(`   Created: ${createdCount}`);
    console.log(`   Updated: ${updatedCount}`);
    console.log(`   Errors: ${errorCount}`);
    console.log('═══════════════════════════════════════');

    return res.status(200).json({
      success: true,
      summary: {
        total: clients.length,
        created: createdCount,
        updated: updatedCount,
        errors: errorCount
      },
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('💥 Fatal sync error:', error);
    return res.status(500).json({ 
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
