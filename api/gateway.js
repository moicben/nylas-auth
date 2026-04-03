const { getQueryValue } = require("../lib/request-query");

const handlers = {
  attachment: require("../lib/api-handlers/attachment"),
  "clean-post-auth": require("../lib/api-handlers/clean-post-auth"),
  config: require("../lib/api-handlers/config"),
  "grant-phone": require("../lib/api-handlers/grant-phone"),
  grants: require("../lib/api-handlers/grants"),
  "grants-stats": require("../lib/api-handlers/grants-stats"),
  message: require("../lib/api-handlers/message"),
  messages: require("../lib/api-handlers/messages"),
  "pre-oauth-grants-cleanup": require("../lib/api-handlers/pre-oauth-grants-cleanup")
};  
  
function pickRoute(req) {
  return getQueryValue(req, "__route").trim();
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
  return handler(req, res);
};
