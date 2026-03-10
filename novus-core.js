/* ═══════════════════════════════════════════════════════════════
   novus-core.js  —  Novus Foods 1730 Ops Hub
   v6.0 — Hardcoded OneDrive direct download
          + 30-min auto-refresh
          + manual upload fallback
═══════════════════════════════════════════════════════════════ */

/* ── DATA SOURCE ──────────────────────────────────────────── */
const NOVUS_DATA_URL     = 'https://lakeviewfarms1600-my.sharepoint.com/:x:/g/personal/amendoza_novusfoods_com/IQBnBa_TBRLGSKNIuPokwIY5AbZ17FdLp9cfw2v2FM89szA?download=1';

/* ── STORAGE KEYS ─────────────────────────────────────────── */
const NOVUS_CACHE_KEY    = 'novus_xlsx_b64';
const NOVUS_CACHE_TS_KEY = 'novus_xlsx_ts';
const NOVUS_CACHE_MAX_MS = 30 * 60 * 1000;   // 30 minutes

/* ── PUBLIC API ───────────────────────────────────────────── */
window.NovusCore = window.NovusCore || {};

/* ─────────────────────────────────────────────────────────────
   getDataBuffer()
   1. Fresh localStorage cache (< 30 min) → return immediately
   2. Fetch from hardcoded OneDrive URL   → cache + return
   3. Fetch fails                         → fallback upload modal
─────────────────────────────────────────────────────────────── */
NovusCore.getDataBuffer = function () {
  return new Promise(async (resolve, reject) => {

    /* 1 — Fresh cache */
    const cachedB64 = localStorage.getItem(NOVUS_CACHE_KEY);
    const cachedTs  = parseInt(localStorage.getItem(NOVUS_CACHE_TS_KEY) || '0', 10);
    if (cachedB64 && (Date.now() - cachedTs) < NOVUS_CACHE_MAX_MS) {
      try { resolve(_b64ToBuffer(cachedB64)); return; }
      catch (_) { _clearCache(); }
    }

    /* 2 — Fetch from OneDrive */
    try {
      const buf = await _fetchFile();
      _cacheBuffer(buf);
      resolve(buf);
    } catch (err) {
      console.warn('[NovusCore] Fetch failed:', err.message);
      /* 3 — Fallback upload modal */
      _showFallbackModal(err.message, resolve, reject);
    }
  });
};

/* ─────────────────────────────────────────────────────────────
   startAutoRefresh(reloadFn)
   Re-fetches every 30 min silently. Shows countdown in nav.
─────────────────────────────────────────────────────────────── */
NovusCore.startAutoRefresh = function (reloadFn) {
  if (window._novusRefreshTimer)   clearInterval(window._novusRefreshTimer);
  if (window._novusCountdownTimer) clearInterval(window._novusCountdownTimer);

  let nextAt = Date.now() + NOVUS_CACHE_MAX_MS;

  /* Live countdown */
  window._novusCountdownTimer = setInterval(() => {
    const el = document.getElementById('nc-countdown');
    if (!el) return;
    const rem = Math.max(0, nextAt - Date.now());
    const m = Math.floor(rem / 60000);
    const s = Math.floor((rem % 60000) / 1000);
    el.textContent = `↻ ${m}:${String(s).padStart(2,'0')}`;
  }, 1000);

  /* Auto-refresh every 30 min */
  window._novusRefreshTimer = setInterval(async () => {
    const st = document.getElementById('nc-live-status');
    if (st) NovusCore.setStatus(st, 'loading', 'Refreshing…');
    try {
      const buf = await _fetchFile();
      _cacheBuffer(buf);
      nextAt = Date.now() + NOVUS_CACHE_MAX_MS;
      if (st) NovusCore.setStatus(st, 'ok', '✓ Live');
      NovusCore.Toast.info('Data refreshed ✓');
      if (typeof reloadFn === 'function') reloadFn(buf);
    } catch (err) {
      console.warn('[NovusCore] Auto-refresh failed:', err);
      if (st) NovusCore.setStatus(st, 'error', '⚠ Refresh failed — using cached data');
    }
  }, NOVUS_CACHE_MAX_MS);
};

/* ── Helpers ──────────────────────────────────────────────── */
NovusCore.forceRefresh = function () { _clearCache(); location.reload(); };
NovusCore.navigateTo   = href => { window.location.href = href; };

NovusCore.navStatusHTML = () => `
  <span id="nc-live-status" style="font-size:.7rem;font-family:'DM Mono',monospace;margin-right:4px;"></span>
  <span id="nc-countdown"   style="font-size:.68rem;font-family:'DM Mono',monospace;color:#94a3b8;margin-right:8px;"></span>`;

/* ── Toast ────────────────────────────────────────────────── */
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
    try {
      _clearCache();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      localStorage.setItem(NOVUS_CACHE_KEY, b64);
      localStorage.setItem(NOVUS_CACHE_TS_KEY, String(Date.now()));
    } catch (_) {
      console.warn('[NovusCore] localStorage quota exceeded — cache skipped.');
    }
  }
}

