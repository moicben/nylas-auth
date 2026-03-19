function safeFilename(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[\r\n"]/g, "").trim();
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const grantId = typeof req.query.grantId === "string" ? req.query.grantId.trim() : "";
  const attachmentId =
    typeof req.query.attachmentId === "string" ? req.query.attachmentId.trim() : "";
  const messageId = typeof req.query.messageId === "string" ? req.query.messageId.trim() : "";
  const filename = safeFilename(
    typeof req.query.filename === "string" ? req.query.filename : ""
  );

  if (!grantId || !attachmentId || !messageId) {
    return res.status(400).json({ error: "grantId, attachmentId and messageId are required" });
  }

  const apiKey = process.env.INBOX_API_KEY || process.env.NYLAS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Missing INBOX_API_KEY environment variable" });
  }

  const apiUrl = process.env.NYLAS_API_URL || "https://api.eu.nylas.com";
  const params = new URLSearchParams();
  params.set("message_id", messageId);
  const url = `${apiUrl}/v3/grants/${encodeURIComponent(grantId)}/attachments/${encodeURIComponent(attachmentId)}/download?${params.toString()}`;

  try {
    const upstream = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      let payload;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch (_error) {
        payload = { raw: text };
      }
      return res.status(upstream.status).json({
        error: "Nylas attachment download failed",
        details: payload
      });
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const upstreamFilename = safeFilename(
      upstream.headers.get("x-file-name") || upstream.headers.get("x-filename") || ""
    );
    const finalFilename = filename || upstreamFilename || `attachment-${attachmentId}`;

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${finalFilename}"; filename*=UTF-8''${encodeURIComponent(finalFilename)}`
    );
    return res.status(200).send(buffer);
  } catch (error) {
    return res.status(502).json({
      error: "Unable to reach Nylas API",
      details: error && error.message ? error.message : "Unknown error"
    });
  }
};
