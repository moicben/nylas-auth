function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

    const htmlBody = typeof payload?.body === "string" ? payload.body : "";
    const textBody =
      typeof payload?.body_plain === "string"
        ? payload.body_plain
        : htmlBody
          ? stripHtml(htmlBody)
          : "";

    return res.status(200).json({
      data: {
        id: payload?.id || messageId,
        subject: payload?.subject || "(Sans sujet)",
        from: Array.isArray(payload?.from) ? payload.from : [],
        to: Array.isArray(payload?.to) ? payload.to : [],
        date: payload?.date || payload?.created_at || null,
        snippet: payload?.snippet || "",
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
