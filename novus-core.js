/* ═══════════════════════════════════════════════════════════════
   novus-core.js  —  Novus Foods 1730 Ops Hub
   v5.0 — CORS proxy + 30-min auto-refetch + localStorage cache
═══════════════════════════════════════════════════════════════ */

/* ── STORAGE KEYS ─────────────────────────────────────────── */
const NOVUS_SP_URL_KEY   = 'https://lakeviewfarms1600-my.sharepoint.com/:x:/g/personal/amendoza_novusfoods_com/IQBnBa_TBRLGSKNIuPokwIY5AbZ17FdLp9cfw2v2FM89szA?e=OJnMRm';
const NOVUS_CACHE_KEY    = 'novus_xlsx_b64';
const NOVUS_CACHE_TS_KEY = 'novus_xlsx_ts';
const NOVUS_CACHE_MAX_MS = 30 * 60 * 1000;   // 30 minutes

/* ── CORS PROXIES (tried in order) ───────────────────────── */
const CORS_PROXIES = [
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

/* ── PUBLIC API ───────────────────────────────────────────── */
window.NovusCore = window.NovusCore || {};

/* ─────────────────────────────────────────────────────────────
   getDataBuffer()
   1. Fresh localStorage cache (< 30 min)  → return immediately
   2. Saved SharePoint URL                 → fetch via proxy
   3. No URL saved                         → show setup modal
───────────────────────────────────────────────────────────── */
NovusCore.getDataBuffer = function () {
  return new Promise((resolve, reject) => {
    const cachedB64 = localStorage.getItem(NOVUS_CACHE_KEY);
    const cachedTs  = parseInt(localStorage.getItem(NOVUS_CACHE_TS_KEY) || '0', 10);
    const cacheAge  = Date.now() - cachedTs;
    const spUrl     = localStorage.getItem(NOVUS_SP_URL_KEY);

    /* 1 — Fresh cache */
    if (cachedB64 && cacheAge < NOVUS_CACHE_MAX_MS) {
      try {
        resolve(_b64ToBuffer(cachedB64));
        return;
      } catch (_) { _clearCache(); }
    }

    /* 2 — Fetch from SharePoint via CORS proxy */
    if (spUrl) {
      _fetchWithProxy(spUrl)
        .then(buf => { _cacheBuffer(buf); resolve(buf); })
        .catch(err => {
          /* If we have a stale cache, use it rather than showing upload modal */
          if (cachedB64) {
            console.warn('[NovusCore] Proxy failed, using stale cache:', err.message);
            NovusCore.Toast.warning('Could not refresh — showing cached data.');
            try { resolve(_b64ToBuffer(cachedB64)); return; } catch (_) {}
          }
          _showFallbackModal('Could not fetch from SharePoint: ' + err.message.split('\n')[0], resolve, reject);
        });
      return;
    }

    /* 3 — First-time setup */
    _showSetupModal(resolve, reject);
  });
};

/* ─────────────────────────────────────────────────────────────
   startAutoRefresh(reloadFn)
   Call once after initial render. Fires every 30 min and on
   manual page refresh. Updates countdown in nav if present.
───────────────────────────────────────────────────────────── */
NovusCore.startAutoRefresh = function (reloadFn) {
  const spUrl = localStorage.getItem(NOVUS_SP_URL_KEY);
  if (!spUrl) return;

  if (window._novusRefreshTimer)   clearInterval(window._novusRefreshTimer);
  if (window._novusCountdownTimer) clearInterval(window._novusCountdownTimer);

  let nextRefreshAt = Date.now() + NOVUS_CACHE_MAX_MS;

  /* Live countdown in nav */
  window._novusCountdownTimer = setInterval(() => {
    const el = document.getElementById('nc-countdown');
    if (!el) return;
    const rem = Math.max(0, nextRefreshAt - Date.now());
    const m   = Math.floor(rem / 60000);
    const s   = Math.floor((rem % 60000) / 1000);
    el.textContent = `↻ ${m}:${String(s).padStart(2,'0')}`;
  }, 1000);

  /* Auto-refresh every 30 min */
  window._novusRefreshTimer = setInterval(async () => {
    const st = document.getElementById('nc-live-status');
    if (st) NovusCore.setStatus(st, 'loading', 'Refreshing…');
    try {
      const buf = await _fetchWithProxy(spUrl);
      _cacheBuffer(buf);
      nextRefreshAt = Date.now() + NOVUS_CACHE_MAX_MS;
      if (st) NovusCore.setStatus(st, 'ok', '✓ Live');
      NovusCore.Toast.info('Data refreshed from SharePoint ✓');
      if (typeof reloadFn === 'function') reloadFn(buf);
    } catch (err) {
      console.warn('[NovusCore] Auto-refresh failed:', err);
      if (st) NovusCore.setStatus(st, 'error', '⚠ Refresh failed');
    }
  }, NOVUS_CACHE_MAX_MS);
};

/* Helpers */
NovusCore.resetDataSource = function () {
  localStorage.removeItem(NOVUS_SP_URL_KEY);
  _clearCache();
  if (window._novusRefreshTimer)   clearInterval(window._novusRefreshTimer);
  if (window._novusCountdownTimer) clearInterval(window._novusCountdownTimer);
};
NovusCore.forceRefresh    = function () { _clearCache(); location.reload(); };
NovusCore.getSavedUrl     = ()    => localStorage.getItem(NOVUS_SP_URL_KEY) || '';
NovusCore.setSavedUrl     = url   => { localStorage.setItem(NOVUS_SP_URL_KEY, url.trim()); _clearCache(); };
NovusCore.navigateTo      = href  => { window.location.href = href; };

/* Nav HTML helpers — drop these IDs into your nav */
NovusCore.navStatusHTML = () => `
  <span id="nc-live-status" style="font-size:.7rem;font-family:'DM Mono',monospace;margin-right:4px;"></span>
  <span id="nc-countdown"   style="font-size:.68rem;font-family:'DM Mono',monospace;color:#94a3b8;margin-right:8px;"></span>`;

/* ─────────────────────────────────────────────────────────────
   Toast / BtnLoader / setStatus
───────────────────────────────────────────────────────────── */
NovusCore.Toast = {
  _show(msg, color, icon) {
    if (!document.getElementById('_nc_toast_css')) {
      const s = document.createElement('style');
      s.id = '_nc_toast_css';
      s.textContent = `@keyframes _ncTIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}`;
      document.head.appendChild(s);
    }
    const t = document.createElement('div');
    t.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;background:${color};color:#fff;padding:12px 20px;border-radius:10px;font-family:'DM Sans',sans-serif;font-size:.85rem;font-weight:600;box-shadow:0 4px 20px rgba(0,0,0,.18);display:flex;align-items:center;gap:8px;animation:_ncTIn .25s ease both;max-width:360px;cursor:pointer;`;
    t.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
    t.onclick = () => t.remove();
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity='0'; t.style.transition='opacity .3s'; setTimeout(()=>t.remove(),320); }, 4000);
  },
  success(m) { this._show(m,'#059669','✓'); },
  warning(m) { this._show(m,'#d97706','⚠'); },
  error(m)   { this._show(m,'#dc2626','✕'); },
  info(m)    { this._show(m,'#2563eb','ℹ'); },
};

