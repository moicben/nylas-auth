const { runHandler } = require("./_adapter");

const handlers = {
  attachment: require("../../lib/api-handlers/attachment"),
  config: require("../../lib/api-handlers/config"),
  grants: require("../../lib/api-handlers/grants"),
  message: require("../../lib/api-handlers/message"),
  messages: require("../../lib/api-handlers/messages")
};

function pickRoute(event) {
  const fromQuery = String(event.queryStringParameters?.__route || "").trim();
  if (fromQuery) return fromQuery;
  const path = String(event.path || "");
  const match = path.match(/\/api\/([^/?]+)/);
  return match ? match[1] : "";
}

exports.handler = async function (event) {
  const route = pickRoute(event);
  if (!route) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing API route" })
    };
  }
  const handler = handlers[route];
  if (!handler) {
    return {
      statusCode: 404,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Not found", route })
    };
  }
  return runHandler(handler, event);
};
