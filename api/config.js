module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const clientId = process.env.NYLAS_CLIENT_ID;
  const apiUrl = process.env.NYLAS_API_URL || "https://api.eu.nylas.com";

  if (!clientId) {
    return res.status(500).json({
      error: "Missing NYLAS_CLIENT_ID environment variable"
    });
  }

  return res.status(200).json({
    clientId,
    apiUrl
  });
};
