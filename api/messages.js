function getFolderNames(message) {
  if (!Array.isArray(message?.folders)) return [];
  return message.folders
    .map((folder) => {
      if (typeof folder === "string") return folder.trim().toUpperCase();
      if (folder && typeof folder === "object") {
        const value =
          typeof folder.name === "string"
            ? folder.name
            : typeof folder.display_name === "string"
              ? folder.display_name
              : typeof folder.id === "string"
                ? folder.id
                : "";
        return value.trim().toUpperCase();
      }
      return "";
    })
    .filter(Boolean);
}

function isOthersMailboxMessage(message) {
  const folders = getFolderNames(message);
  if (!folders.length) return true;
  return !folders.some((folder) => folder === "INBOX" || folder === "SENT" || folder === "TRASH");
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const grantId = typeof req.query.grantId === "string" ? req.query.grantId.trim() : "";
  const limitRaw = typeof req.query.limit === "string" ? req.query.limit : "200";
  const limit = Math.min(Math.max(Number.parseInt(limitRaw, 10) || 200, 1), 200);
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor.trim() : "";
  const subject = typeof req.query.subject === "string" ? req.query.subject.trim() : "";
  const mailboxRaw = typeof req.query.mailbox === "string" ? req.query.mailbox.trim() : "INBOX";
  const mailboxCandidate = mailboxRaw.toUpperCase();
  const mailbox = ["INBOX", "SENT", "TRASH", "OTHERS"].includes(mailboxCandidate)
    ? mailboxCandidate
    : "INBOX";
  const readRaw = typeof req.query.read === "string" ? req.query.read.trim().toLowerCase() : "all";
  const readFilter = readRaw === "read" || readRaw === "unread" ? readRaw : "all";

  if (!grantId) {
    return res.status(400).json({ error: "grantId is required" });
  }

  const apiKey = process.env.NYLAS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Missing NYLAS_API_KEY environment variable" });
  }

  const apiUrl = process.env.NYLAS_API_URL || "https://api.eu.nylas.com";
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (mailbox !== "OTHERS") {
    params.set("in", mailbox);
  }
  if (readFilter === "unread") {
    params.set("unread", "true");
  } else if (readFilter === "read") {
    params.set("unread", "false");
  }
  if (cursor) {
    params.set("page_token", cursor);
  }
  const url = `${apiUrl}/v3/grants/${encodeURIComponent(grantId)}/messages?${params.toString()}`;

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

    const list = Array.isArray(payload?.data) ? payload.data : [];
    const normalizedSubject = subject.toLowerCase();
    const withSubjectFilter = normalizedSubject
      ? list.filter((message) => {
          const value = typeof message?.subject === "string" ? message.subject : "";
          return value.toLowerCase().includes(normalizedSubject);
        })
      : list;
    const withMailboxFilter =
      mailbox === "OTHERS" ? withSubjectFilter.filter(isOthersMailboxMessage) : withSubjectFilter;
    const filteredData =
      readFilter === "all"
        ? withMailboxFilter
        : withMailboxFilter.filter((message) => {
            const unread = Boolean(message?.unread);
            return readFilter === "unread" ? unread : !unread;
          });
    const lightMessages = filteredData.map((message) => ({
      id: message?.id || "",
      subject: message?.subject || "(Sans sujet)",
      from: Array.isArray(message?.from) ? message.from : [],
      to: Array.isArray(message?.to) ? message.to : [],
      date: message?.date || null,
      snippet: typeof message?.snippet === "string" ? message.snippet : "",
      unread: Boolean(message?.unread),
      starred: Boolean(message?.starred)
    }));

    return res.status(200).json({
      ...payload,
      data: lightMessages,
      appliedFilters: {
        subject: subject || null,
        mailbox,
        read: readFilter
      }
    });
  } catch (error) {
    return res.status(502).json({
      error: "Unable to reach Nylas API",
      details: error && error.message ? error.message : "Unknown error"
    });
  }
};
