const { requireEvolutionCredentials, queryInstanceName } = require("../evolution-env");

function unwrapList(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.chats)) return payload.chats;
  if (Array.isArray(payload.records)) return payload.records;
  return [];
}

function chatRemoteJid(chat) {
  if (!chat || typeof chat !== "object") return "";
  const raw =
    chat.remoteJid ||
    chat.remoteJidAlt ||
    chat.id ||
    chat.jid ||
    chat.key?.remoteJid ||
    "";
  return typeof raw === "string" ? raw.trim() : "";
}

function chatDisplayName(chat, remoteJid) {
  if (!chat || typeof chat !== "object") return remoteJid || "Chat";
  const name =
    (typeof chat.name === "string" && chat.name.trim()) ||
    (typeof chat.pushName === "string" && chat.pushName.trim()) ||
    (typeof chat.notify === "string" && chat.notify.trim()) ||
    "";
  if (name) return name;
  const phone = remoteJid.replace(/@.+$/, "").replace(/\D/g, "");
  return phone || remoteJid || "Chat";
}

function lastMessagePreview(chat) {
  const last = chat?.lastMessage && typeof chat.lastMessage === "object" ? chat.lastMessage : null;
  if (!last) {
    const un = Number(chat?.unreadMessages ?? chat?.unreadCount);
    if (Number.isFinite(un) && un > 0) return `${un} non lu(s)`;
    return "";
  }
  const inner = last.message && typeof last.message === "object" ? last.message : last;
  const text =
    (typeof inner.conversation === "string" && inner.conversation) ||
    (typeof inner.extendedTextMessage?.text === "string" && inner.extendedTextMessage.text) ||
    "";
  if (text) return text.slice(0, 160);
  const type = typeof last.messageStubType === "string" ? last.messageStubType : "";
  return type || "Message";
}

function lastTimestamp(chat) {
  const ts = Number(
    chat?.lastMessageRecvTimestamp ||
      chat?.updatedAt ||
      chat?.timestamp ||
      chat?.lastMessage?.messageTimestamp ||
      chat?.lastMessage?.message?.messageTimestamp
  );
  return Number.isFinite(ts) ? ts : 0;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const instance = queryInstanceName(req);
  if (!instance) {
    return res.status(400).json({ error: "instance query parameter is required (Evolution instance name)" });
  }

  const creds = requireEvolutionCredentials(res);
  if (!creds) return;
  const { base, apiKey } = creds;

  const url = `${base}/chat/findChats/${encodeURIComponent(instance)}`;

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: apiKey
      },
      body: JSON.stringify({})
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

    const list = unwrapList(payload);
    const rows = list
      .map((chat) => {
        const remoteJid = chatRemoteJid(chat);
        if (!remoteJid) return null;
        return {
          id: remoteJid,
          remoteJid,
          subject: chatDisplayName(chat, remoteJid),
          snippet: lastMessagePreview(chat),
          date: lastTimestamp(chat) || null,
          unread: Boolean(Number(chat?.unreadMessages || chat?.unreadCount) > 0)
        };
      })
      .filter(Boolean)
      .sort((a, b) => (Number(b.date) || 0) - (Number(a.date) || 0));

    return res.status(200).json({
      data: rows,
      instance
    });
  } catch (error) {
    return res.status(502).json({
      error: "Unable to reach Evolution API",
      details: error && error.message ? error.message : "Unknown error"
    });
  }
};