function _b64ToBuffer(b64) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

async function _fetchFile() {
  const resp = await fetch(NOVUS_DATA_URL, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
  const buf = await resp.arrayBuffer();
  if (buf.byteLength < 200) throw new Error('Response too small — check the share link');
  return buf;
}

/* ── FALLBACK UPLOAD MODAL ────────────────────────────────── */
function _showFallbackModal(reason, resolve, reject) {
  _injectStyles();
  const ov = _makeOverlay();
  ov.innerHTML = `
    <div class="nc-modal">
      <div class="nc-logo">⚠️</div>
      <h2>Could Not Load Data</h2>
      <p style="color:#dc2626;font-size:.82rem;margin-bottom:8px;">
        Auto-fetch failed: <strong>${reason}</strong>
      </p>
      <p>This usually means the share link expired or network access is unavailable.
         Upload the file manually to continue.</p>
      <div class="nc-dropzone" id="nc-fb-dz"
           onclick="document.getElementById('nc-fb-fi').click()">
        <input type="file" id="nc-fb-fi" accept=".xlsx,.xls"/>
        <div style="font-size:1.5rem;margin-bottom:8px">📁</div>
        <div style="font-size:.88rem;font-weight:600;color:#334155">
          Click to browse or drag &amp; drop
        </div>
        <div style="font-size:.75rem;color:#94a3b8;margin-top:4px">
          all_department_data_2026.xlsx
        </div>
        <div id="nc-fb-chosen"
             style="display:none;font-size:.8rem;color:#059669;font-weight:700;margin-top:10px">
        </div>
      </div>
      <p class="nc-tip">
        💡 <strong>Permanent fix:</strong> The share link may have expired.
        Generate a new "Anyone with the link" share URL from SharePoint
        and update <code>NOVUS_DATA_URL</code> in <code>novus-core.js</code>.
      </p>
    </div>`;
  document.body.appendChild(ov);

  const fi  = ov.querySelector('#nc-fb-fi');
  const dz  = ov.querySelector('#nc-fb-dz');
  const cho = ov.querySelector('#nc-fb-chosen');

  function loadFile(f) {
    if (!f) return;
    cho.textContent = '✓ ' + f.name;
    cho.style.display = 'block';
    dz.style.borderColor = '#059669';
    const r = new FileReader();
    r.onload = e => { ov.remove(); resolve(e.target.result); };
    r.readAsArrayBuffer(f);
  }
  fi.addEventListener('change', () => loadFile(fi.files[0]));
  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('nc-drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('nc-drag-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('nc-drag-over');
    loadFile(e.dataTransfer.files[0]);
  });
}

function _makeOverlay() {
  const el = document.createElement('div');
  el.className = 'nc-overlay';
  return el;
}

let _styled = false;
function _injectStyles() {
  if (_styled) return; _styled = true;
  const s = document.createElement('style');
  s.textContent = `
    .nc-overlay{position:fixed;inset:0;background:rgba(15,23,42,.6);backdrop-filter:blur(6px);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;animation:ncFI .2s ease both;}
    @keyframes ncFI{from{opacity:0}to{opacity:1}}
    @keyframes ncSU{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
    .nc-modal{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:40px 36px;width:100%;max-width:500px;box-shadow:0 24px 64px rgba(0,0,0,.2);animation:ncSU .28s cubic-bezier(.34,1.56,.64,1) both;font-family:'DM Sans',system-ui,sans-serif;}
    .nc-logo{font-size:2.2rem;margin-bottom:14px;}
    .nc-modal h2{font-size:1.2rem;font-weight:800;color:#0f172a;margin-bottom:10px;letter-spacing:-.02em;}
    .nc-modal p{font-size:.84rem;color:#64748b;line-height:1.65;margin-bottom:16px;}
    .nc-modal code{background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:.78rem;color:#0f172a;}
    .nc-dropzone{border:2px dashed #cbd5e1;border-radius:10px;padding:30px 20px;text-align:center;cursor:pointer;background:#f8fafc;margin-bottom:16px;transition:border-color .15s,background .15s;}
    .nc-dropzone:hover,.nc-dropzone.nc-drag-over{border-color:#3b82f6;background:#dbeafe;}
    .nc-dropzone input[type="file"]{display:none;}
    .nc-tip{background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;font-size:.76rem!important;color:#475569!important;line-height:1.6!important;margin-bottom:0!important;}
    .nc-status-bar{display:inline-flex;align-items:center;gap:6px;font-size:.72rem;font-family:'DM Mono',monospace;}
    .nc-status-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}
    .nc-status-dot.ok{background:#059669;}
    .nc-status-dot.error{background:#dc2626;animation:ncP 1.5s infinite;}
    .nc-status-dot.loading{background:#d97706;animation:ncP 1s infinite;}
    @keyframes ncP{0%,100%{opacity:1}50%{opacity:.3}}
  `;
  document.head.appendChild(s);
}
