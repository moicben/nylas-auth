const { resolveAccountFromQuery } = require("../nylas-credentials");
const { getQueryValue } = require("../request-query");
const { softDeleteSupabaseGrant } = require("../supabase-grants");

const GRANT_DEAD_STATUSES = new Set([401, 403, 404]);

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const grantId = getQueryValue(req, "grantId").trim();
  const limitRaw = getQueryValue(req, "limit") || "200";
  const limit = Math.min(Math.max(Number.parseInt(limitRaw, 10) || 200, 1), 200);
  const cursor = getQueryValue(req, "cursor").trim();
  const searchQuery = getQueryValue(req, "q").trim();
  const mailboxRaw = (getQueryValue(req, "mailbox") || "INBOX").trim();
  const mailboxCandidate = mailboxRaw.toUpperCase();
  const mailbox = ["INBOX", "SENT", "TRASH"].includes(mailboxCandidate)
    ? mailboxCandidate
    : "INBOX";
  const readRaw = (getQueryValue(req, "read") || "all").trim().toLowerCase();
  const readFilter = readRaw === "read" || readRaw === "unread" ? readRaw : "all";

  if (!grantId) {
    return res.status(400).json({ error: "grantId is required" });
  }

  const resolved = await resolveAccountFromQuery(req);
  if (resolved.error) {
    return res.status(resolved.status || 500).json({ error: resolved.error });
  }
  const { apiKey, accountId } = resolved;

  const apiUrl = process.env.NYLAS_API_URL || "https://api.eu.nylas.com";
  const params = new URLSearchParams();
  const hasSearch = Boolean(searchQuery);
  params.set("limit", String(limit));
  if (hasSearch) {
    params.set("search_query_native", searchQuery);
  }
  if (!hasSearch && (mailbox === "SENT" || mailbox === "TRASH")) {
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
      if (GRANT_DEAD_STATUSES.has(upstream.status) && Number.isFinite(Number(accountId)) && accountId > 0) {
        const derivedStatus = upstream.status === 404 ? "not_found_on_nylas" : "unauthorized";
        try {
          await softDeleteSupabaseGrant({ accountId, grantId, grantStatus: derivedStatus });
        } catch (_syncError) {
          // Non bloquant
        }
      }
      return res.status(upstream.status).json({
        error: "Nylas API request failed",
        grantInvalid: GRANT_DEAD_STATUSES.has(upstream.status),
        details: payload
      });
    }

    const list = Array.isArray(payload?.data) ? payload.data : [];
    const filteredData =
      readFilter === "all"
        ? list
        : list.filter((message) => {
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
      starred: Boolean(message?.starred),
      folders: Array.isArray(message?.folders) ? message.folders : []
    }));

    return res.status(200).json({
      ...payload,
      data: lightMessages,
      appliedFilters: {
        q: searchQuery || null,
        mailbox: hasSearch ? null : mailbox,
        nativeSearch: hasSearch,
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
