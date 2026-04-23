const { runHandler } = require("./_adapter");
const handler = require("../../lib/api-handlers/clean-post-auth");

exports.handler = async function (event) {
  return runHandler(handler, event);
};
