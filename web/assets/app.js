import { request, icon, esc, empty, closeModal, notify } from './ui.js';
import { overview } from './overview.js';
import { numbers } from './numbers.js';
import { inbox } from './inbox.js';
import { collection, sales } from './records.js';
import { devices } from './devices.js';
import { studio } from './studio.js';

const app = document.querySelector('#app');
const nav = [
  ['overview', 'Overview', 'grid'],
  ['inbox', 'Inbox', 'inbox'],
  ['studio', 'Studio', 'bot'],
  ['numbers', 'WhatsApp numbers', 'phone'],
  ['sales', 'Sales', 'bag'],
  ['knowledge', 'Knowledge', 'book'],
  ['products', 'Products', 'box'],
  ['devices', 'Devices', 'settings'],
];
let authorized = false;
let loading;
let globalQuery = '';
let page;

const brand = () =>
  `<a href="#overview" class="brand" aria-label="CSbot overview"><span class="brand-mark">${icon('logo', 23)}</span><span>CSbot</span></a>`;

function login(expired = false, issue = '') {
  authorized = false;
  loading?.abort();
  closeModal();
  app.removeAttribute('aria-busy');
  app.innerHTML = `<div class="login-layout">
    <section class="login-visual"><div class="login-brand">${brand()}</div>
      <div class="login-preview" aria-hidden="true">
        <div class="preview-top"><i></i><i></i><i></i></div><div class="preview-screen">
          <div class="preview-mini-side"><span></span><span></span><span></span><span></span><span></span></div>
          <div class="preview-main"><div class="preview-mini-card"><i></i><i></i><i></i></div>
            <div class="preview-bars"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
            <div class="preview-mini-rows"><span></span><span></span><span></span></div></div>
        </div><span class="preview-float"><span class="channel-icon">${icon('inbox', 22)}</span><span><b>WhatsApp inbox</b><small>Customer conversations</small></span></span>
      </div>
      <div class="login-intro"><h2>Every number.<br>One workspace.</h2><p>Manage WhatsApp conversations, linked numbers and sales for Connect Solution.</p></div>
    </section>
    <section class="login-panel"><div class="login-form-wrap"><div class="desktop-hide">${brand()}</div><span class="login-lock">${icon('lock', 25)}</span>
      <h1>Welcome to CSbot</h1><p>Enter your admin access token to open the workspace.</p>
      <form class="form-stack" id="login-form">
        <label>Admin access token<input type="password" name="token" required autocomplete="current-password" spellcheck="false" placeholder="Enter your access token"></label>
        <p class="form-error" role="alert">${esc(expired ? 'Your session ended. Sign in again to continue.' : issue)}</p>
        <button class="btn primary" type="submit">Sign in ${icon('arrow', 17)}</button>
      </form><small>Use <code>ADMIN_API_TOKEN</code> from your local <code>.env</code> file.</small>
    </div></section>
  </div>`;
  const form = app.querySelector('#login-form');
  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    const message = form.querySelector('.form-error');
    const input = form.querySelector('input');
    button.disabled = true;
    message.textContent = '';
    try {
      await request('/dashboard/session', {
        method: 'POST',
        data: { token: input.value.trim() },
        auth: false,
      });
      input.value = '';
      authorized = true;
      shell();
    } catch (error) {
      message.textContent = error.message;
      button.disabled = false;
      input.focus();
    }
  };
}

