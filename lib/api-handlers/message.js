const { resolveAccountFromQuery } = require("../nylas-credentials");
const { getQueryValue } = require("../request-query");
const { softDeleteSupabaseGrant } = require("../supabase-grants");

const GRANT_DEAD_STATUSES = new Set([401, 403, 404]);

function stripHtml(html) {
  return html
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

function normalizeAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((attachment) => {
      if (!attachment || typeof attachment !== "object") return null;
      const attachmentId =
        typeof attachment.id === "string" && attachment.id.trim()
          ? attachment.id.trim()
          : typeof attachment.file_id === "string" && attachment.file_id.trim()
            ? attachment.file_id.trim()
            : "";
      const filename =
        typeof attachment.filename === "string" && attachment.filename.trim()
          ? attachment.filename.trim()
          : typeof attachment.name === "string" && attachment.name.trim()
            ? attachment.name.trim()
            : "Fichier sans nom";
      const mimeType =
        typeof attachment.content_type === "string" && attachment.content_type.trim()
          ? attachment.content_type.trim()
          : typeof attachment.mime_type === "string" && attachment.mime_type.trim()
            ? attachment.mime_type.trim()
            : "";
      const size = Number(attachment.size);
      return {
        id: attachmentId,
        filename,
        contentType: mimeType,
        size: Number.isFinite(size) && size >= 0 ? size : null
      };
    })
    .filter(Boolean);
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "DELETE" && req.method !== "PATCH") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const grantId = getQueryValue(req, "grantId").trim();
  const messageId = getQueryValue(req, "messageId").trim();
  if (!grantId || !messageId) {
    return res.status(400).json({ error: "grantId and messageId are required" });
  }

  const resolved = await resolveAccountFromQuery(req);
  if (resolved.error) {
    return res.status(resolved.status || 500).json({ error: resolved.error });
  }
  const { apiKey, accountId } = resolved;

  const apiUrl = process.env.NYLAS_API_URL || "https://api.eu.nylas.com";
  const baseUrl = `${apiUrl}/v3/grants/${encodeURIComponent(grantId)}/messages/${encodeURIComponent(messageId)}`;
  const url =
    req.method === "DELETE" ? `${baseUrl}?hard_delete=true` : baseUrl;
  try {
    let requestBody;
    if (req.method === "PATCH") {
      const msgResp = await fetch(baseUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }
      });
      let currentFolders = ["TRASH"];
      if (msgResp.ok) {
        const msgJson = await msgResp.json().catch(() => ({}));
        const src = msgJson?.data || msgJson;
        const existing = Array.isArray(src?.folders) ? src.folders : [];
        const merged = new Set(existing.map((f) => (typeof f === "string" ? f : "")));
        merged.add("TRASH");
        currentFolders = [...merged].filter(Boolean);
      }
      requestBody = JSON.stringify({ folders: currentFolders });
    }

    const upstream = await fetch(url, {
      method: req.method === "PATCH" ? "PUT" : req.method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: requestBody
    });

    const text = await upstream.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch (_error) {
      payload = { raw: text };
    }

    if (!upstream.ok) {
      const upstreamMessage = payload?.error?.message || payload?.message || "";
      if (req.method === "DELETE" && upstream.status === 403 && /hard_delete/i.test(upstreamMessage)) {
        return res.status(409).json({
          error:
            "La suppression definitive n'est pas active sur ce compte Nylas (hard_delete). Active-la dans le dashboard Nylas.",
          details: payload
        });
      }
      if (GRANT_DEAD_STATUSES.has(upstream.status) && typeof accountId === "string" && accountId.length > 0) {
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

    if (req.method === "DELETE") {
      return res.status(200).json({
        ok: true,
        data: {
          id: messageId
        }
      });
    }

    if (req.method === "PATCH") {
      return res.status(200).json({
        ok: true,
        data: {
          id: messageId,
          folder: "TRASH"
        }
      });
    }

    const source =
      payload && typeof payload === "object" && payload.data && typeof payload.data === "object"
        ? payload.data
        : payload;
    const htmlBody = typeof source?.body === "string" ? source.body : "";
    const textBodyRaw =
      typeof source?.body_plain === "string"
        ? source.body_plain
        : htmlBody
          ? stripHtml(htmlBody)
          : "";
    const textBody = normalizeEscapedNewlines(textBodyRaw);
    const attachments = normalizeAttachments(source?.attachments);

    return res.status(200).json({
      data: {
        id: source?.id || messageId,
        subject: source?.subject || "(Sans sujet)",
        from: Array.isArray(source?.from) ? source.from : [],
        to: Array.isArray(source?.to) ? source.to : [],
        date: source?.date || source?.created_at || null,
        snippet: source?.snippet || "",
        bodyText: textBody,
        bodyHtml: htmlBody,
        attachments,
        hasAttachments: attachments.length > 0 || Boolean(source?.has_attachments)
      }
    });
  } catch (error) {
    return res.status(502).json({
      error: "Unable to reach Nylas API",
      details: error && error.message ? error.message : "Unknown error"
    });
  }
};
