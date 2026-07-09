/* ======================================================
   JJ Paper — Toast Notifications
   ====================================================== */

function showToast(msg, type = 'ok', dur = 3000) {
  const tc = document.getElementById('toastC');
  if (!tc) return;
  // Región viva: los lectores de pantalla anuncian cada toast al insertarse
  if (!tc.hasAttribute('aria-live')) {
    tc.setAttribute('role', 'status');
    tc.setAttribute('aria-live', 'polite');
    tc.setAttribute('aria-atomic', 'false');
  }
  const t = document.createElement('div');
  t.className = `toast${type === 'err' ? ' err' : type === 'warn' ? ' warn' : ''}`;
  const icon = type === 'err' ? '❌' : type === 'warn' ? '⚠️' : '✅';
  const txt = document.createElement('span');
  txt.textContent = msg;   // textContent: nombres de producto u otros datos nunca se interpretan como HTML
  t.innerHTML = `<span>${icon}</span>`;
  t.appendChild(txt);
  tc.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .3s, transform .3s';
    t.style.opacity = '0';
    t.style.transform = 'translateX(110%)';
    setTimeout(() => t.remove(), 320);
  }, dur);
}
