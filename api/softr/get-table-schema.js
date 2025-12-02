export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Security
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const tableId = req.query.tableId || process.env.SOFTR_CUSTOMERS_TABLE_ID;
    
    console.log('📋 Fetching schema for table:', tableId);

    // Get table schema
    const response = await fetch(
      `https://tables-api.softr.io/api/v1/databases/${process.env.SOFTR_DATABASE_ID}/tables/${tableId}`,
      {
        headers: {
          'Softr-Api-Key': process.env.SOFTR_API_KEY
        }
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Softr API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const fields = data.data.fields || [];
    
    // Create readable mapping
    const mapping = {};
    const fieldDetails = [];
    
    fields.forEach(field => {
      mapping[field.name] = field.id;
      fieldDetails.push({
        name: field.name,
        id: field.id,
        type: field.type
      });
    });

    console.log('✅ Schema fetched successfully');

    return res.status(200).json({
      success: true,
      tableName: data.data.name,
      tableId: tableId,
      databaseId: process.env.SOFTR_DATABASE_ID,
      fieldMapping: mapping,
      fieldDetails: fieldDetails,
      totalFields: fields.length
    });

  } catch (error) {
    console.error('❌ Error:', error);
    return res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
}
