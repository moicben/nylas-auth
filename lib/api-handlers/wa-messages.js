const { requireEvolutionCredentials, queryInstanceName } = require("../evolution-env");

function unwrapMessages(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.messages)) return payload.messages;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.records)) return payload.records;
  return [];
}

function messageText(m) {
  if (!m || typeof m !== "object") return "";
  const msg = m.message && typeof m.message === "object" ? m.message : m;
  if (typeof msg.conversation === "string" && msg.conversation.trim()) return msg.conversation.trim();
  if (typeof msg.extendedTextMessage?.text === "string" && msg.extendedTextMessage.text.trim()) {
    return msg.extendedTextMessage.text.trim();
  }
  if (typeof msg.imageMessage?.caption === "string" && msg.imageMessage.caption.trim()) {
    return `[Image] ${msg.imageMessage.caption.trim()}`;
  }
  if (typeof msg.videoMessage?.caption === "string" && msg.videoMessage.caption.trim()) {
    return `[Video] ${msg.videoMessage.caption.trim()}`;
  }
  if (msg.imageMessage) return "[Image]";
  if (msg.audioMessage) return "[Audio]";
  if (msg.videoMessage) return "[Video]";
  if (msg.documentMessage) return "[Document]";
  if (msg.stickerMessage) return "[Sticker]";
  if (msg.contactMessage) return "[Contact]";
  if (msg.locationMessage) return "[Localisation]";
  return "";
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const remoteJid = typeof req.query.remoteJid === "string" ? req.query.remoteJid.trim() : "";
  if (!remoteJid) {
    return res.status(400).json({ error: "remoteJid is required" });
  }

  const instance = queryInstanceName(req);
  if (!instance) {
    return res.status(400).json({ error: "instance query parameter is required (Evolution instance name)" });
  }

  const creds = requireEvolutionCredentials(res);
  if (!creds) return;
  const { base, apiKey } = creds;

  const url = `${base}/chat/findMessages/${encodeURIComponent(instance)}`;

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: apiKey
      },
      body: JSON.stringify({
        where: {
          key: {
            remoteJid
          }
        }
      })
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

    const rawList = unwrapMessages(payload);
    const normalized = rawList
      .map((row) => {
        const key = row.key && typeof row.key === "object" ? row.key : {};
        const id = typeof key.id === "string" ? key.id : "";
        if (!id) return null;
        const fromMe = Boolean(key.fromMe);
        const jid = typeof key.remoteJid === "string" ? key.remoteJid : remoteJid;
        const ts = Number(row.messageTimestamp || row.timestamp);
        const bodyText = messageText(row);
        return {
          id,
          remoteJid: jid,
          fromMe,
          date: Number.isFinite(ts) ? ts : null,
          bodyText: bodyText || "(Message sans texte)",
          wa: true
        };
      })
      .filter(Boolean)
      .sort((a, b) => (Number(a.date) || 0) - (Number(b.date) || 0));

    return res.status(200).json({
      data: normalized,
      remoteJid,
      instance
    });
  } catch (error) {
    return res.status(502).json({
      error: "Unable to reach Evolution API",
      details: error && error.message ? error.message : "Unknown error"
    });
  }
};
