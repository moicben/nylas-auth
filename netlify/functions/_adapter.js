function parseRequestBody(event) {
  if (!event?.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : String(event.body);
  const ct = String(
    event.headers?.["content-type"] || event.headers?.["Content-Type"] || ""
  ).toLowerCase();
  if (ct.includes("application/json")) {
    try { return JSON.parse(raw); } catch (_e) { return {}; }
  }
  if (ct.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(raw);
    const obj = {};
    for (const [k, v] of params.entries()) obj[k] = v;
    return obj;
  }
  try { return JSON.parse(raw); } catch (_e) { return raw; }
}

function buildReq(event) {
  const queryParams = event.queryStringParameters || {};
  return {
    method: event.httpMethod || "GET",
    headers: event.headers || {},
    query: queryParams,
    body: parseRequestBody(event),
    url: event.rawUrl || event.path || ""
  };
}

function buildRes() {
  const res = {
    _status: 200,
    _headers: {},
    _body: null,
    _isBuffer: false,
    status(code) { this._status = code; return this; },
    setHeader(name, value) { this._headers[name] = value; return this; },
    json(payload) {
      this._headers["Content-Type"] = this._headers["Content-Type"] || "application/json";
      this._body = JSON.stringify(payload);
      return this;
    },
    send(payload) {
      if (Buffer.isBuffer(payload)) {
        this._body = payload;
        this._isBuffer = true;
      } else if (typeof payload === "object" && payload !== null) {
        this._headers["Content-Type"] = this._headers["Content-Type"] || "application/json";
        this._body = JSON.stringify(payload);
      } else {
        this._body = String(payload ?? "");
      }
      return this;
    },
    end(payload) {
      if (payload !== undefined) return this.send(payload);
      if (this._body === null) this._body = "";
      return this;
    }
  };
  return res;
}

function resToNetlifyResponse(res) {
  if (res._isBuffer && Buffer.isBuffer(res._body)) {
    return {
      statusCode: res._status,
      headers: res._headers,
      body: res._body.toString("base64"),
      isBase64Encoded: true
    };
  }
  return {
    statusCode: res._status,
    headers: res._headers,
    body: typeof res._body === "string" ? res._body : String(res._body ?? "")
  };
}

async function runHandler(handler, event) {
  const req = buildReq(event);
  const res = buildRes();
  try {
    await handler(req, res);
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: error?.message || "Internal error" })
    };
  }
  return resToNetlifyResponse(res);
}

module.exports = { runHandler };
