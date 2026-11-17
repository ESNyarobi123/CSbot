const paths = {
  logo: '<path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8 8 0 0 1-3-.6L5 20l1.4-3.8A7.5 7.5 0 1 1 20 11.5Z"/><path d="M9 11h6m-6 3h3"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.3"/><rect x="14" y="3" width="7" height="7" rx="1.3"/><rect x="3" y="14" width="7" height="7" rx="1.3"/><rect x="14" y="14" width="7" height="7" rx="1.3"/>',
  inbox:
    '<path d="M21 11.5a8.4 8.4 0 0 1-8.6 8.2 10 10 0 0 1-3.2-.5L3 21l1.8-5A8.3 8.3 0 1 1 21 11.5Z"/><path d="M8.5 11.5h7"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
  bag: '<path d="M4.5 8h15L21 21H3L4.5 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/>',
  book: '<path d="M12 6v15m0-15C9.3 3.6 6 3.1 2.5 4.3v14.1c3.5-1.2 6.8-.7 9.5 1.6m0-14c2.7-2.4 6-2.9 9.5-1.7v14.1c-3.5-1.2-6.8-.7-9.5 1.6"/>',
  box: '<path d="m12 3 8.5 4.7v8.6L12 21l-8.5-4.7V7.7L12 3Z"/><path d="m3.5 7.7 8.5 4.8 8.5-4.8M12 12.5V21M7.8 5.4l8.4 4.7"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.2"/><path d="m16 16 4 4"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  bars: '<path d="M4 20V9h4v11m2 0V4h4v16m2 0v-7h4v7M2 20h20"/>',
  chart: '<path d="M20 12a8 8 0 1 1-8-8v8h8Z"/><path d="M16 3.7a6 6 0 0 1 4.3 4.3H16V3.7Z"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4m0 4h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4m8-4v4M3 11h18"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  link: '<path d="m10 13 4-4m-6 6-1 1a3 3 0 1 1-4.2-4.2l4-4a3 3 0 0 1 4.2 0m2-1 1-1a3 3 0 1 1 4.2 4.2l-4 4a3 3 0 0 1-4.2 0"/>',
  qr: '<path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h2v2h-2zm4 4h2v2h-2zM12 4v3m0 6v2m8-2v3m-6 5h2"/>',
  key: '<circle cx="8" cy="10" r="4.5"/><path d="m11.5 13 7 7m-2-2 2-2m-4 0 2-2"/>',
  logout: '<path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5m5-13 5 5-5 5m-5-5h10"/>',
  check: '<path d="m5 12 4 4 10-9"/>',
  refresh: '<path d="M4 12a8 8 0 0 1 14-5l2 2m0-5v5h-5m5 3a8 8 0 0 1-14 5l-2-2m0 5v-5h5"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="2.5" fill="white"/><circle cx="15" cy="17" r="2.5" fill="white"/>',
  pause: '<path d="M9 5v14m6-14v14"/>',
  play: '<path d="m8 5 12 7-12 7V5Z"/>',
  send: '<path d="m21 3-6 18-4.4-7.6L3 9l18-6Zm0 0-10.4 10.4"/>',
  bot: '<rect x="3" y="8" width="18" height="12" rx="3"/><path d="M12 8V4m-2 0h4m-6 9h.01m8 0h.01M10 16h4"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M4.5 20v-1a5 5 0 0 1 5-5h5a5 5 0 0 1 5 5v1"/>',
  edit: '<path d="m14 6 4 4M4 20l4.5-1L20 7.4 16.6 4 5 15.5 4 20Z"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3m-4 4v3"/>',
  back: '<path d="m14 6-6 6 6 6"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 16-5-5-6 7-3-3-4 4"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M15 5H6a1 1 0 0 0-1 1v9"/>',
};
export const icon = (name, size = 18) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? ''}</svg>`;
export const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
export const nf = new Intl.NumberFormat('en-TZ');
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Counts numbers from zero once they are painted. It reads the final value from `data-count`,
 * so the markup still shows the real number when motion is reduced or JS is interrupted.
 */
export function countUp(scope = document) {
  if (reducedMotion()) return;
  scope.querySelectorAll('[data-count]').forEach((element, index) => {
    const target = Number(element.dataset.count);
    if (!Number.isFinite(target) || target <= 0) return;
    const plain = element.dataset.countFormat === 'plain';
    const start = performance.now() + Math.min(index, 6) * 45;
    element.textContent = '0';
    const tick = (now) => {
      if (!element.isConnected) return;
      const progress = Math.min(1, Math.max(0, (now - start) / 620));
      const eased = 1 - (1 - progress) ** 3;
      element.textContent = plain
        ? String(Math.round(target * eased))
        : nf.format(Math.round(target * eased));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Africa/Dar_es_Salaam',
});
const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Africa/Dar_es_Salaam',
});
export const dateLabel = (date) => (date ? dateFormatter.format(new Date(date)) : '—');
export const timeLabel = (date) => (date ? timeFormatter.format(new Date(date)) : '—');
export const phoneLabel = (phone) => (phone ? '+' + String(phone).replace(/^\+/, '') : '—');
export const customer = (chat) =>
  chat.customer_name || (chat.customer_phone ? phoneLabel(chat.customer_phone) : 'WhatsApp contact');
export const initials = (name) =>
  String(name ?? '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase() || 'WA';
export const btn = (label, symbol, attrs = '', type = 'secondary') =>
  `<button type="button" class="btn ${type}" ${attrs}>${symbol ? icon(symbol, 16) : ''}${esc(label)}</button>`;
export const heading = (title, subtitle, actions = '') =>
  `<div class="page-heading"><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>${actions ? `<div class="heading-actions">${actions}</div>` : ''}</div>`;
export const empty = (title, description, symbol, action = '') =>
  `<div class="empty"><span class="empty-icon">${icon(symbol, 23)}</span><strong>${esc(title)}</strong><p>${esc(description)}</p>${action}</div>`;
export const status = (account) =>
  !account.enabled
    ? { label: 'Paused', group: 'paused', tone: 'gray' }
    : ({
        connected: { label: 'Connected', group: 'connected', tone: 'green' },
        mock: { label: 'Test mode', group: 'connected', tone: 'blue' },
        pairing: { label: 'Ready to link', group: 'pending', tone: 'amber' },
        verifying: { label: 'Verifying device', group: 'pending', tone: 'blue' },
        connecting: { label: 'Connecting', group: 'pending', tone: 'blue' },
        reconnecting: { label: 'Reconnecting', group: 'pending', tone: 'amber' },
        logged_out: { label: 'Signed out', group: 'pending', tone: 'red' },
        wrong_number: { label: 'Number mismatch', group: 'pending', tone: 'red' },
        blocked: { label: 'Connection blocked', group: 'pending', tone: 'red' },
        replaced: { label: 'Session replaced', group: 'pending', tone: 'red' },
      }[account.status] ?? { label: 'Disconnected', group: 'pending', tone: 'gray' });
export const pill = (label, tone = 'gray', dot = true) =>
  `<span class="pill ${tone}">${dot ? '<span class="pill-dot"></span>' : ''}${esc(label)}</span>`;
export const accountPill = (account) => pill(status(account).label, status(account).tone);
export const stages = {
  inquiry: ['Inquiry', 'gray'],
  quoted: ['Quoted', 'blue'],
  ready_to_pay: ['Ready to pay', 'amber'],
  payment_reported: ['Payment reported', 'amber'],
  paid: ['Paid', 'green'],
  completed: ['Completed', 'green'],
};
export const stagePill = (key) => pill(...(stages[key] ?? stages.inquiry), false);

// Reads can recover from a momentary connection loss. Mutations keep their original outcome.
export async function request(path, options = {}) {
  const { method = 'GET', data, signal, auth = true } = options;
  const attempts = method === 'GET' ? 2 : 1;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    signal?.throwIfAborted();
    const deadline = AbortSignal.timeout(9000);
    const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let response;
    try {
      response = await fetch(path, {
        method,
        signal: requestSignal,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-CSbot-Dashboard': '1', ...(data ? { 'Content-Type': 'application/json' } : {}) },
        body: data ? JSON.stringify(data) : undefined,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (attempt === attempts) throw new Error('CSbot did not respond. Try again.');
    }
    if (attempt < attempts && (!response || [500, 502, 503, 504].includes(response.status))) {
      await response?.body?.cancel().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 300));
      continue;
    }
    const value = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && auth) window.dispatchEvent(new Event('csbot:expired'));
      throw new Error(
        Array.isArray(value.message)
          ? value.message.join(' · ')
          : value.message || `Request failed (${response.status})`,
      );
    }
    return value;
  }
}
export const api = (route, options) => request('/v1' + route, options);
export function notify(message, error = false) {
  const stack = document.querySelector('#notifications');
  const item = document.createElement('div');
  item.className = 'toast' + (error ? ' error' : '');
  item.style.setProperty('--toast-life', '4300ms');
  item.innerHTML =
    icon(error ? 'alert' : 'check', 18) + '<span>' + esc(message) + '</span><i class="toast-bar"></i>';
  stack.append(item);
  while (stack.childElementCount > 4) stack.firstElementChild.remove();
  setTimeout(() => {
    item.classList.add('leaving');
    setTimeout(() => item.remove(), 220);
  }, 4300);
}
const modal = document.querySelector('#modal');
let cleanupModal;
function releaseModal() {
  const cleanup = cleanupModal;
  cleanupModal = undefined;
  cleanup?.();
}
modal.addEventListener('close', () => {
  if (!modal.open) releaseModal();
});
export function closeModal() {
  releaseModal();
  if (modal.open) modal.close();
}
export function showModal(title, subtitle, content, close) {
  closeModal();
  modal.innerHTML = `<div class="modal-heading"><div><h2 id="modal-title">${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
    <button type="button" class="icon-btn dismiss" aria-label="Close dialog">${icon('close', 19)}</button></div><div class="modal-body">${content}</div>`;
  modal.querySelector('.dismiss').onclick = closeModal;
  cleanupModal = close;
  modal.showModal();
  return modal;
}
export const slug = (value) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 47);
export function formData(form) {
  return Object.fromEntries(new FormData(form));
}
export function formError(form, message) {
  form.querySelector('.form-error').textContent = message;
}
export function lockForm(form, busy) {
  form.querySelector('button[type="submit"]').disabled = busy;
}
