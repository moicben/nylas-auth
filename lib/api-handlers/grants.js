const { resolveAccountFromQuery } = require("../nylas-credentials");
const { getQueryValue } = require("../request-query");
const {
  listSupabaseGrantsByAccountId,
  mapSupabaseGrantForApi,
  softDeleteSupabaseGrant,
  updateGrantTag
} = require("../supabase-grants");

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "DELETE" && req.method !== "PATCH") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const resolved = await resolveAccountFromQuery(req);
  if (resolved.error) {
    return res.status(resolved.status || 500).json({ error: resolved.error });
  }
  const { apiKey, accountId } = resolved;

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
      if (Number.isFinite(Number(accountId)) && accountId > 0) {
        try {
          await softDeleteSupabaseGrant({
            accountId,
            grantId,
            grantStatus: "deleted_on_nylas"
          });
        } catch (_syncError) {
          // Non bloquant: la suppression provider est deja appliquee.
        }
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

  if (req.method === "PATCH") {
    const body = typeof req.body === "object" ? req.body : {};
    const grantId = typeof body?.grantId === "string" ? body.grantId.trim() : "";
    const tag = typeof body?.tag === "string" ? body.tag.trim() : "";
    if (!grantId) {
      return res.status(400).json({ error: "grantId is required" });
    }
    if (!tag) {
      return res.status(400).json({ error: "tag is required" });
    }
    try {
      await updateGrantTag(grantId, tag);
      return res.status(200).json({ ok: true, grantId, tag });
    } catch (error) {
      return res.status(500).json({ error: error?.message || "Tag update failed" });
    }
  }

  try {
    if (!Number.isFinite(Number(accountId)) || accountId < 1) {
      return res.status(400).json({ error: "Invalid account mapping for grants source" });
    }
    const rows = await listSupabaseGrantsByAccountId(accountId);
    const visibleGrants = rows
      .map(mapSupabaseGrantForApi)
      .filter((grant) =>
        ["valid", "revoked", "invalid"].includes(String(grant?.grantStatus || "").toLowerCase())
      );

    return res.status(200).json({
      source: "supabase",
      data: visibleGrants
    });
  } catch (error) {
    return res.status(500).json({
      error: "Unable to load grants from Supabase",
      details: error?.message || "Unknown error"
    });
  }
};
