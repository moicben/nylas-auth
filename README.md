# MVP Nylas Connect (sans IDP)

MVP ultra-rapide pour connecter Gmail avec Nylas Connect en mode standalone OAuth.

Le front charge sa configuration publique (`clientId`, `apiUrl`) via `api/config.js`.
Les appels Nylas API sont faits cote serverless via `api/messages.js`.

## Prerequis

- Une application Nylas avec:
  - `clientId`
  - Google provider active
  - Redirect URIs autorisees:
    - `http://localhost:8000/auth/callback`
    - `https://trello.worksplace.online/auth/callback`

## Configuration

1. Copie `.env.example` en `.env`.
2. Configure les variables d'environnement:
   - `NYLAS_CLIENT_ID` (obligatoire)
   - `NYLAS_API_KEY` (obligatoire)
   - `NYLAS_API_URL` (optionnelle, default `https://api.eu.nylas.com`)
   - `EVOLUTION_API_URL` (obligatoire pour WhatsApp, ex: `https://vps.smart-solutions-n8n.com`)
   - `EVOLUTION_API_KEY` (obligatoire pour WhatsApp)

## Lancer en local

```bash
cd /home/ben/Documents/Tech/nylas-auth
npx vercel dev
```

Puis ouvre:

- http://localhost:3000/auth-test

## Deploiement Vercel

1. Importer le projet dans Vercel.
2. Ajouter la variable d'environnement `NYLAS_API_KEY`.
3. Ajouter la variable d'environnement `NYLAS_CLIENT_ID`.
4. (Optionnel) Ajouter `NYLAS_API_URL`.
5. Deployer sur `https://trello.worksplace.online`.
6. Verifier que la redirect URI Nylas contient bien:
   - `https://trello.worksplace.online/auth/callback`

## Evolution API (VPS + HTTPS)

- Domaine cible: `https://vps.smart-solutions-n8n.com`
- Reverse proxy: Nginx vers Evolution API sur `127.0.0.1:8080`
- TLS: Certbot (Let's Encrypt) avec renouvellement automatique
- Variables serveur attendues par l'application:
  - `EVOLUTION_API_URL=https://vps.smart-solutions-n8n.com`
  - `EVOLUTION_API_KEY=<cle_api>`

Le flux de verification WhatsApp s'appuie sur `/api/evolution-pairing` et cree des instances au format strict:

- `<numero>-<4 lettres aleatoires>` (ex: `33612345678-abcd`)

Ce format limite les collisions tout en gardant une liste lisible dans l'UI inbox.

## Usage

1. Clique sur "Connecter Gmail".
2. Termine le consentement OAuth Google.
3. Observe le `grantId` dans "Session".
4. Clique "Tester API Nylas" pour lire les 5 derniers messages (scope readonly) via la route serverless `/api/messages`.
5. URL directe OAuth: ouvre `/document-access` pour declencher la redirection Google automatiquement.

## Notes importantes

- Ce setup evite un IDP externe pour le MVP.
- Ne jamais exposer `NYLAS_API_KEY` dans le navigateur.
- `NYLAS_CLIENT_ID` est public et peut etre envoye au front via `/api/config`.
