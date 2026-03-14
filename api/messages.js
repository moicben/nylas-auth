module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const grantId = typeof req.query.grantId === "string" ? req.query.grantId.trim() : "";
  const limitRaw = typeof req.query.limit === "string" ? req.query.limit : "5";
  const limit = Math.min(Math.max(Number.parseInt(limitRaw, 10) || 5, 1), 20);

  if (!grantId) {
    return res.status(400).json({ error: "grantId is required" });
  }

  const apiKey = process.env.NYLAS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Missing NYLAS_API_KEY environment variable" });
  }

  const apiUrl = process.env.NYLAS_API_URL || "https://api.eu.nylas.com";
  const url = `${apiUrl}/v3/grants/${encodeURIComponent(grantId)}/messages?limit=${limit}`;

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

    return res.status(200).json(payload);
  } catch (error) {
    return res.status(502).json({
      error: "Unable to reach Nylas API",
      details: error && error.message ? error.message : "Unknown error"
    });
  }
};
