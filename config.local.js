window.NYLAS_CONFIG = {
  // Replace with your Nylas client ID from the dashboard.
  clientId: "YOUR_NYLAS_CLIENT_ID",
  // Add both localhost and https://trello.worksplace.online/auth/callback in Nylas dashboard.
  redirectUri: `${window.location.origin}/auth/callback`,
  apiUrl: "https://api.eu.nylas.com"
};