NovusCore.BtnLoader = {
  start(btn) { btn._h=btn.innerHTML; btn.disabled=true; btn.innerHTML='⏳ '+btn._h; },
  stop(btn)  { btn.disabled=false; btn.innerHTML=btn._h||btn.innerHTML; },
};

NovusCore.setStatus = function (el, state, text) {
  if (!el) return;
  _injectStyles();
  el.className = 'nc-status-bar';
  el.innerHTML = `<span class="nc-status-dot ${state}"></span><span>${text}</span>`;
};

/* ═══════════════════════════════════════════════════════════
   PRIVATE
═══════════════════════════════════════════════════════════ */

function _clearCache() {
  localStorage.removeItem(NOVUS_CACHE_KEY);
  localStorage.removeItem(NOVUS_CACHE_TS_KEY);
}

function _cacheBuffer(buf) {
  try {
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    localStorage.setItem(NOVUS_CACHE_KEY, b64);
    localStorage.setItem(NOVUS_CACHE_TS_KEY, String(Date.now()));
  } catch (e) {
    try { _clearCache(); const b64=btoa(String.fromCharCode(...new Uint8Array(buf))); localStorage.setItem(NOVUS_CACHE_KEY,b64); localStorage.setItem(NOVUS_CACHE_TS_KEY,String(Date.now())); }
    catch (_) { console.warn('[NovusCore] localStorage quota exceeded.'); }
  }
}

