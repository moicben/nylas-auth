const { requireEvolutionCredentials } = require("../evolution-env");

function unwrapRawList(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  if (payload.instance && typeof payload.instance === "object") return [payload.instance];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.instances)) return payload.instances;
  if (Array.isArray(payload.response)) return payload.response;
  const resp = payload.response;
  if (resp && typeof resp === "object" && Array.isArray(resp.data)) return resp.data;
  const msg = resp?.message;
  if (Array.isArray(msg)) return msg;
  return [];
}

function extractRow(item) { 
  const inner = item && typeof item === "object" && item.instance ? item.instance : item;
  if (!inner || typeof inner !== "object") return null;
  const name =
    (typeof inner.instanceName === "string" && inner.instanceName.trim()) ||
    (typeof inner.name === "string" && inner.name.trim()) ||
    "";
  if (!name) return null;
  const statusRaw =
    inner.status ??
    inner.state ??
    inner.connectionStatus ??
    inner.Instance?.status ??
    "";
  const status = typeof statusRaw === "string" ? statusRaw.trim() : String(statusRaw || "");
  const profileName =
    typeof inner.profileName === "string" && inner.profileName.trim() ? inner.profileName.trim() : "";
  const instanceId =
    typeof inner.instanceId === "string" && inner.instanceId.trim() ? inner.instanceId.trim() : "";
  return { name, status: status || "unknown", profileName, instanceId };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const creds = requireEvolutionCredentials(res);
  if (!creds) return;

  const { base, apiKey } = creds;
  const url = `${base}/instance/fetchInstances`;

  try {
    const upstream = await fetch(url, {
      method: "GET",
      headers: {
        apikey: apiKey
      }
    });

    const text = await upstream.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch (_e) {
      payload = { raw: text };
    }

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: "Evolution API request failed",
        details: payload
      });
    }

    const rows = unwrapRawList(payload)
      .map(extractRow)
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));

    return res.status(200).json({
      data: rows
    });
  } catch (error) {
    return res.status(502).json({
      error: "Unable to reach Evolution API",
      details: error && error.message ? error.message : "Unknown error"
    });
  }
};
