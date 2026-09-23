export function el(tag, attrs, ...children) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className') e.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'htmlFor') e.htmlFor = v;
      else if (k === 'disabled' || k === 'checked' || k === 'selected' || k === 'hidden') e[k] = v;
      else e.setAttribute(k, v);
    }
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    if (typeof c === 'string' || typeof c === 'number') e.appendChild(document.createTextNode(String(c)));
    else if (c instanceof Node) e.appendChild(c);
    else if (Array.isArray(c)) c.forEach((cc) => { if (cc instanceof Node) e.appendChild(cc); });
  }
  return e;
}

export function clearEl(container) {
  container.innerHTML = '';
}

export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function numOrBlank(v) {
  return v === null || v === undefined || v === '' ? '' : v;
}

// Numeric comparison for linked values ('0.15' vs 0.150 is not a change).
// Blank counts as 0, the same way the calcs read it (parseFloat(v) || 0).
export function sameNumber(a, b, tol) {
  const x = parseFloat(a) || 0, y = parseFloat(b) || 0;
  return Math.abs(x - y) <= (tol != null ? tol : 0.005);
}

export function sanitizeProjectNumber(raw) {
  return raw.replace(/[^A-Za-z0-9_\-.]/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '') || 'unnamed';
}

let toastContainer;
export function showToast(msg, type) {
  if (!toastContainer) {
    toastContainer = el('div', { className: 'toast-container' });
    document.body.appendChild(toastContainer);
  }
  const t = el('div', { className: 'toast toast-' + (type || 'success') }, msg);
  toastContainer.appendChild(t);
  setTimeout(() => { t.remove(); }, 4000);
}
