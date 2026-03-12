/**
 * novus-core.js — Shared utilities for Novus Foods 1730 Ops Hub
 * Fully client-side. No server required. Safe for GitHub Pages.
 */
window.NovusCore = (() => {

  /* Auth guard */
  function requireAuth() {
    try {
      const raw = sessionStorage.getItem('novus1730_user');
      if (!raw) { window.location.replace('index.html'); return null; }
      const user = JSON.parse(raw);
      if (!user || user.plant !== '1730') { window.location.replace('index.html'); return null; }
      return user;
    } catch (_) { window.location.replace('index.html'); return null; }
  }

  /* Navigation */
  function navigateTo(page) {
    if (page === 'index.html') {
      try { sessionStorage.removeItem('novus1730_user'); } catch (_) {}
    }
    window.location.href = page;
  }

  /* Toast notifications */
  const Toast = (() => {
    let container;
    function getContainer() {
      if (!container) {
        container = document.createElement('div');
        Object.assign(container.style, {
          position:'fixed', bottom:'24px', right:'24px',
          display:'flex', flexDirection:'column', gap:'10px',
          zIndex:'9999', pointerEvents:'none'
        });
        document.body.appendChild(container);
      }
      return container;
    }
    function show(message, type) {
      const cfg = {
        success:{ bg:'#059669', icon:'✓' },
        warning:{ bg:'#d97706', icon:'⚠' },
        error:  { bg:'#dc2626', icon:'✕' },
        info:   { bg:'#2563eb', icon:'ℹ' }
      }[type] || { bg:'#2563eb', icon:'ℹ' };
      const t = document.createElement('div');
      Object.assign(t.style, {
        background:cfg.bg, color:'white', padding:'10px 16px',
        borderRadius:'9px', fontFamily:"'DM Sans',system-ui,sans-serif",
        fontSize:'13px', fontWeight:'600', boxShadow:'0 4px 16px rgba(0,0,0,.18)',
        opacity:'0', transform:'translateX(20px)',
        transition:'all .2s cubic-bezier(.34,1.56,.64,1)',
        pointerEvents:'auto', maxWidth:'320px', lineHeight:'1.45'
      });
      t.textContent = cfg.icon + '  ' + message;
      getContainer().appendChild(t);
      requestAnimationFrame(() => { t.style.opacity='1'; t.style.transform='translateX(0)'; });
      setTimeout(() => {
        t.style.opacity='0'; t.style.transform='translateX(20px)';
        setTimeout(() => t.remove(), 250);
      }, 3200);
    }
    return {
      success: m => show(m,'success'),
      warning: m => show(m,'warning'),
      error:   m => show(m,'error'),
      info:    m => show(m,'info')
    };
  })();

  /* Button loader */
  const BtnLoader = {
    start(btn) {
      btn._origHTML = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span style="display:inline-block;width:13px;height:13px;border:2px solid rgba(255,255,255,.4);border-top-color:white;border-radius:50%;animation:nc-spin .6s linear infinite;vertical-align:middle;margin-right:6px;"></span>Processing…';
      if (!document.getElementById('nc-spin-style')) {
        const s = document.createElement('style');
        s.id = 'nc-spin-style';
        s.textContent = '@keyframes nc-spin{to{transform:rotate(360deg)}}';
        document.head.appendChild(s);
      }
    },
    stop(btn) {
      btn.disabled = false;
      if (btn._origHTML !== undefined) btn.innerHTML = btn._origHTML;
    }
  };

  /* Read a File object as ArrayBuffer */
  function readFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) { reject(new Error('No file provided')); return; }
      const r = new FileReader();
      r.onload  = e => resolve(e.target.result);
      r.onerror = () => reject(new Error('File read failed'));
      r.readAsArrayBuffer(file);
    });
  }

  return { requireAuth, navigateTo, Toast, BtnLoader, readFile };
})();
