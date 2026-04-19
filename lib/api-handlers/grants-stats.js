const { getSupabaseClientConfig } = require("../supabase-accounts");

function buildHeaders(authKey) {
  return {
    apikey: authKey,
    Authorization: `Bearer ${authKey}`,
    "Content-Type": "application/json"
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { baseUrl, authKey } = getSupabaseClientConfig();
  const headers = buildHeaders(authKey);

  const queries = {
    overview: `
      select
        count(*)::int as total,
        count(*) filter (where grant_status = 'valid')::int as valid,
        count(*) filter (where grant_status = 'unauthorized')::int as unauthorized,
        count(*) filter (where grant_status = 'done')::int as done,
        count(*) filter (where grant_status = 'invalid')::int as invalid,
        count(*) filter (where grant_status = 'deleted_on_nylas')::int as deleted_on_nylas,
        count(*) filter (where deleted_at is not null)::int as soft_deleted,
        count(distinct email)::int as unique_emails,
        count(distinct account_id)::int as accounts,
        min(nylas_created_at) as earliest,
        max(nylas_created_at) as latest
      from public.grants
    `,
    daily: `
      select
        date(nylas_created_at) as day,
        count(*)::int as total,
        count(*) filter (where grant_status = 'valid')::int as valid,
        count(*) filter (where grant_status != 'valid' or grant_status is null)::int as invalid
      from public.grants
      where nylas_created_at is not null
      group by date(nylas_created_at)
      order by day asc
    `,
    by_status: `
      select grant_status as status, count(*)::int as count
      from public.grants
      where grant_status != 'exploited' or grant_status is null
      group by grant_status
      order by count desc
    `,
    by_account: `
      select
        account_id,
        count(*)::int as total,
        count(*) filter (where grant_status = 'valid')::int as valid,
        count(*) filter (where deleted_at is not null)::int as deleted
      from public.grants
      group by account_id
      order by total desc
    `,
    weekly_retention: `
      select
        date_trunc('week', nylas_created_at)::date as week,
        count(*)::int as created,
        count(*) filter (where deleted_at is not null)::int as deleted
      from public.grants
      where nylas_created_at is not null
      group by date_trunc('week', nylas_created_at)
      order by week desc
      limit 12
    `
  };

  try {
    const results = {};
    const entries = Object.entries(queries);

    const responses = await Promise.all(
      entries.map(([key, query]) =>
        fetch(`${baseUrl}/rest/v1/rpc/`, {
          method: "POST",
          headers,
          body: JSON.stringify({})
        }).catch(() => null)
      )
    );

    // Use direct SQL via PostgREST — fallback: raw fetch per query
    for (const [key, query] of entries) {
      const url = `${baseUrl}/rest/v1/rpc/`;
      // PostgREST doesn't support raw SQL, so use the pg_net or query via supabase-js
      // Instead, run each as a direct Supabase SQL query via the management API
    }

    // Simpler approach: use Supabase REST filters for each stat
    // Overview
    const overviewResp = await fetch(
      `${baseUrl}/rest/v1/grants?select=id,grant_status,email,account_id,nylas_created_at,deleted_at,revoked_at`,
      { headers }
    );
    if (!overviewResp.ok) {
      throw new Error(`Supabase query failed: ${overviewResp.status}`);
    }
    const allGrants = await overviewResp.json();

    // Deleted on Nylas = suppression manuelle, exclue des KPIs et du graphique acquisition
    const deletedOnNylas = allGrants.filter(g => g.grant_status === "deleted_on_nylas").length;
    const effectiveGrants = allGrants.filter(g => g.grant_status !== "deleted_on_nylas");

    // Compute stats in JS from the effective dataset (excluding deleted_on_nylas)
    const total = effectiveGrants.length;
    const valid = effectiveGrants.filter(g => g.grant_status === "valid").length;
    const unauthorized = effectiveGrants.filter(g => g.grant_status === "unauthorized").length;
    const done = effectiveGrants.filter(g => g.grant_status === "done").length;
    const invalid = effectiveGrants.filter(g => g.grant_status === "invalid").length;
    const softDeleted = effectiveGrants.filter(g => g.deleted_at !== null).length;
    const uniqueEmails = new Set(effectiveGrants.map(g => g.email).filter(Boolean)).size;
    const accounts = new Set(effectiveGrants.map(g => g.account_id)).size;

    // Revoked count (exclude done & deleted_on_nylas)
    const EXCLUDE_REVOKE = ["done", "deleted_on_nylas"];
    const isCountedRevoked = (g) => g.revoked_at !== null && !EXCLUDE_REVOKE.includes(g.grant_status);
    const revokedCount = effectiveGrants.filter(isCountedRevoked).length;

    // Avg time to revoke (hours)
    const revokeDurations = effectiveGrants
      .filter(g => isCountedRevoked(g) && g.nylas_created_at)
      .map(g => (new Date(g.revoked_at) - new Date(g.nylas_created_at)) / 3600000);
    const avgTimeToRevokeHours = revokeDurations.length
      ? Math.round(revokeDurations.reduce((a, b) => a + b, 0) / revokeDurations.length * 10) / 10
      : null;

    // Daily acquisition + revocations (excluding deleted_on_nylas)
    const allDays = new Set();
    const dailyMap = new Map();
    for (const g of effectiveGrants) {
      if (g.nylas_created_at) allDays.add(g.nylas_created_at.slice(0, 10));
      if (g.revoked_at) allDays.add(g.revoked_at.slice(0, 10));
    }
    for (const day of allDays) {
      dailyMap.set(day, { day, total: 0, valid: 0, invalid: 0, revoked: 0 });
    }
    for (const g of effectiveGrants) {
      if (g.nylas_created_at) {
        const day = g.nylas_created_at.slice(0, 10);
        const entry = dailyMap.get(day);
        entry.total++;
        if (g.grant_status === "valid") entry.valid++;
        else entry.invalid++;
      }
      if (isCountedRevoked(g)) {
        const day = g.revoked_at.slice(0, 10);
        const entry = dailyMap.get(day);
        entry.revoked++;
      }
    }
    const daily = [...dailyMap.values()].sort((a, b) => a.day.localeCompare(b.day));

    // By status (exclude exploited)
    const statusMap = new Map();
    for (const g of allGrants) {
      const s = g.grant_status || "unknown";
      if (s === "exploited") continue;
      statusMap.set(s, (statusMap.get(s) || 0) + 1);
    }
    const byStatus = [...statusMap.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);

    // By account
    const accountMap = new Map();
    for (const g of allGrants) {
      const aid = g.account_id;
      if (!accountMap.has(aid)) accountMap.set(aid, { account_id: aid, total: 0, valid: 0, deleted: 0 });
      const entry = accountMap.get(aid);
      entry.total++;
      if (g.grant_status === "valid") entry.valid++;
      if (g.deleted_at !== null) entry.deleted++;
    }
    const byAccount = [...accountMap.values()].sort((a, b) => b.total - a.total);

    // Weekly retention
    const weekMap = new Map();
    for (const g of allGrants) {
      if (!g.nylas_created_at) continue;
      const d = new Date(g.nylas_created_at);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d);
      monday.setDate(diff);
      const week = monday.toISOString().slice(0, 10);
      if (!weekMap.has(week)) weekMap.set(week, { week, created: 0, deleted: 0 });
      const entry = weekMap.get(week);
      entry.created++;
      if (g.deleted_at !== null) entry.deleted++;
    }
    const weeklyRetention = [...weekMap.values()].sort((a, b) => b.week.localeCompare(a.week)).slice(0, 12);

    return res.status(200).json({
      overview: {
        total, valid, unauthorized, done, invalid,
        deleted_on_nylas: deletedOnNylas,
        soft_deleted: softDeleted,
        revoked: revokedCount,
        unique_emails: uniqueEmails,
        accounts,
        avg_time_to_revoke_hours: avgTimeToRevokeHours
      },
      daily,
      by_status: byStatus,
      by_account: byAccount,
      weekly_retention: weeklyRetention
    });
  } catch (error) {
    return res.status(500).json({
      error: "Unable to compute grants stats",
      details: error?.message || "Unknown error"
    });
  }
};
