const { getSupabaseClientConfig } = require("../supabase-accounts");
const { getQueryValue } = require("../request-query");

function buildSupabaseHeaders(authKey) {
  return {
    apikey: authKey,
    Authorization: `Bearer ${authKey}`
  };
}

async function parseSupabaseResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return text;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const grantId = getQueryValue(req, "grantId").trim();
  if (!grantId) {
    return res.status(400).json({ error: "grantId is required" });
  }

  try {
    const { baseUrl, authKey } = getSupabaseClientConfig();
    const select = encodeURIComponent(
      "id,grant_id,email,display_name,provider,grant_status,nylas_created_at,synced_at,deleted_at,revoked_at,phone,tag,details"
    );
    const url = `${baseUrl}/rest/v1/grants?select=${select}&grant_id=eq.${encodeURIComponent(grantId)}&limit=1`;
    const response = await fetch(url, { headers: buildSupabaseHeaders(authKey) });
    const payload = await parseSupabaseResponse(response);
    if (!response.ok) {
      return res.status(response.status).json({
        error: "Supabase grant-details query failed",
        details: typeof payload === "string" ? payload : payload || null
      });
    }
    const rows = Array.isArray(payload) ? payload : [];
    if (!rows.length) {
      return res.status(404).json({ error: "grant not found", grantId });
    }
    return res.status(200).json({ ok: true, grant: rows[0] });
  } catch (error) {
    return res.status(500).json({
      error: "Unable to load grant details",
      details: error?.message || "Unknown error"
    });
  }
};
