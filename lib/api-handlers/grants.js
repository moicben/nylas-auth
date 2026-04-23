const { getCredentials, buildNylasHeaders } = require("../nylas-credentials");
const { getQueryValue } = require("../request-query");

function mapNylasGrant(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" ? raw.id : "";
  if (!id) return null;
  const email = typeof raw.email === "string" ? raw.email : "";
  return {
    id,
    displayName: email || id,
    email,
    provider: typeof raw.provider === "string" ? raw.provider : "provider",
    grantStatus: typeof raw.grant_status === "string" ? raw.grant_status : "unknown",
    createdAt: raw.created_at ?? null,
    updatedAt: raw.updated_at ?? null
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "DELETE") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  let creds;
  try {
    creds = getCredentials();
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Missing Nylas credentials" });
  }
  const { apiKey, apiUrl } = creds;

  if (req.method === "DELETE") {
    const grantId = getQueryValue(req, "grantId").trim();
    if (!grantId) {
      return res.status(400).json({ error: "grantId is required" });
    }
    try {
      const upstream = await fetch(`${apiUrl}/v3/grants/${encodeURIComponent(grantId)}`, {
        method: "DELETE",
        headers: buildNylasHeaders(apiKey)
      });
      const text = await upstream.text();
      let payload;
      try { payload = text ? JSON.parse(text) : {}; } catch (_e) { payload = { raw: text }; }
      if (!upstream.ok) {
        return res.status(upstream.status).json({ error: "Nylas grant deletion failed", details: payload });
      }
      return res.status(200).json({ ok: true, grantId, data: payload });
    } catch (error) {
      return res.status(502).json({
        error: "Unable to reach Nylas API",
        details: error?.message || "Unknown error"
      });
    }
  }

  try {
    const limit = Math.min(Math.max(Number.parseInt(getQueryValue(req, "limit"), 10) || 200, 1), 200);
    const upstream = await fetch(`${apiUrl}/v3/grants?limit=${limit}`, {
      headers: buildNylasHeaders(apiKey)
    });
    const text = await upstream.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; } catch (_e) { payload = { raw: text }; }
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: "Nylas grants listing failed", details: payload });
    }
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const grants = rows
      .map(mapNylasGrant)
      .filter(Boolean)
      .filter((g) => ["valid", "revoked", "invalid"].includes(String(g.grantStatus).toLowerCase()));
    return res.status(200).json({ source: "nylas", data: grants });
  } catch (error) {
    return res.status(502).json({
      error: "Unable to reach Nylas API",
      details: error?.message || "Unknown error"
    });
  }
};
