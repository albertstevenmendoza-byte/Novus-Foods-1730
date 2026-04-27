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

const _GRAPH_SCOPES = ['Files.Read.All', 'User.Read'];

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

    // ── Path 1: owner's drive (works for Albert) ──────────────────────────
    const ownerUrl = 'https://graph.microsoft.com/v1.0/users/'
                   + encodeURIComponent(SP_FILE_OWNER)
                   + '/drive/items/' + SP_FILE_ID + '/content';

    let res = await fetch(ownerUrl, { headers: { Authorization: 'Bearer ' + token } });
    if (res.ok) return res.arrayBuffer();

    const status1 = res.status;

    // ── Path 2: sharedWithMe (works for other users the file is shared with) ──
    // When Graph returns 404 on the owner path it means this user's token
    // can't resolve the item via the owner's drive — but if the file is
    // shared with them, it appears in /me/drive/sharedWithMe.
    if (status1 === 404 || status1 === 403) {
      try {
        const sharedRes = await fetch(
          'https://graph.microsoft.com/v1.0/me/drive/sharedWithMe?$select=id,name,remoteItem',
          { headers: { Authorization: 'Bearer ' + token } }
        );
        if (sharedRes.ok) {
          const body = await sharedRes.json();
          const match = (body.value || []).find(i =>
            i.name?.toLowerCase().includes('all_department_data') ||
            (i.remoteItem?.id === SP_FILE_ID)
          );
          if (match) {
            const driveId  = match.remoteItem?.parentReference?.driveId;
            const realId   = match.remoteItem?.id || SP_FILE_ID;
            if (driveId) {
              const sharedUrl = 'https://graph.microsoft.com/v1.0/drives/'
                              + driveId + '/items/' + realId + '/content';
              const r2 = await fetch(sharedUrl, { headers: { Authorization: 'Bearer ' + token } });
              if (r2.ok) return r2.arrayBuffer();
            }
          }
        }
      } catch (_) { /* fall through to original error */ }
    }

    // ── Both paths failed — surface a clear error ─────────────────────────
    let hint = '';
    if (status1 === 404) hint = ' File not found or not shared with this account.';
    if (status1 === 403) hint = ' Access denied — ask admin to grant Files.Read.All consent in Azure.';
    if (status1 === 401) hint = ' Auth expired — sign out and back in.';
    const errText = await res.text().catch(() => '');
    throw new Error('SharePoint sync failed (' + status1 + ').' + hint);
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