function shell() {
  app.removeAttribute('aria-busy');
  app.innerHTML = `<div class="workspace">
    <aside class="sidebar" id="site-nav">
      <div class="sidebar-brand">${brand()}<button class="icon-btn desktop-hide" data-nav-close aria-label="Close navigation">${icon('close', 19)}</button></div>
      <div class="workspace-card"><span class="workspace-initials">CS</span><div><b>Connect Solution</b><small>Admin workspace</small></div></div>
      <nav aria-label="Admin navigation">
        <span class="nav-label">WORKSPACE</span>
        ${nav.slice(0, 5).map(navLink).join('')}
        <span class="nav-label spaced">BOT CONTENT</span>
        ${nav.slice(5).map(navLink).join('')}
      </nav>
      <div class="sidebar-bottom"><span class="admin-avatar">CS</span><div><b>Administrator</b><small>CSbot workspace</small></div>
        <button class="icon-btn" title="Sign out" aria-label="Sign out" data-logout>${icon('logout', 17)}</button></div>
    </aside>
    <button type="button" class="nav-cover" title="Close navigation" aria-label="Close navigation"></button>
    <div class="workspace-main">
      <header class="topbar"><div class="breadcrumb"><button class="icon-btn desktop-hide" data-menu aria-controls="site-nav" aria-expanded="false" aria-label="Open navigation">${icon('menu', 22)}</button>
        <span>Workspace</span>${icon('chevron', 13)}<b id="breadcrumb">Overview</b></div>
        <div class="topbar-actions">
          <form id="global-search" class="global-search">${icon('search', 17)}<input type="search" placeholder="Search conversations…" aria-label="Search conversations across all numbers" maxlength="80"><kbd>⌘ K</kbd></form>
          <a class="icon-btn top-inbox" href="#inbox/human" aria-label="Chats that need a human" title="Chats that need a human">${icon('inbox', 19)}</a>
          <button class="avatar-button" aria-label="Sign out of CSbot" title="Sign out" data-logout><span class="admin-avatar">CS</span></button>
        </div>
      </header>
      <div class="page" id="page" role="region" aria-label="Current page"></div>
    </div></div>`;
  const workspace = app.querySelector('.workspace');
  const menu = app.querySelector('[data-menu]');
  const closeNav = () => {
    workspace.classList.remove('nav-open');
    menu.setAttribute('aria-expanded', 'false');
  };
  menu.onclick = () => {
    workspace.classList.add('nav-open');
    menu.setAttribute('aria-expanded', 'true');
  };
  app.querySelector('[data-nav-close]').onclick = closeNav;
  app.querySelector('.nav-cover').onclick = closeNav;
  app.querySelectorAll('nav a').forEach((link) => link.addEventListener('click', closeNav));
  const form = app.querySelector('#global-search');
  const input = form.querySelector('input');
  form.onsubmit = (event) => {
    event.preventDefault();
    globalQuery = input.value.trim();
    if (location.hash === '#inbox') void render();
    else location.hash = 'inbox';
    input.value = '';
  };
  app.querySelectorAll('[data-logout]').forEach(
    (button) =>
      (button.onclick = async () => {
        try {
          await request('/dashboard/session/logout', { method: 'POST', auth: false });
          login();
        } catch (error) {
          notify(error.message, true);
        }
      }),
  );
  page = app.querySelector('#page');
  void render();
}
function navLink([id, label, symbol]) {
  return `<a href="#${id}" data-nav="${id}">${icon(symbol, 18)}<span>${esc(label)}</span></a>`;
}

async function render() {
  if (!authorized) return;
  closeModal();
  loading?.abort();
  loading = new AbortController();
  const { signal } = loading;
  const [route, ...segments] = location.hash.slice(1).split('/');
  const item = nav.find(([id]) => id === route) ?? nav[0];
  app.querySelector('#breadcrumb').textContent = item[1];
  app.querySelectorAll('[data-nav]').forEach((link) => {
    const selected = link.dataset.nav === item[0];
    link.classList.toggle('active', selected);
    if (selected) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  page.setAttribute('aria-busy', 'true');
  page.removeAttribute('data-ready');
  page.innerHTML = `<span class="sr-only" role="status">Loading ${esc(item[1])}…</span>
    <div class="page-skeleton" aria-hidden="true"><i></i><div><i></i><i></i><i></i></div><i></i></div>`;
  window.scrollTo(0, 0);
  try {
    switch (item[0]) {
      case 'numbers':
        await numbers(page, signal, segments[0]);
        break;
      case 'inbox': {
        const query = globalQuery;
        globalQuery = '';
        await inbox(page, signal, segments, query);
        break;
      }
      case 'sales':
        await sales(page, signal, segments);
        break;
      case 'studio':
        await studio(page, signal);
        break;
      case 'knowledge':
      case 'products':
        await collection(page, signal, item[0]);
        break;
      case 'devices':
        await devices(page, signal);
        break;
      default:
        await overview(page, signal);
    }
  } catch (error) {
    if (!signal.aborted) {
      page.innerHTML = `<section class="card">${empty(
        'Couldn’t load this page',
        error.message,
        'alert',
        '<button class="btn secondary" data-reload>Try again</button>',
      )}</section>`;
      page.querySelector('[data-reload]').onclick = () => void render();
    }
  } finally {
    if (!signal.aborted) {
      page.removeAttribute('aria-busy');
      page.setAttribute('data-ready', item[0]);
    }
  }
}

window.addEventListener('hashchange', () => void render());
window.addEventListener('csbot:expired', () => {
  if (authorized) login(true);
});
window.addEventListener('keydown', (event) => {
  if (authorized && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    app.querySelector('#global-search input')?.focus();
  }
});
try {
  const session = await request('/dashboard/session', { auth: false });
  if (session.authenticated) {
    authorized = true;
    shell();
  } else login();
} catch (error) {
  login(false, error.message);
}
