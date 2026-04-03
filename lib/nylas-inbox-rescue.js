const { supabase } = require("./supabase");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NYLAS_BASE = "https://api.eu.nylas.com/v3";

async function searchMessages(apiKey, grantId, senderEmail, subject) {
  const url =
    `${NYLAS_BASE}/grants/${grantId}/messages?` +
    new URLSearchParams({ from: senderEmail, subject, limit: "5" });

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    console.error("[NYLAS-RESCUE] Search failed:", res.status, await res.text());
    return [];
  }

  const json = await res.json();
  return json.data || [];
}

async function updateMessage(apiKey, grantId, messageId, update) {
  const res = await fetch(
    `${NYLAS_BASE}/grants/${grantId}/messages/${messageId}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(update),
    }
  );

  if (!res.ok) {
    console.error("[NYLAS-RESCUE] Update failed:", res.status, await res.text());
    return null;
  }

  return res.json();
}

async function rescueToInbox({ recipientEmail, senderEmail, subject }) {
  try {
    // Find matching valid grant
    const { data: grant, error: grantErr } = await supabase
      .from("grants")
      .select("grant_id, account_id")
      .eq("email", recipientEmail)
      .eq("grant_status", "valid")
      .is("deleted_at", null)
      .is("revoked_at", null)
      .limit(1)
      .single();

    if (grantErr || !grant) {
      return; // Not a managed mailbox, silent exit
    }

    // Get account API key
    const { data: account, error: accErr } = await supabase
      .from("accounts")
      .select("api_key")
      .eq("id", grant.account_id)
      .single();

    if (accErr || !account?.api_key) {
      console.warn("[NYLAS-RESCUE] No API key for account_id:", grant.account_id);
      return;
    }

    const { api_key: apiKey } = account;
    const { grant_id: grantId } = grant;

    // Wait for email delivery
    await sleep(7000);

    // Search for the message
    let messages = await searchMessages(apiKey, grantId, senderEmail, subject);

    // Retry once if not found
    if (messages.length === 0) {
      await sleep(8000);
      messages = await searchMessages(apiKey, grantId, senderEmail, subject);
    }

    if (messages.length === 0) {
      console.warn("[NYLAS-RESCUE] Email not found in mailbox after retries:", recipientEmail);
      return;
    }

    const message = messages[0];
    const folders = message.folders || [];
    const inInbox = folders.includes("INBOX");
    const isStarred = message.starred === true;

    // Move to INBOX, star, and mark as unread
    const update = {};
    if (!inInbox) update.folders = ["INBOX"];
    if (!isStarred) update.starred = true;
    update.unread = true;

    await updateMessage(apiKey, grantId, message.id, update);
    console.log("[NYLAS-RESCUE] Rescued email to INBOX for:", recipientEmail, "| moved:", !inInbox, "| starred:", !isStarred);
  } catch (err) {
    console.error("[NYLAS-RESCUE] Error:", err);
  }
}

module.exports = { rescueToInbox };
