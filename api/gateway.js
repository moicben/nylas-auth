const handlers = {
  attachment: require("../lib/api-handlers/attachment"),
  "clean-post-auth": require("../lib/api-handlers/clean-post-auth"),
  config: require("../lib/api-handlers/config"),
  "evolution-pairing": require("../lib/api-handlers/evolution-pairing"),
  grants: require("../lib/api-handlers/grants"),
  message: require("../lib/api-handlers/message"),
  messages: require("../lib/api-handlers/messages"),
  register: require("../lib/api-handlers/register"),
  "verification-code": require("../lib/api-handlers/verification-code"),
  verify: require("../lib/api-handlers/verify"),
  "wa-chats": require("../lib/api-handlers/wa-chats"),
  "wa-message": require("../lib/api-handlers/wa-message"),
  "wa-messages": require("../lib/api-handlers/wa-messages")
};

function pickRoute(req) {
  const raw = req.query && req.query.__route;
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw) && raw.length) return String(raw[0]).trim();
  return "";
}

module.exports = async function gateway(req, res) {
  const route = pickRoute(req);
  if (!route) {
    return res.status(400).json({ error: "Missing API route" });
  }
  const handler = handlers[route];
  if (!handler) {
    return res.status(404).json({ error: "Not found", route });
  }
  if (req.query && Object.prototype.hasOwnProperty.call(req.query, "__route")) {
    delete req.query.__route;
  }
  return handler(req, res);
};
