window.NYLAS_CONFIG = {
  // Required for Nylas Connect OAuth.
  clientId: "YOUR_NYLAS_CLIENT_ID",

  // Must match a redirect URI configured in Nylas dashboard.
  // Works for local and production domains.
  redirectUri: `${window.location.origin}/auth/callback`,

  // Use US or EU API according to your Nylas app region.
  apiUrl: "https://api.eu.nylas.com"
};
