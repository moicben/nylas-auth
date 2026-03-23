const { resolveAccountFromQuery } = require("../nylas-credentials");
const { getQueryValue } = require("../request-query");

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "DELETE") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const resolved = await resolveAccountFromQuery(req);
  if (resolved.error) {
    return res.status(resolved.status || 500).json({ error: resolved.error });
  }
  const { apiKey } = resolved;

  const apiUrl = process.env.NYLAS_API_URL || "https://api.eu.nylas.com";
  if (req.method === "DELETE") {
    const grantId = getQueryValue(req, "grantId").trim();
    if (!grantId) {
      return res.status(400).json({ error: "grantId is required" });
    }
    const deleteUrl = `${apiUrl}/v3/grants/${encodeURIComponent(grantId)}`;
    try {
      const upstream = await fetch(deleteUrl, {
        method: "DELETE",
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
          error: "Nylas grant deletion failed",
          details: payload
        });
      }
      return res.status(200).json({
        ok: true,
        grantId,
        data: payload
      });
    } catch (error) {
      return res.status(502).json({
        error: "Unable to reach Nylas API",
        details: error && error.message ? error.message : "Unknown error"
      });
    }
  } 

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
    const visibleGrants = rawList
      .filter((grant) =>
        ["valid", "revoked", "invalid"].includes(String(grant?.grant_status || "").toLowerCase())
      )
      .map((grant) => ({
        id: grant.id,
        provider: grant.provider || "unknown",
        email: grant.email || null,
        grantStatus: grant.grant_status,
        displayName: grant.email || grant.name || grant.id
      }));

    return res.status(200).json({
      data: visibleGrants
    });
  } catch (error) {
    return res.status(502).json({
      error: "Unable to reach Nylas API",
      details: error && error.message ? error.message : "Unknown error"
    });
  }
};
