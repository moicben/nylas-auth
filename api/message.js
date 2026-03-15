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

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const grantId = typeof req.query.grantId === "string" ? req.query.grantId.trim() : "";
  const messageId = typeof req.query.messageId === "string" ? req.query.messageId.trim() : "";
  if (!grantId || !messageId) {
    return res.status(400).json({ error: "grantId and messageId are required" });
  }

  const apiKey = process.env.NYLAS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Missing NYLAS_API_KEY environment variable" });
  }

  const apiUrl = process.env.NYLAS_API_URL || "https://api.eu.nylas.com";
  const url = `${apiUrl}/v3/grants/${encodeURIComponent(grantId)}/messages/${encodeURIComponent(messageId)}`;

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

    return res.status(200).json({
      data: {
        id: source?.id || messageId,
        subject: source?.subject || "(Sans sujet)",
        from: Array.isArray(source?.from) ? source.from : [],
        to: Array.isArray(source?.to) ? source.to : [],
        date: source?.date || source?.created_at || null,
        snippet: source?.snippet || "",
        bodyText: textBody,
        bodyHtml: htmlBody
      }
    });
  } catch (error) {
    return res.status(502).json({
      error: "Unable to reach Nylas API",
      details: error && error.message ? error.message : "Unknown error"
    });
  }
};
