export const config = {
  apiUrl: import.meta.env.VITE_API_URL || 'http://localhost:4000',
  appName: import.meta.env.VITE_APP_NAME || 'ITNotice',
  oidc: {
    authority: import.meta.env.VITE_OIDC_AUTHORITY || 'http://localhost:8080/realms/itnotice',
    clientId: import.meta.env.VITE_OIDC_CLIENT_ID || 'itnotice-web',
  },
  /** Set VITE_AUTH_DISABLED=true to run without an IdP (API must set AUTH_DISABLED=true too). */
  authDisabled: import.meta.env.VITE_AUTH_DISABLED === 'true',
};
