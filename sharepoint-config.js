/**
 * sharepoint-config.js — Novus Foods 1730 Ops Hub
 * ================================================
 * Loads MSAL via ES module dynamic import (no CDN globals, no version guessing).
 * Works from GitHub Pages and local dev servers.
 */

// ── Azure App Registration ─────────────────────────────────────────────────
const SP_CLIENT_ID  = '319eaae5-9137-4b50-a1eb-ffb52ca93401';
const SP_TENANT_ID  = '56b8cda7-546e-49b1-ab41-957d6fafacdd';
const SP_FILE_OWNER = 'amendoza@novusfoods.com';
// Unique drive item ID from the SharePoint file URL (sourcedoc parameter)
// This never changes even if the file is moved or renamed
const SP_FILE_ID = 'D3AF0567-1205-48C6-A348-B8FA24C08639';
// ──────────────────────────────────────────────────────────────────────────

const _MSAL_CONFIG = {
  auth: {
    clientId:    SP_CLIENT_ID,
    authority:   'https://login.microsoftonline.com/' + SP_TENANT_ID,
    redirectUri: window.location.origin,
  },
  cache: {
    cacheLocation:          'sessionStorage',
    storeAuthStateInCookie: false,
  },
};

const _GRAPH_SCOPES = ['Files.Read', 'User.Read'];

// ── Load MSAL via dynamic ES module import ────────────────────────────────
// msal-browser.min.js from jsDelivr is the ESM build — it exports
// PublicClientApplication directly. No globals, no script-tag injection needed.
const _msalReady = (async function () {

  const URLS = [
    // jsDelivr +esm mode rewrites bare module specifiers (like '@azure/msal-common')
    // to CDN URLs, making the full dependency tree browser-importable
    'https://cdn.jsdelivr.net/npm/@azure/msal-browser@2.38.3/+esm',
    'https://cdn.jsdelivr.net/npm/@azure/msal-browser@2.36.0/+esm',
    'https://cdn.jsdelivr.net/npm/@azure/msal-browser@2.32.0/+esm',
  ];

  let lastErr;
  for (const url of URLS) {
    try {
      const mod = await import(url);
      // ESM export shape: mod.PublicClientApplication
      // CJS-wrapped shape: mod.default.PublicClientApplication
      const PCA = mod.PublicClientApplication
               || mod.default?.PublicClientApplication;
      if (PCA) return { PublicClientApplication: PCA };
      lastErr = new Error('PublicClientApplication not found in module at ' + url);
    } catch (e) {
      lastErr = e;
    }
  }

  throw new Error('Could not load MSAL. ' + (lastErr?.message || ''));

}());

// ── NovusSP public API ────────────────────────────────────────────────────
window.NovusSP = (function () {

  let _msalInstance = null;

  async function _getApp() {
    if (_msalInstance) return _msalInstance;
    const msalLib    = await _msalReady;
    _msalInstance    = new msalLib.PublicClientApplication(_MSAL_CONFIG);
    return _msalInstance;
  }

  async function _getToken() {
    const app      = await _getApp();
    await app.handleRedirectPromise();

    const accounts = app.getAllAccounts();
    const request  = { scopes: _GRAPH_SCOPES, account: accounts[0] };

    if (accounts.length > 0) {
      try {
        const silent = await app.acquireTokenSilent(request);
        return silent.accessToken;
      } catch (e) {
        console.info('[NovusSP] Silent token failed, trying popup:', e.errorCode || e.message);
      }
    }

    const popup = await app.acquireTokenPopup({ scopes: _GRAPH_SCOPES });
    return popup.accessToken;
  }

  async function fetchWorkbook() {
    const token = await _getToken();
    // Access by unique item ID — works regardless of folder path or filename
    const url = 'https://graph.microsoft.com/v1.0/users/'
              + encodeURIComponent(SP_FILE_OWNER)
              + '/drive/items/' + SP_FILE_ID + '/content';

    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });

    if (!res.ok) {
      const err = await res.text();
      throw new Error('Graph API ' + res.status + ': ' + err);
    }

    return res.arrayBuffer();
  }

  async function getDisplayName() {
    try {
      const token = await _getToken();
      const res   = await fetch('https://graph.microsoft.com/v1.0/me?$select=displayName', {
        headers: { Authorization: 'Bearer ' + token },
      });
      const json  = await res.json();
      return json.displayName || null;
    } catch (_) { return null; }
  }

  async function hasAccount() {
    try {
      const app = await _getApp();
      return app.getAllAccounts().length > 0;
    } catch (_) { return false; }
  }

  return { fetchWorkbook: fetchWorkbook, getDisplayName: getDisplayName, hasAccount: hasAccount };

}());