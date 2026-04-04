const { buildRequestUrl } = require("../request-query");
const { renderInvoiceEmailFromFields } = require("../invoice-email-html");

module.exports = async function previewInvoice(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const url = buildRequestUrl(req);
  const sp = url.searchParams;

  const fields = {
    merchant_name: sp.get("merchant_name") || "",
    merchant_url: sp.get("merchant_url") || "",
    merchant_logo: sp.get("merchant_logo") || "",
    order_amount: sp.get("order_amount") || "",
    order_devise: sp.get("order_devise") || "",
    order_email: sp.get("order_email") || "",
    order_date: sp.get("order_date") || "",
    order_ref: sp.get("order_ref") || "",
    card_brand: sp.get("card_brand") || "",
    card_digits: sp.get("card_digits") || "",
  };

  const html = renderInvoiceEmailFromFields(fields);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(html);
};
