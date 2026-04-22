# Supabase — Edge Function `sync-accounts`

Sync périodique Nylas → Supabase : toutes les 2 minutes, lit chaque compte de
`accounts`, liste ses grants via l'API Nylas EU, upsert dans `grants`,
soft-delete ceux qui n'existent plus côté Nylas, et recalcule `grants_count`.

## Structure

```
supabase/
├── config.toml
├── functions/
│   └── sync-accounts/
│       ├── index.ts           # Deno entry point
│       └── nylas-client.ts    # helpers Nylas
└── migrations/
    └── 20260422070000_sync_accounts.sql
```

## Déploiement

Prérequis : Supabase CLI installé + projet linké (`supabase link --project-ref vgijwvybcggjkezzxatg`).

```bash
# 1. Déployer la fonction
supabase functions deploy sync-accounts

# 2. Appliquer la migration (crée sync_logs + cron job)
supabase db push
```

## Activer le cron (une seule fois)

Dans le SQL Editor Supabase, exécuter (avec la vraie service role key) :

```sql
insert into private.app_config (key, value)
values ('service_role_key', '<SERVICE_ROLE_KEY>')
on conflict (key) do update set value = excluded.value;
```

Sans cette entrée, `net.http_post` envoie un Bearer vide et l'EF rejette.
Le schéma `private` est révoqué pour anon/authenticated : la clé n'est
lisible que par `service_role` et `postgres`.

## Tester manuellement

```bash
curl -X POST \
  https://vgijwvybcggjkezzxatg.supabase.co/functions/v1/sync-accounts \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>"
```

Consulter les derniers runs :

```sql
select * from public.sync_logs order by started_at desc limit 10;
```

## Variables d'environnement (auto)

La plateforme Supabase injecte automatiquement :
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optionnel :
- `NYLAS_API_URL` (défaut : `https://api.eu.nylas.com`)

Pour définir `NYLAS_API_URL` ou override :
```bash
supabase secrets set NYLAS_API_URL=https://api.eu.nylas.com
```
