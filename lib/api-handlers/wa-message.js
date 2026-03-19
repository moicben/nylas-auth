const { requireEvolutionCredentials } = require("../evolution-env");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  /** Evolution accepts DELETE; certains proxies ont des soucis -> POST action=delete accepté aussi. */
  const isDelete =
    req.method === "DELETE" ||
    (req.method === "POST" && req.body && req.body.action === "delete");

  if (!isDelete) {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const remoteJid = typeof body.remoteJid === "string" ? body.remoteJid.trim() : "";
  const fromMe = Boolean(body.fromMe);
  const participant =
    typeof body.participant === "string" ? body.participant.trim() : "";

  if (!id || !remoteJid) {
    return res.status(400).json({ error: "id and remoteJid are required" });
  }

  const instance =
    typeof body.instance === "string" ? body.instance.trim() : "";
  if (!instance) {
    return res.status(400).json({ error: "instance is required in JSON body (Evolution instance name)" });
  }

  const creds = requireEvolutionCredentials(res);
  if (!creds) return;
  const { base, apiKey } = creds;

  const url = `${base}/chat/deleteMessageForEveryone/${encodeURIComponent(instance)}`;
  const evolutionBody = JSON.stringify({
    id,
    remoteJid,
    fromMe,
    participant
  });

  try {
    const upstream = await fetch(url, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        apikey: apiKey
      },
      body: evolutionBody
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
        error: "Evolution API delete failed",
        details: payload
      });
    }

    return res.status(200).json({
      ok: true,
      data: { id, remoteJid },
      details: payload
    });
  } catch (error) {
    return res.status(502).json({
      error: "Unable to reach Evolution API",
      details: error && error.message ? error.message : "Unknown error"
    });
  }
};