function _b64ToBuffer(b64) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i);
  return buf.buffer;
}

function _normalizeUrl(url) {
  const u = url.trim();
  if (/\.(xlsx|xls|xlsm)(\?|$)/i.test(u)) return u.includes('?') ? u+'&download=1' : u+'?download=1';
  if (u.includes('sharepoint.com') || u.includes('/_layouts/') || u.includes('/sites/'))
    return u.includes('?') ? u+'&download=1' : u+'?download=1';
  return u;
}

async function _fetchWithProxy(rawUrl) {
  const url = _normalizeUrl(rawUrl);
  const errs = [];
  for (const makeUrl of CORS_PROXIES) {
    try {
      const resp = await fetch(makeUrl(url), { cache: 'no-store' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      if (buf.byteLength < 200) throw new Error('Response too small — not an Excel file');
      return buf;
    } catch (e) { errs.push(e.message); }
  }
  throw new Error(errs.join(' | '));
}

/* ── SETUP MODAL ──────────────────────────────────────────── */
function _showSetupModal(resolve, reject) {
  _injectStyles();
  const ov = _makeOverlay();
  ov.innerHTML = `
    <div class="nc-modal">
      <div class="nc-logo">📊</div>
      <h2>Connect to SharePoint</h2>
      <p>Paste your SharePoint <strong>"Anyone with link"</strong> URL below.
         Saved permanently — you'll never be asked again.</p>
      <div class="nc-field">
        <label>SharePoint File URL</label>
        <input type="url" id="nc-url-in"
          placeholder="https://company.sharepoint.com/sites/…/all_department_data_2026.xlsx"
          autocomplete="off" spellcheck="false"/>
        <div id="nc-hint" class="nc-hint"></div>
      </div>
      <button class="nc-btn-primary" id="nc-btn-connect" disabled>Connect &amp; Load Dashboard</button>
      <div class="nc-divider"><span>or upload manually (this session only)</span></div>
      <div class="nc-dropzone" id="nc-dz" onclick="document.getElementById('nc-fi').click()">
        <input type="file" id="nc-fi" accept=".xlsx,.xls"/>
        <div style="font-size:1.4rem;margin-bottom:6px">📁</div>
        <div style="font-size:.85rem;font-weight:600;color:#334155">Click to browse or drag &amp; drop</div>
        <div style="font-size:.74rem;color:#94a3b8;margin-top:3px">No auto-refresh — session only</div>
        <div id="nc-chosen" style="display:none;font-size:.8rem;color:#059669;font-weight:700;margin-top:8px"></div>
      </div>
      <p class="nc-tip">💡 <strong>How to get your SharePoint URL:</strong>
        Open the file → <em>Share</em> → <em>"Anyone with the link can view"</em> → <em>Copy link</em>.</p>
    </div>`;
  document.body.appendChild(ov);

  const urlIn  = ov.querySelector('#nc-url-in');
  const btn    = ov.querySelector('#nc-btn-connect');
  const hint   = ov.querySelector('#nc-hint');
  const fi     = ov.querySelector('#nc-fi');
  const dz     = ov.querySelector('#nc-dz');
  const chosen = ov.querySelector('#nc-chosen');

  urlIn.addEventListener('input', () => {
    const v = urlIn.value.trim();
    const ok = v.startsWith('http') && (v.includes('sharepoint') || /\.(xlsx|xls)/i.test(v));
    btn.disabled = !ok;
    hint.textContent = ok ? '✓ URL looks valid' : (v ? '⚠ Enter a full SharePoint or .xlsx URL' : '');
    hint.style.color = ok ? '#059669' : '#d97706';
  });

  btn.addEventListener('click', () => {
    const url = urlIn.value.trim();
    btn.disabled = true; btn.textContent = '⏳ Fetching via proxy…';
    hint.textContent = 'Trying CORS proxies…'; hint.style.color = '#2563eb';
    _fetchWithProxy(url)
      .then(buf => {
        localStorage.setItem(NOVUS_SP_URL_KEY, url);
        _cacheBuffer(buf); ov.remove();
        NovusCore.Toast.success('Connected ✓ Auto-refreshes every 30 min.');
        resolve(buf);
      })
      .catch(err => {
        hint.textContent = '✕ ' + err.message.split(' | ')[0] + ' — try uploading manually below.';
        hint.style.color = '#dc2626';
        btn.disabled = false; btn.textContent = 'Connect & Load Dashboard';
      });
  });

  function loadFile(f) {
    if (!f) return;
    chosen.textContent = '✓ ' + f.name; chosen.style.display = 'block';
    dz.style.borderColor = '#059669';
    const r = new FileReader();
    r.onload = e => { ov.remove(); NovusCore.Toast.warning('Manual upload — no auto-refresh. Set a SharePoint URL for live data.'); resolve(e.target.result); };
    r.readAsArrayBuffer(f);
  }
  fi.addEventListener('change', () => loadFile(fi.files[0]));
  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('nc-drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('nc-drag-over'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('nc-drag-over'); loadFile(e.dataTransfer.files[0]); });
}

/* ── FALLBACK MODAL ───────────────────────────────────────── */
function _showFallbackModal(reason, resolve, reject) {
  _injectStyles();
  const ov = _makeOverlay();
  ov.innerHTML = `
    <div class="nc-modal">
      <div class="nc-logo">⚠️</div>
      <h2>Could Not Fetch File</h2>
      <p style="color:#dc2626;font-size:.82rem">${reason}</p>
      <p>Upload manually for this session, or update the URL.</p>
      <div class="nc-dropzone" id="nc-fb-dz" onclick="document.getElementById('nc-fb-fi').click()">
        <input type="file" id="nc-fb-fi" accept=".xlsx,.xls"/>
        <div style="font-size:1.4rem;margin-bottom:6px">📁</div>
        <div style="font-size:.85rem;font-weight:600;color:#334155">Click to browse or drag &amp; drop</div>
        <div id="nc-fb-chosen" style="display:none;font-size:.8rem;color:#059669;font-weight:700;margin-top:8px"></div>
      </div>
      <div class="nc-divider"><span>or</span></div>
      <button class="nc-btn-ghost" onclick="NovusCore.resetDataSource();location.reload()">🔗 Update SharePoint URL</button>
    </div>`;
  document.body.appendChild(ov);

  const fi  = ov.querySelector('#nc-fb-fi');
  const dz  = ov.querySelector('#nc-fb-dz');
  const cho = ov.querySelector('#nc-fb-chosen');
  function loadFile(f) {
    if (!f) return; cho.textContent='✓ '+f.name; cho.style.display='block';
    const r=new FileReader(); r.onload=e=>{ov.remove();resolve(e.target.result);}; r.readAsArrayBuffer(f);
  }
  fi.addEventListener('change', ()=>loadFile(fi.files[0]));
  dz.addEventListener('dragover', e=>{e.preventDefault();dz.classList.add('nc-drag-over');});
  dz.addEventListener('dragleave',()=>dz.classList.remove('nc-drag-over'));
  dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('nc-drag-over');loadFile(e.dataTransfer.files[0]);});
}

function _makeOverlay() { const el=document.createElement('div'); el.className='nc-overlay'; return el; }

let _styled = false;
function _injectStyles() {
  if (_styled) return; _styled = true;
  const s = document.createElement('style');
  s.textContent = `
    .nc-overlay{position:fixed;inset:0;background:rgba(15,23,42,.6);backdrop-filter:blur(6px);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;animation:ncFI .2s ease both;}
    @keyframes ncFI{from{opacity:0}to{opacity:1}}
    @keyframes ncSU{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
    .nc-modal{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:40px 36px;width:100%;max-width:520px;box-shadow:0 24px 64px rgba(0,0,0,.2);animation:ncSU .28s cubic-bezier(.34,1.56,.64,1) both;font-family:'DM Sans',system-ui,sans-serif;}
    .nc-logo{font-size:2.2rem;margin-bottom:14px;}
    .nc-modal h2{font-size:1.2rem;font-weight:800;color:#0f172a;margin-bottom:10px;letter-spacing:-.02em;}
    .nc-modal p{font-size:.84rem;color:#64748b;line-height:1.65;margin-bottom:18px;}
    .nc-field{margin-bottom:18px;}
    .nc-field label{display:block;font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:7px;}
    .nc-field input[type="url"]{width:100%;padding:10px 13px;border:1.5px solid #cbd5e1;border-radius:8px;font-family:inherit;font-size:.84rem;color:#0f172a;background:#f8fafc;outline:none;transition:border-color .15s,box-shadow .15s;}
    .nc-field input[type="url"]:focus{border-color:#3b82f6;background:#fff;box-shadow:0 0 0 3px rgba(37,99,235,.12);}
    .nc-hint{font-size:.75rem;margin-top:5px;min-height:16px;font-weight:600;}
    .nc-btn-primary{width:100%;padding:12px;background:linear-gradient(135deg,#2563eb,#3b82f6);color:white;border:none;border-radius:8px;font-family:inherit;font-size:.9rem;font-weight:700;cursor:pointer;box-shadow:0 2px 10px rgba(37,99,235,.3);transition:filter .12s,transform .1s;}
    .nc-btn-primary:hover:not(:disabled){filter:brightness(1.07);transform:translateY(-1px);}
    .nc-btn-primary:disabled{opacity:.45;cursor:not-allowed;transform:none;}
    .nc-btn-ghost{width:100%;padding:10px;background:transparent;color:#334155;border:1.5px solid #cbd5e1;border-radius:8px;font-family:inherit;font-size:.85rem;font-weight:600;cursor:pointer;}
    .nc-btn-ghost:hover{background:#f1f5f9;}
    .nc-divider{display:flex;align-items:center;gap:12px;margin:20px 0;color:#94a3b8;font-size:.75rem;}
    .nc-divider::before,.nc-divider::after{content:'';flex:1;border-top:1px solid #e2e8f0;}
    .nc-dropzone{border:2px dashed #cbd5e1;border-radius:10px;padding:28px 20px;text-align:center;cursor:pointer;background:#f8fafc;margin-bottom:14px;transition:border-color .15s,background .15s;}
    .nc-dropzone:hover,.nc-dropzone.nc-drag-over{border-color:#3b82f6;background:#dbeafe;}
    .nc-dropzone input[type="file"]{display:none;}
    .nc-tip{background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;font-size:.76rem!important;color:#475569!important;line-height:1.6!important;margin-top:18px;margin-bottom:0!important;}
    .nc-status-bar{display:inline-flex;align-items:center;gap:6px;font-size:.72rem;font-family:'DM Mono',monospace;}
    .nc-status-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}
    .nc-status-dot.ok{background:#059669;}
    .nc-status-dot.error{background:#dc2626;animation:ncP 1.5s infinite;}
    .nc-status-dot.loading{background:#d97706;animation:ncP 1s infinite;}
    @keyframes ncP{0%,100%{opacity:1}50%{opacity:.3}}
  `;
  document.head.appendChild(s);
}
