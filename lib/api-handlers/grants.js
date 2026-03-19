module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const apiKey = process.env.INBOX_API_KEY || process.env.NYLAS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Missing INBOX_API_KEY environment variable" });
  }

  const apiUrl = process.env.NYLAS_API_URL || "https://api.eu.nylas.com";
  const url = `${apiUrl}/v3/grants?limit=100`;

  try {
    const upstream = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    });

    const text = await upstream.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch (_error) {
      payload = { raw: text };
    }

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: "Nylas API request failed",
        details: payload
      });
    }

    const rawList = Array.isArray(payload?.data) ? payload.data : [];
    const activeGrants = rawList
      .filter((grant) => grant?.grant_status === "valid")
      .map((grant) => ({
        id: grant.id,
        provider: grant.provider || "unknown",
        email: grant.email || null,
        grantStatus: grant.grant_status,
        displayName: grant.email || grant.name || grant.id
      }));

    return res.status(200).json({
      data: activeGrants
    });
  } catch (error) {
    return res.status(502).json({
      error: "Unable to reach Nylas API",
      details: error && error.message ? error.message : "Unknown error"
    });
  }
};
