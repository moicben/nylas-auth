function buildRequestUrl(req) {
  const rawUrl = typeof req?.url === "string" ? req.url : "/";
  const hostHeader =
    (req?.headers && (req.headers["x-forwarded-host"] || req.headers.host)) || "localhost";
  const protocolHeader =
    (req?.headers && req.headers["x-forwarded-proto"]) || "https";
  const base = `${protocolHeader}://${hostHeader}`;

  try {
    return new URL(rawUrl, base);
  } catch (_error) {
    return new URL("/", "https://localhost");
  }
}

function getQueryValue(req, key) {
  const requestUrl = buildRequestUrl(req);
  const value = requestUrl.searchParams.get(key);
  return typeof value === "string" ? value : "";
}

module.exports = {
  buildRequestUrl,
  getQueryValue
};
