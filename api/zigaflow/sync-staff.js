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

  if (!isVercelCron && authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('🔄 Starting Zigaflow → Softr staff sync...');

    const STAFF_TABLE_ID = 'XBbqb2i3Fn8nfL';

    // Step 1: Fetch users from Zigaflow
    console.log('📥 Fetching users from Zigaflow...');
    
    const usersResponse = await fetch(
      `${process.env.ZIGAFLOW_BASE_URL}/v1/users`,
      {
        headers: {
          'x-api-key': process.env.ZIGAFLOW_API_KEY
        }
      }
    );

    if (!usersResponse.ok) {
      const errorText = await usersResponse.text();
      throw new Error(`Zigaflow API error: ${usersResponse.status} - ${errorText}`);
    }

    const usersData = await usersResponse.json();
    const users = usersData.data || [];
    
    console.log(`✅ Fetched ${users.length} users from Zigaflow`);

    // Step 2: Get Softr table schema
    const schemaResponse = await fetch(
      `https://tables-api.softr.io/api/v1/databases/${process.env.SOFTR_DATABASE_ID}/tables/${STAFF_TABLE_ID}`,
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

    console.log('📋 Softr field mapping:', Object.keys(fieldMap));

    // Step 3: Get existing staff records
    const existingResponse = await fetch(
      `https://tables-api.softr.io/api/v1/databases/${process.env.SOFTR_DATABASE_ID}/tables/${STAFF_TABLE_ID}/records?limit=500`,
      {
        headers: {
          'Softr-Api-Key': process.env.SOFTR_API_KEY
        }
      }
    );

    const existingData = await existingResponse.json();
    const existingStaff = existingData.data || [];
    
    console.log(`📊 Found ${existingStaff.length} existing staff in Softr`);

    let createdCount = 0;
    let updatedCount = 0;
    let errorCount = 0;
    const errors = [];

    // Step 4: Sync each user
    for (const user of users) {
      try {
        const fullName = `${user.FirstName} ${user.LastName}`;
        console.log(`\n🔍 Processing: ${fullName}`);

        // Map Zigaflow data to Softr fields
        const softrData = {
          [fieldMap['ID']]: user.ID,
          [fieldMap['First Name']]: user.FirstName || '',
          [fieldMap['Last Name']]: user.LastName || '',
          [fieldMap['Email']]: user.Email || ''
        };

        // Check if user already exists (by ID)
        const existingUser = existingStaff.find(record => 
          record.fields[fieldMap['ID']] === user.ID
        );

        if (existingUser) {
          // Update existing
          console.log(`   🔄 Updating existing user (ID: ${existingUser.id})`);
          
          await fetch(
            `https://tables-api.softr.io/api/v1/databases/${process.env.SOFTR_DATABASE_ID}/tables/${STAFF_TABLE_ID}/records/${existingUser.id}`,
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
          console.log(`   ✨ Creating new user`);
          
          await fetch(
            `https://tables-api.softr.io/api/v1/databases/${process.env.SOFTR_DATABASE_ID}/tables/${STAFF_TABLE_ID}/records`,
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
        console.error(`   ❌ Error processing ${user.FirstName} ${user.LastName}:`, error.message);
        errorCount++;
        errors.push({
          user: `${user.FirstName} ${user.LastName}`,
          error: error.message
        });
      }
    }

    console.log('\n═══════════════════════════════════════');
    console.log('✅ STAFF SYNC COMPLETE');
    console.log(`   Total: ${users.length}`);
    console.log(`   Created: ${createdCount}`);
    console.log(`   Updated: ${updatedCount}`);
    console.log(`   Errors: ${errorCount}`);
    console.log('═══════════════════════════════════════');

    return res.status(200).json({
      success: true,
      summary: {
        total: users.length,
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
      error: error.message
    });
  }
}
