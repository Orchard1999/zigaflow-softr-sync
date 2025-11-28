export default async function handler(req, res) {
  try {
    //
    // -----------------------
    // 1. FETCH CLIENTS
    // -----------------------
    //
    const clientsRes = await fetch(`${process.env.ZIG_BASE_URL}/Clients`, {
      headers: {
        "apikey": process.env.ZIG_API_KEY,
        "Content-Type": "application/json"
      }
    });

    const clients = await clientsRes.json();

    //
    // -----------------------
    // 2. FETCH CLIENT TAGS
    // -----------------------
    //
    const tagsRes = await fetch(`${process.env.ZIG_BASE_URL}/ClientTags`, {
      headers: {
        "apikey": process.env.ZIG_API_KEY,
        "Content-Type": "application/json"
      }
    });

    const tags = await tagsRes.json();

    // Map: clientId → [tags]
    const clientTags = {};
    for (const tag of tags) {
      if (!clientTags[tag.ClientId]) clientTags[tag.ClientId] = [];
      clientTags[tag.ClientId].push(tag.Tag);
    }

    // Build client map: company name → details
    const clientMap = {};
    for (const c of clients) {
      clientMap[c.Name] = {
        zig_client_id: c.Id,
        price_list: c.PriceListName || c.PriceListId || "",
        tags: clientTags[c.Id] || []
      };
    }

    //
    // -----------------------
    // 3. FETCH CONTACTS
    // -----------------------
    //
    const contactsRes = await fetch(`${process.env.ZIG_BASE_URL}/Contacts`, {
      headers: {
        "apikey": process.env.ZIG_API_KEY,
        "Content-Type": "application/json"
      }
    });

    const contacts = await contactsRes.json();

    //
    // -----------------------
    // 4. UPSERT INTO SOFTR
    // -----------------------
    //
    for (const c of contacts) {
      if (!c.Email) continue;

      const company = c.Customer;
      const companyData = clientMap[company] || {};

      // Convert tags array → "tag1, tag2, tag3"
      const rawTags = Array.isArray(companyData.tags)
        ? companyData.tags
        : companyData.tags
        ? [companyData.tags]
        : [];

      const tagString = rawTags.join(", ");

      const payload = {
