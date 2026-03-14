# MVP Nylas Connect (sans IDP)

MVP ultra-rapide pour connecter Gmail avec Nylas Connect en mode standalone OAuth.

Le front ne contient que des informations publiques (`clientId`, `redirectUri`, `apiUrl`).
Les appels Nylas API sont faits cote serverless via `api/messages.js`.

## Prerequis

- Une application Nylas avec:
  - `clientId`
  - Google provider active
  - Redirect URIs autorisees:
    - `http://localhost:8000/auth/callback`
    - `https://trello.worksplace.online/auth/callback`

## Configuration

1. Ouvre `config.local.js`.
2. Renseigne `clientId` (obligatoire).
3. Laisse `redirectUri` dynamique: `${window.location.origin}/auth/callback`.
4. Configure la variable d'environnement serveur:
   - `NYLAS_API_KEY` (obligatoire)
   - `NYLAS_API_URL` (optionnelle, default `https://api.eu.nylas.com`)

## Lancer en local

```bash
cd /home/ben/Documents/nylas-auth
python3 -m http.server 8000
```

Puis ouvre:

- http://localhost:8000

## Deploiement Vercel

1. Importer le projet dans Vercel.
2. Ajouter la variable d'environnement `NYLAS_API_KEY`.
3. (Optionnel) Ajouter `NYLAS_API_URL`.
4. Deployer sur `https://trello.worksplace.online`.
5. Verifier que la redirect URI Nylas contient bien:
   - `https://trello.worksplace.online/auth/callback`

## Usage

1. Clique sur "Connecter Gmail".
2. Termine le consentement OAuth Google.
3. Observe le `grantId` dans "Session".
4. Clique "Tester API Nylas" pour lire les 5 derniers messages (scope readonly) via la route serverless `/api/messages`.

## Notes importantes

- Ce setup evite un IDP externe pour le MVP.
- Ne jamais exposer `NYLAS_API_KEY` dans le navigateur.
