// api/zigaflow/sync-pricelists.js
// Syncs price list names and IDs from Zigaflow to Softr

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Security (allow Vercel Cron OR admin API key)
  const isVercelCron = req.headers['user-agent']?.includes('vercel-cron');
  const authHeader = req.headers['authorization'];

  if (!isVercelCron && authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('🔄 Starting Zigaflow → Softr price list sync...');

    // Step 1: Fetch all price lists from Zigaflow
    console.log('📥 Fetching price lists from Zigaflow...');
    
    const zigaflowResponse = await fetch('https://api.zigaflow.com/v1/pricelist', {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'x-api-key': process.env.ZIGAFLOW_API_KEY
      }
    });

    if (!zigaflowResponse.ok) {
      const errorText = await zigaflowResponse.text();
      throw new Error(`Zigaflow API error: ${zigaflowResponse.status} - ${errorText}`);
    }

    const zigaflowData = await zigaflowResponse.json();
    const priceLists = zigaflowData.data || [];

    console.log(`✅ Fetched ${priceLists.length} price lists from Zigaflow`);

    // Step 2: Get Softr table schema
    const schemaResponse = await fetch(
      `https://tables-api.softr.io/api/v1/databases/${process.env.SOFTR_DATABASE_ID}/tables/${process.env.PRICELISTS_TABLE_ID}`,
      {
        headers: {
          'Softr-Api-Key': process.env.SOFTR_API_KEY
        }
      }
    );

    if (!schemaResponse.ok) {
      const errorText = await schemaResponse.text();
      throw new Error(`Failed to fetch Softr table schema: ${schemaResponse.status} - ${errorText}`);
    }

    const schemaData = await schemaResponse.json();
    const fields = schemaData.data.fields || [];
    
    // Create field mapping
    const fieldMap = {};
    fields.forEach(field => {
      fieldMap[field.name] = field.id;
    });

    console.log('📋 Softr field mapping created:', Object.keys(fieldMap));

    // Check required fields exist
    const requiredFields = ['Zigaflow ID', 'Name', 'Description', 'Currency'];
    const missingFields = requiredFields.filter(f => !fieldMap[f]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        error: 'Missing required fields in Softr table',
        missingFields,
        availableFields: Object.keys(fieldMap)
      });
    }

    // Step 3: Get existing price lists from Softr
    const existingResponse = await fetch(
      `https://tables-api.softr.io/api/v1/databases/${process.env.SOFTR_DATABASE_ID}/tables/${process.env.PRICELISTS_TABLE_ID}/records?limit=500`,
      {
        headers: {
          'Softr-Api-Key': process.env.SOFTR_API_KEY
        }
      }
    );

    const existingData = await existingResponse.json();
    const existingRecords = existingData.data || [];
    
    console.log(`📊 Found ${existingRecords.length} existing price lists in Softr`);

    let createdCount = 0;
    let updatedCount = 0;
    let errorCount = 0;
    const errors = [];

    // Step 4: Sync each price list
    for (const priceList of priceLists) {
      try {
        const zigaflowId = priceList.id;
        const name = priceList.name;
        const description = priceList.description || '';
        const currency = priceList.Currency?.value || 'GBP';

        console.log(`🔍 Processing: ${name}`);

        // Map Zigaflow data to Softr fields using field IDs
        const softrData = {
          [fieldMap['Zigaflow ID']]: zigaflowId,
          [fieldMap['Name']]: name,
          [fieldMap['Description']]: description,
          [fieldMap['Currency']]: currency
        };

        // Check if price list already exists (by Zigaflow ID or Name)
        const existingRecord = existingRecords.find(record => 
          record.fields[fieldMap['Zigaflow ID']] === zigaflowId ||
          record.fields[fieldMap['Name']] === name
        );

        if (existingRecord) {
          // Update existing
          console.log(`   🔄 Updating existing price list (ID: ${existingRecord.id})`);
          
          const updateResponse = await fetch(
            `https://tables-api.softr.io/api/v1/databases/${process.env.SOFTR_DATABASE_ID}/tables/${process.env.PRICELISTS_TABLE_ID}/records/${existingRecord.id}`,
            {
              method: 'PATCH',
              headers: {
                'Softr-Api-Key': process.env.SOFTR_API_KEY,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ fields: softrData })
            }
          );

          if (updateResponse.ok) {
            updatedCount++;
            console.log(`   ✅ Updated`);
          } else {
            const errText = await updateResponse.text();
            throw new Error(`Update failed: ${updateResponse.status} - ${errText}`);
          }

        } else {
          // Create new
          console.log(`   ✨ Creating new price list`);
          
          const createResponse = await fetch(
            `https://tables-api.softr.io/api/v1/databases/${process.env.SOFTR_DATABASE_ID}/tables/${process.env.PRICELISTS_TABLE_ID}/records`,
            {
              method: 'POST',
              headers: {
                'Softr-Api-Key': process.env.SOFTR_API_KEY,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ fields: softrData })
            }
          );

          if (createResponse.ok) {
            createdCount++;
            console.log(`   ✅ Created`);
          } else {
            const errText = await createResponse.text();
            throw new Error(`Create failed: ${createResponse.status} - ${errText}`);
          }
        }

      } catch (error) {
        console.error(`   ❌ Error processing ${priceList.name}:`, error.message);
        errorCount++;
        errors.push({
          priceList: priceList.name,
          error: error.message
        });
      }
    }

    console.log('\n═══════════════════════════════════════');
    console.log('✅ PRICE LIST SYNC COMPLETE');
    console.log(`   Created: ${createdCount}`);
    console.log(`   Updated: ${updatedCount}`);
    console.log(`   Errors: ${errorCount}`);
    console.log('═══════════════════════════════════════');

    return res.status(200).json({
      success: true,
      summary: {
        total: priceLists.length,
        created: createdCount,
        updated: updatedCount,
        errors: errorCount
      },
      fieldMapping: fieldMap,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('💥 Fatal sync error:', error);
    return res.status(500).json({ 
      success: false,
      error: error.message
    });
  }
}
