const { requireEvolutionCredentials, queryInstanceName } = require("../evolution-env");

const DEFAULT_PAGE_SIZE = 100;
const MAX_MESSAGES_CAP = 5000;
const MAX_PAGES = 60;

/** Evolution renvoie souvent { messages: { total, pages, records: [...] } } ou enveloppe response */
function unwrapMessages(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  const inner = payload.response && typeof payload.response === "object" ? payload.response : payload;

  const msgBlock = inner.messages;
  if (msgBlock && typeof msgBlock === "object" && Array.isArray(msgBlock.records)) {
    return msgBlock.records;
  }
  if (Array.isArray(inner.messages)) return inner.messages;
  if (Array.isArray(payload.messages)) return payload.messages;
  if (Array.isArray(inner.data)) return inner.data;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(inner.records)) return inner.records;
  if (Array.isArray(payload.records)) return payload.records;
  return [];
}

function getMessagesMeta(payload) {
  const inner = payload?.response && typeof payload.response === "object" ? payload.response : payload;
  const block = inner?.messages;
  if (!block || typeof block !== "object") return { total: null, pages: null };
  const total = Number(block.total);
  const pages = Number(block.pages);
  return {
    total: Number.isFinite(total) ? total : null,
    pages: Number.isFinite(pages) ? pages : null
  };
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

function parseLimitQuery(req) {
  const raw = req.query && req.query.limit;
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(n) || n < 1) return MAX_MESSAGES_CAP;
  return Math.min(Math.floor(n), MAX_MESSAGES_CAP);
}

function normalizeRows(rawList, remoteJid) {
  return rawList
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
}

async function fetchFindMessagesOnce(url, apiKey, remoteJid, page, pageSize) {
  const body = {
    where: {
      key: {
        remoteJid
      }
    },
    offset: pageSize,
    page
  };

  const upstream = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey
    },
    body: JSON.stringify(body)
  });

  const text = await upstream.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (_e) {
    payload = { raw: text };
  }

  return { upstream, payload };
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
  const maxTotal = parseLimitQuery(req);
  const pageSize = Math.min(DEFAULT_PAGE_SIZE, maxTotal);

  try {
    const mergedById = new Map();
    let meta = { total: null, pages: null };

    for (let page = 1; page <= MAX_PAGES && mergedById.size < maxTotal; page += 1) {
      const sizeBefore = mergedById.size;
      const { upstream, payload } = await fetchFindMessagesOnce(url, apiKey, remoteJid, page, pageSize);

      if (!upstream.ok) {
        if (page === 1) {
          return res.status(upstream.status).json({
            error: "Evolution API request failed",
            details: payload
          });
        }
        break;
      }

      if (page === 1) {
        meta = getMessagesMeta(payload);
      }

      const batch = unwrapMessages(payload);
      if (!batch.length) {
        break;
      }

      for (const row of batch) {
        const key = row.key && typeof row.key === "object" ? row.key : {};
        const id = typeof key.id === "string" ? key.id : "";
        if (id && !mergedById.has(id)) {
          mergedById.set(id, row);
        }
      }

      if (mergedById.size === sizeBefore) {
        break;
      }

      if (batch.length < pageSize) {
        break;
      }

      if (meta.pages != null && page >= meta.pages) {
        break;
      }
    }

    const rawList = Array.from(mergedById.values());
    const normalized = normalizeRows(rawList, remoteJid).slice(-maxTotal);

    return res.status(200).json({
      data: normalized,
      remoteJid,
      instance,
      stats: {
        count: normalized.length,
        maxRequested: maxTotal
      }
    });
  } catch (error) {
    return res.status(502).json({
      error: "Unable to reach Evolution API",
      details: error && error.message ? error.message : "Unknown error"
    });
  }
};
