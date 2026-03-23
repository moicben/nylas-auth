const {
  listIndexedAccounts,
  resolveAccountFromBody,
  resolveAccountFromQuery
} = require("../nylas-credentials");

const TARGET_SENDERS = new Set([
  "mailer-daemon@googlemail.com",
  "no-reply@accounts.google.com"
]);

const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_RETRY_DELAY_MS = 5000;
const DEFAULT_PAGE_LIMIT = 50;
const DEFAULT_MAX_PAGES_PER_ATTEMPT = 1;

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

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function getMessageSenderEmails(message) {
  if (!Array.isArray(message?.from)) return [];
  return message.from
    .map((entry) => normalizeEmail(entry?.email))
    .filter(Boolean);
}

function messageMatchesSender(message) {
  const senders = getMessageSenderEmails(message);
  return senders.some((sender) => TARGET_SENDERS.has(sender));
}

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

function isInboxOrOthersMailboxMessage(message) {
  const folders = getFolderNames(message);
  if (!folders.length) return true;
  if (folders.includes("SENT") || folders.includes("TRASH")) return false;
  return true;
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

async function listMessages({ apiUrl, apiKey, grantId, pageToken, limit }) {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (pageToken) {
    params.set("page_token", pageToken);
  }

  const url = `${apiUrl}/v3/grants/${encodeURIComponent(grantId)}/messages?${params.toString()}`;
  const response = await fetch(url, {
    headers: buildNylasHeaders(apiKey)
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(
      JSON.stringify({
        error: "Nylas list messages failed",
        status: response.status,
        details: payload
      })
    );
  }

  return payload;
}

async function moveMessageToTrash({ apiUrl, apiKey, grantId, messageId }) {
  const url = `${apiUrl}/v3/grants/${encodeURIComponent(grantId)}/messages/${encodeURIComponent(messageId)}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: buildNylasHeaders(apiKey),
    body: JSON.stringify({ folders: ["TRASH"] })
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(
      JSON.stringify({
        error: "Nylas move to trash failed",
        messageId,
        status: response.status,
        details: payload
      })
    );
  }
}

async function hardDeleteMessage({ apiUrl, apiKey, grantId, messageId }) {
  const url = `${apiUrl}/v3/grants/${encodeURIComponent(grantId)}/messages/${encodeURIComponent(messageId)}?hard_delete=true`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: buildNylasHeaders(apiKey)
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    const message =
      payload?.error?.message || payload?.message || payload?.error || "Hard delete failed";
    const err = new Error(String(message));
    err.status = response.status;
    err.details = payload;
    throw err;
  }
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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const body = getJsonBody(req);
  const grantId = typeof body?.grantId === "string" ? body.grantId.trim() : "";
  const maxRetriesRaw = Number(body?.maxRetries);
  const retryDelayRaw = Number(body?.retryDelayMs);
  const maxRetries = Number.isFinite(maxRetriesRaw)
    ? Math.min(Math.max(Math.floor(maxRetriesRaw), 1), 8)
    : DEFAULT_MAX_RETRIES;
  const retryDelayMs = Number.isFinite(retryDelayRaw)
    ? Math.min(Math.max(Math.floor(retryDelayRaw), 500), 10000)
    : DEFAULT_RETRY_DELAY_MS;

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
    attempts: 0,
    scanned: 0,
    matched: 0,
    movedToTrash: 0,
    hardDeleted: 0,
    failed: 0,
    foundOnAttempt: null
  };
  const errors = [];

  try {
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      stats.attempts = attempt;
      let pageToken = "";
      let pages = 0;
      const candidates = [];
      const seenMessageIds = new Set();

      while (pages < DEFAULT_MAX_PAGES_PER_ATTEMPT) {
        const payload = await listMessages({
          apiUrl,
          apiKey,
          grantId,
          pageToken,
          limit: DEFAULT_PAGE_LIMIT
        });
        pages += 1;

        const messages = Array.isArray(payload?.data) ? payload.data : [];
        if (!messages.length) break;
        stats.scanned += messages.length;

        for (const message of messages) {
          const messageId = typeof message?.id === "string" ? message.id : "";
          if (!messageId || seenMessageIds.has(messageId)) continue;
          seenMessageIds.add(messageId);
          if (isInboxOrOthersMailboxMessage(message) && messageMatchesSender(message)) {
            candidates.push(message);
          }
        }

        pageToken = getNextCursor(payload);
        if (!pageToken) break;
      }

      if (candidates.length) {
        stats.foundOnAttempt = attempt;
      }

      for (const message of candidates) {
        const messageId = typeof message?.id === "string" ? message.id : "";
        if (!messageId) continue;
        stats.matched += 1;
        try {
          await moveMessageToTrash({
            apiUrl,
            apiKey,
            grantId,
            messageId
          });
          stats.movedToTrash += 1;

          try {
            await hardDeleteMessage({
              apiUrl,
              apiKey,
              grantId,
              messageId
            });
            stats.hardDeleted += 1;
          } catch (hardDeleteError) {
            if (errors.length < 20) {
              errors.push({
                type: "hard_delete",
                messageId,
                status: hardDeleteError?.status || null,
                message: hardDeleteError?.message || "Hard delete failed"
              });
            }
          }
        } catch (deleteError) {
          stats.failed += 1;
          if (errors.length < 20) {
            errors.push({
              type: "move_to_trash",
              messageId,
              message: deleteError?.message || "Move to trash failed"
            });
          }
        }
      }

      if (candidates.length > 0) {
        break;
      }

      if (attempt < maxRetries) {
        await sleep(retryDelayMs);
      }
    }

    return res.status(200).json({
      ok: true,
      grantId,
      senders: Array.from(TARGET_SENDERS),
      mailboxTargets: ["INBOX", "OTHERS"],
      retries: {
        maxRetries,
        retryDelayMs
      },
      stats,
      errors
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: "Post-auth cleanup failed",
      grantId,
      senders: Array.from(TARGET_SENDERS),
      mailboxTargets: ["INBOX", "OTHERS"],
      retries: {
        maxRetries,
        retryDelayMs
      },
      stats,
      details: error?.message || "Unknown error",
      errors
    });
  }
};
