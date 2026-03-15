const { upsertEmails } = require("./_supabase");

const MAX_LIMIT = 200;
const UPSERT_BATCH_SIZE = 100;
const DETAIL_CONCURRENCY = 10;
const DEFAULT_MAX_PAGES = 100;
const DEFAULT_MAX_MESSAGES = 20000;

function stripHtml(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEscapedNewlines(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toIsoDate(value) {
  if (value == null || value === "") return null;
  const numberValue = Number(value);
  const date = Number.isFinite(numberValue) ? new Date(numberValue * 1000) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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

function extractGrantId(input) {
  if (!input || typeof input !== "object") return "";
  const id = input.grantId || input.grant_id;
  return typeof id === "string" ? id.trim() : "";
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

async function parseResponseJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_error) {
    return { raw: text };
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const output = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      output[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);
  return output;
}

function buildNylasHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

async function fetchMessageList({ apiUrl, apiKey, grantId, pageToken, receivedAfter }) {
  const params = new URLSearchParams();
  params.set("limit", String(MAX_LIMIT));
  params.set("in", "INBOX");
  params.set("received_after", String(receivedAfter));
  if (pageToken) {
    params.set("page_token", pageToken);
  }
  const url = `${apiUrl}/v3/grants/${encodeURIComponent(grantId)}/messages?${params.toString()}`;
  const response = await fetch(url, {
    headers: buildNylasHeaders(apiKey)
  });
  const payload = await parseResponseJson(response);
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

async function fetchMessageDetail({ apiUrl, apiKey, grantId, messageId }) {
  const params = new URLSearchParams();
  params.set("fields", "include_headers");
  const url = `${apiUrl}/v3/grants/${encodeURIComponent(grantId)}/messages/${encodeURIComponent(messageId)}?${params.toString()}`;
  const response = await fetch(url, {
    headers: buildNylasHeaders(apiKey)
  });
  const payload = await parseResponseJson(response);
  if (!response.ok) {
    throw new Error(
      JSON.stringify({
        error: "Nylas message detail failed",
        messageId,
        status: response.status,
        details: payload
      })
    );
  }
  if (payload && typeof payload === "object" && payload.data && typeof payload.data === "object") {
    return payload.data;
  }
  return payload;
}

function mapMessageToRow(message, grantId, nowIso) {
  const htmlBody = typeof message?.body === "string" ? message.body : "";
  const plainBody = typeof message?.body_plain === "string" ? message.body_plain : "";
  const bodyText = normalizeEscapedNewlines(plainBody || stripHtml(htmlBody));
  const attachments = asArray(message?.attachments);
  const folders = asArray(message?.folders);

  return {
    grant_id: grantId,
    nylas_message_id: String(message?.id || ""),
    thread_id: typeof message?.thread_id === "string" ? message.thread_id : null,
    provider: typeof message?.provider === "string" ? message.provider : null,
    subject: typeof message?.subject === "string" ? message.subject : null,
    snippet: typeof message?.snippet === "string" ? message.snippet : null,
    body_text: bodyText || null,
    body_html: htmlBody || null,
    from_addresses: asArray(message?.from),
    to_addresses: asArray(message?.to),
    cc_addresses: asArray(message?.cc),
    bcc_addresses: asArray(message?.bcc),
    reply_to_addresses: asArray(message?.reply_to),
    unread: Boolean(message?.unread),
    starred: Boolean(message?.starred),
    has_attachments: attachments.length > 0 || Boolean(message?.has_attachments),
    folders,
    message_date: toIsoDate(message?.date),
    received_at: toIsoDate(message?.received_at || message?.date),
    headers: message?.headers && typeof message.headers === "object" ? message.headers : null,
    metadata: message?.metadata && typeof message.metadata === "object" ? message.metadata : null,
    nylas_raw: message,
    updated_at: nowIso
  };
}

function splitIntoChunks(list, size) {
  const chunks = [];
  for (let i = 0; i < list.length; i += size) {
    chunks.push(list.slice(i, i + size));
  }
  return chunks;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const body = getJsonBody(req);
  const grantId = extractGrantId(body) || extractGrantId(req.query);
  if (!grantId) {
    return res.status(400).json({ error: "grantId is required" });
  }

  const apiKey = process.env.NYLAS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Missing NYLAS_API_KEY environment variable" });
  }

  const apiUrl = process.env.NYLAS_API_URL || "https://api.eu.nylas.com";
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const receivedAfter = Math.floor(sixMonthsAgo.getTime() / 1000);
  const maxPages = Math.max(1, Number.parseInt(process.env.SYNC_MAX_PAGES || "", 10) || DEFAULT_MAX_PAGES);
  const maxMessages = Math.max(
    1,
    Number.parseInt(process.env.SYNC_MAX_MESSAGES || "", 10) || DEFAULT_MAX_MESSAGES
  );

  let pageToken = "";
  let pageCount = 0;
  let totalListed = 0;
  let totalProcessed = 0;
  let totalUpserted = 0;
  let inserted = 0;
  let updated = 0;
  let failed = 0;
  const errors = [];

  try {
    while (pageCount < maxPages && totalListed < maxMessages) {
      const payload = await fetchMessageList({
        apiUrl,
        apiKey,
        grantId,
        pageToken,
        receivedAfter
      });
      pageCount += 1;

      const listed = asArray(payload?.data);
      if (!listed.length) {
        pageToken = "";
        break;
      }

      totalListed += listed.length;

      const limitedListed =
        totalListed > maxMessages
          ? listed.slice(0, Math.max(0, maxMessages - (totalListed - listed.length)))
          : listed;

      const details = await mapWithConcurrency(limitedListed, DETAIL_CONCURRENCY, async (message) => {
        const messageId = typeof message?.id === "string" ? message.id : "";
        if (!messageId) return null;
        try {
          const fullMessage = await fetchMessageDetail({
            apiUrl,
            apiKey,
            grantId,
            messageId
          });
          return fullMessage;
        } catch (error) {
          failed += 1;
          if (errors.length < 20) {
            errors.push({
              type: "detail_fetch",
              messageId,
              message: error?.message || "Unknown detail fetch error"
            });
          }
          return null;
        }
      });

      const nowIso = new Date().toISOString();
      const rows = details
        .filter((item) => item && typeof item === "object" && item.id)
        .map((item) => mapMessageToRow(item, grantId, nowIso));

      totalProcessed += rows.length;

      const batches = splitIntoChunks(rows, UPSERT_BATCH_SIZE);
      for (const batch of batches) {
        try {
          const upsertedRows = await upsertEmails(batch);
          totalUpserted += upsertedRows.length || batch.length;
          if (upsertedRows.length) {
            for (const row of upsertedRows) {
              if (row?.created_at && row?.updated_at && row.created_at === row.updated_at) {
                inserted += 1;
              } else {
                updated += 1;
              }
            }
          } else {
            updated += batch.length;
          }
        } catch (error) {
          failed += batch.length;
          if (errors.length < 20) {
            errors.push({
              type: "supabase_upsert",
              message: error?.message || "Unknown upsert error"
            });
          }
        }
      }

      pageToken = getNextCursor(payload);
      if (!pageToken) {
        break;
      }
    }

    const reachedPageLimit = pageCount >= maxPages;
    const reachedMessageLimit = totalListed >= maxMessages;

    return res.status(200).json({
      ok: true,
      grantId,
      window: {
        receivedAfter
      },
      limits: {
        maxPages,
        maxMessages
      },
      stats: {
        pages: pageCount,
        listed: totalListed,
        processed: totalProcessed,
        upserted: totalUpserted,
        inserted,
        updated,
        failed
      },
      truncated: reachedPageLimit || reachedMessageLimit,
      nextCursor: pageToken || null,
      errors
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: "Inbox sync failed",
      grantId,
      stats: {
        pages: pageCount,
        listed: totalListed,
        processed: totalProcessed,
        upserted: totalUpserted,
        inserted,
        updated,
        failed
      },
      details: error?.message || "Unknown error",
      errors
    });
  }
};
