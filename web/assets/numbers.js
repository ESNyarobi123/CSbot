import {
  api,
  icon,
  esc,
  btn,
  heading,
  empty,
  status,
  accountPill,
  phoneLabel,
  showModal,
  closeModal,
  notify,
  slug,
  formData,
  formError,
  lockForm,
  countUp,
} from './ui.js';
import { connectedDevice, linkPanel, linkSteps, testMessage } from './link-device.js';

const blockedStates = new Set(['logged_out', 'wrong_number', 'blocked', 'replaced']);

function phoneInput(value) {
  const number = value.replace(/[\s().-]/g, '');
  if (!/^\+?[1-9]\d{6,14}$/.test(number))
    throw new Error('Enter a number with its country code, for example +255700000000.');
  return number.startsWith('+') ? number : '+' + number;
}

function openAdd(afterSave) {
  const modal = showModal(
    'Add WhatsApp number',
    'Name the number, then link the phone. You can leave the number blank and CSbot will learn it when you scan.',
    `
    <form id="add-number-form" class="form-stack">
      <label>Number label<input name="label" required maxlength="100" placeholder="e.g. Customer Support" autocomplete="organization-title" autofocus></label>
      <label><span class="label-row">WhatsApp number <span class="optional">optional</span></span><input name="phone" type="tel" maxlength="30" placeholder="+255 700 000 000" autocomplete="tel"><small>Include the country code if you add it now. With QR linking, leaving it empty is fine.</small></label>
      <div class="pair-info">${icon('link', 18)}<span>After saving, link this number using WhatsApp on its phone.</span></div>
      <p class="form-error" role="alert"></p>
      <div class="modal-actions"><button class="btn secondary" type="button" data-cancel>Cancel</button><button class="btn primary" type="submit">${icon('plus', 16)} Add number</button></div>
    </form>`,
  );
  modal.querySelector('[data-cancel]').onclick = closeModal;
  const form = modal.querySelector('form');
  form.onsubmit = async (event) => {
    event.preventDefault();
    lockForm(form, true);
    formError(form, '');
    try {
      const fields = formData(form);
      const phone = fields.phone.trim() ? phoneInput(fields.phone) : undefined;
      const label = fields.label.trim();
      if (!label) throw new Error('Enter a label for this number.');
      const id = (slug(label).slice(0, 36) || 'whatsapp') + '-' + crypto.randomUUID().slice(0, 7);
      const created = await api('/accounts', {
        method: 'POST',
        data: { id, label, ...(phone ? { phone } : {}) },
      });
      notify('Number added. Link its device to start replying.');
      closeModal();
      void afterSave(created);
    } catch (error) {
      formError(form, error.message);
    } finally {
      lockForm(form, false);
    }
  };
}

function manageAccount(account, refresh) {
  let current = { ...account };
  let method = account.pairing && account.phone ? 'code' : 'qr';
  let tab = 'connection';
  let previousPairing = '';
  let latestState = { status: account.status };
  let expires = 0;
  let codeExpires = 0;
  let fault = false;
  let timer;
  let clock;
  let polls;
  const modal = showModal(
    account.label,
    account.phone ? phoneLabel(account.phone) : 'The number is learned when this phone links.',
    `
    <div class="line-tabs" aria-label="Number settings"><button class="selected" data-tab="connection">Connection</button><button data-tab="admins">Admin alerts</button></div>
    <div id="number-pane"></div>`,
    () => {
      clearTimeout(timer);
      clearInterval(clock);
      polls?.abort();
    },
  );
  const pane = modal.querySelector('#number-pane');
  const route = '/accounts/' + encodeURIComponent(account.id);

  async function pairingView() {
    if (!modal.open || tab !== 'connection' || current.mode === 'mock') return;
    const latest = new AbortController();
    polls = latest;
    try {
      const result = await api(route + '/pairing', { signal: latest.signal });
      if (latest.signal.aborted || !modal.open || tab !== 'connection') return;
      const before = current.status;
      const enabledBefore = current.enabled;
      const workerBefore = latestState.workerHealthy;
      current.status = result.status;
      current.enabled = result.enabled;
      fault = false;
      latestState = result;
      expires = performance.now() + Number(result.qrRemainingMs || 0);
      codeExpires = performance.now() + Number(result.codeRemainingMs || 0);
      const fingerprint = [
        method,
        result.status,
        result.qrDataUrl,
        result.pairingCode,
        result.pairingState,
        result.gatewayHealthy,
        result.workerHealthy,
        result.enabled,
      ].join('|');
      if (fingerprint !== previousPairing) {
        previousPairing = fingerprint;
        if (
          before !== current.status ||
          enabledBefore !== current.enabled ||
          (current.status === 'connected' && workerBefore !== result.workerHealthy)
        ) {
          drawConnection();
          if (current.status === 'connected' && before !== current.status) {
            notify('WhatsApp number connected.');
            void refresh();
          }
        }
        drawLink();
      }
      updateQrClock();
    } catch (error) {
      if (!latest.signal.aborted && modal.open && tab === 'connection') {
        previousPairing = '';
        fault = true;
        if (pane.querySelector('[data-pairing]')) drawLink();
        else pane.querySelector('[data-number-error]').textContent = error.message;
      }
    } finally {
      if (!latest.signal.aborted && modal.open && tab === 'connection') timer = setTimeout(pairingView, 1500);
    }
  }
  function schedule() {
    clearTimeout(timer);
    polls?.abort();
    previousPairing = '';
    void pairingView();
  }
  function drawLink() {
    const area = pane.querySelector('[data-pairing]');
    if (!area) return;
    if (method === 'code' && !current.phone) method = 'qr';
    pane.querySelector('[data-link-steps]').innerHTML = linkSteps(current, latestState);
    area.innerHTML = linkPanel(method, latestState, fault);
    const retry = area.querySelector('[data-check-link]');
    if (retry) retry.onclick = schedule;
    const copyCode = area.querySelector('[data-copy-code]');
    if (copyCode)
      copyCode.onclick = async () => {
        try {
          await navigator.clipboard.writeText(latestState.pairingCode ?? '');
          notify('Pairing code copied.');
        } catch {
          notify('Select the code to copy it.', true);
        }
      };
    const codeButton = area.querySelector('[data-code]');
    if (codeButton)
      codeButton.onclick = async () => {
        codeButton.disabled = true;
        try {
          const result = await api(route + '/pairing-code', { method: 'POST' });
          if (!modal.open || tab !== 'connection') return;
          latestState = {
            ...latestState,
            pairingState: result.status === 'requested' ? 'requesting' : 'ready',
          };
          drawLink();
          schedule();
        } catch (error) {
          notify(error.message, true);
          codeButton.disabled = false;
        }
      };
  }
  function updateQrClock() {
    if (tab !== 'connection') return;
    const time = pane.querySelector('[data-qr-time]');
    if (time) {
      const remaining = Math.max(0, expires - performance.now());
      const interval = Math.max(1, Number(latestState.qrLifetimeMs) || 1);
      if (remaining <= 0) {
        latestState = { ...latestState, qrRemainingMs: 0 };
        drawLink();
        return;
      }
      const label = 'Refreshes in ' + Math.ceil(remaining / 1000) + 's';
      if (time.textContent !== label) time.textContent = label;
      pane.querySelector('.qr-progress i').style.width = Math.min(100, (remaining / interval) * 100) + '%';
    }
    const codeTime = pane.querySelector('[data-code-time]');
    if (codeTime) {
      const left = Math.max(0, codeExpires - performance.now());
      const label =
        left > 0
          ? `Code expires in ${Math.ceil(left / 1000)}s. Request a new one if it stops working.`
          : 'Code expired. Request a fresh code to continue.';
      if (codeTime.textContent !== label) codeTime.textContent = label;
    }
  }
  function drawConnection() {
    const connected = current.status === 'connected' || current.mode === 'mock';
    const blocked = blockedStates.has(current.status);
    pane.innerHTML = `<div class="connection-head"><span class="channel-icon">${icon('phone', 19)}</span><div><strong>Connection status</strong><small>${current.enabled ? 'This number can receive and reply when linked.' : 'Replies are paused for this number.'}</small></div>${accountPill(current)}</div>
      ${
        !current.enabled
          ? '<div class="pair-info"><span>Resume this number to reconnect its linked device.</span></div>'
          : connected
            ? current.mode === 'mock'
              ? `<div class="pair-info">${icon('check', 18)}<span>This account is in test mode.</span></div>`
              : connectedDevice(current, latestState)
            : blocked
              ? `<div class="pair-info">${icon('alert', 18)}<span>${
                  current.status === 'wrong_number'
                    ? 'The linked phone uses a different WhatsApp number. Reset the link and scan with the correct phone.'
                    : 'Reset the linked device to start a new WhatsApp connection.'
                }</span></div>`
              : `<div data-link-steps></div>${
                  current.status === 'verifying'
                    ? ''
                    : `<div class="segmented pairing-tabs" aria-label="Pairing method"><button data-method="qr" aria-pressed="${method === 'qr'}" class="${method === 'qr' ? 'selected' : ''}">${icon('qr', 15)} QR code</button>${current.phone ? `<button data-method="code" aria-pressed="${method === 'code'}" class="${method === 'code' ? 'selected' : ''}">${icon('key', 15)} Pairing code</button>` : ''}</div>`
                }
                <div data-pairing></div>`
      }
      <div class="modal-actions spread">${current.mode === 'baileys' ? `<button type="button" class="text-button danger" data-reset>Reset device link</button>` : '<span></span>'}
        ${btn(current.enabled ? 'Pause replies' : 'Resume replies', current.enabled ? 'pause' : 'play', 'data-toggle')}</div>
      <p class="form-error" data-number-error role="alert"></p>`;
    pane.querySelectorAll('[data-method]').forEach(
      (button) =>
        (button.onclick = () => {
          method = button.dataset.method;
          drawConnection();
          schedule();
        }),
    );
    drawLink();
    const copy = pane.querySelector('[data-copy-test]');
    if (copy)
      copy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(testMessage);
          notify('Test message copied.');
        } catch {
          notify('Select the test message to copy it.', true);
        }
      };
    pane.querySelector('[data-toggle]').onclick = async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        current = {
          ...current,
          ...(await api(route, { method: 'PATCH', data: { enabled: !current.enabled } })),
        };
        notify(current.enabled ? 'Replies resumed.' : 'Replies paused.');
        latestState = { status: current.status };
        expires = 0;
        drawConnection();
        schedule();
        void refresh();
      } catch (error) {
        pane.querySelector('[data-number-error]').textContent = error.message;
        button.disabled = false;
      }
    };
    const reset = pane.querySelector('[data-reset]');
    if (reset)
      reset.onclick = () => {
        const actions = reset.closest('.modal-actions');
        actions.innerHTML = `<div class="reset-confirm"><strong>Reset this device link?</strong><small>You will need to link the phone again.</small></div>
        <div class="button-group">${btn('Cancel', '', 'data-keep')}${btn('Reset link', 'refresh', 'data-confirm', 'danger-button')}</div>`;
        actions.querySelector('[data-keep]').onclick = drawConnection;
        actions.querySelector('[data-confirm]').onclick = async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          try {
            await api(route + '/reset-session', { method: 'POST' });
            current.status = 'offline';
            latestState = { status: 'offline' };
            method = 'qr';
            notify('Device link reset.');
            drawConnection();
            schedule();
            void refresh();
          } catch (error) {
            pane.querySelector('[data-number-error]').textContent = error.message;
            button.disabled = false;
          }
        };
      };
  }
  async function drawAdmins() {
    pane.innerHTML =
      '<div class="inline-loading"><div class="spinner"></div><span>Loading alert numbers…</span></div>';
    try {
      const { numbers } = await api(route + '/admin-numbers');
      if (!modal.open || tab !== 'admins') return;
      pane.innerHTML = `<form class="form-stack"><label>Admin WhatsApp numbers<textarea name="numbers" rows="4" placeholder="+255 700 000 000">${esc(numbers.map(phoneLabel).join('\n'))}</textarea><small>One number per line. These numbers receive sales and payment alerts for this account.</small></label>
        <p class="form-error" role="alert"></p><div class="modal-actions"><button type="submit" class="btn primary">Save alert numbers</button></div></form>`;
      const form = pane.querySelector('form');
      form.onsubmit = async (event) => {
        event.preventDefault();
        lockForm(form, true);
        formError(form, '');
        try {
          const list = formData(form)
            .numbers.split(/\n+/)
            .map((value) => value.trim())
            .filter(Boolean)
            .map(phoneInput);
          await api(route + '/admin-numbers', { method: 'PUT', data: { numbers: list } });
          notify('Admin alert numbers saved.');
        } catch (error) {
          formError(form, error.message);
        } finally {
          lockForm(form, false);
        }
      };
    } catch (error) {
      if (modal.open && tab === 'admins') pane.textContent = error.message;
    }
  }
  modal.querySelectorAll('[data-tab]').forEach(
    (button) =>
      (button.onclick = () => {
        tab = button.dataset.tab;
        modal
          .querySelectorAll('[data-tab]')
          .forEach((item) => item.classList.toggle('selected', item === button));
        clearTimeout(timer);
        polls?.abort();
        if (tab === 'admins') void drawAdmins();
        else {
          drawConnection();
          schedule();
        }
      }),
  );
  clock = setInterval(updateQrClock, 250);
  drawConnection();
  schedule();
}

export async function numbers(container, signal, route) {
  let accounts = await api('/accounts', { signal });
  if (signal.aborted) return;
  let filter = 'all';
  let query = '';
  let timer;
  container.innerHTML = `${heading('WhatsApp numbers', 'Add and manage the WhatsApp numbers that reply to your customers.', btn('Add number', 'plus', 'data-add', 'primary'))}
    <div class="number-summary" id="number-summary"></div>
    <section class="card numbers-card">
      <header class="card-head"><div class="card-title"><span class="card-icon">${icon('phone', 18)}</span><div><h2>Business numbers</h2><p>Manage linked devices and reply status</p></div></div>
        <label class="field-search">${icon('search', 17)}<input type="search" placeholder="Search numbers" aria-label="Search numbers"></label></header>
      <div class="numbers-filters line-tabs" id="number-filters"></div>
      <div id="numbers-results"></div>
    </section>`;
  function show() {
    container.querySelector('#number-summary').innerHTML = [
      ['Total numbers', accounts.length, 'phone', 'violet'],
      [
        'Connected',
        accounts.filter((account) => status(account).group === 'connected').length,
        'link',
        'green',
      ],
      [
        'Awaiting connection',
        accounts.filter((account) => status(account).group === 'pending').length,
        'qr',
        'amber',
      ],
    ]
      .map(
        ([label, amount, symbol, color]) =>
          `<div class="card summary-tile"><span class="metric-icon ${color}">${icon(symbol, 20)}</span><span>${label}<strong data-count="${Number(amount) || 0}">${amount}</strong></span></div>`,
      )
      .join('');
    countUp(container.querySelector('#number-summary'));
    const tabs = [
      ['all', 'All numbers'],
      ['connected', 'Connected'],
      ['pending', 'Awaiting connection'],
      ['paused', 'Paused'],
    ];
    const filters = container.querySelector('#number-filters');
    if (!filters.childElementCount) {
      filters.innerHTML = tabs
        .map(([value, label]) => `<button data-filter="${value}">${label} <b></b></button>`)
        .join('');
      filters.querySelectorAll('button').forEach(
        (button) =>
          (button.onclick = () => {
            filter = button.dataset.filter;
            show();
          }),
      );
    }
    filters.querySelectorAll('button').forEach((button) => {
      const selected = filter === button.dataset.filter;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.querySelector('b').textContent =
        button.dataset.filter === 'all'
          ? accounts.length
          : accounts.filter((account) => status(account).group === button.dataset.filter).length;
    });
    const visible = accounts.filter(
      (account) =>
        (filter === 'all' || status(account).group === filter) &&
        (account.label.toLowerCase().includes(query) ||
          (account.phone || '').includes(query.replace(/^\+/, '')) ||
          account.id.includes(query)),
    );
    const results = container.querySelector('#numbers-results');
    results.innerHTML = visible.length
      ? `<div class="table-wrap"><table class="number-table"><thead><tr>
      <th>Account name</th><th>Phone number</th><th>Connection</th><th>Replies</th><th><span class="sr-only">Actions</span></th>
      </tr></thead><tbody>${visible
        .map(
          (account) => `<tr>
        <td><div class="table-person"><span class="channel-icon">${icon('inbox', 19)}</span><div><b>${esc(account.label)}</b><small>${account.mode === 'mock' ? 'Test account' : 'WhatsApp'}</small></div></div></td>
        <td class="phone-cell">${account.phone ? phoneLabel(account.phone) : '<span class="muted-inline">Set after linking</span>'}</td>
        <td>${accountPill(account)}</td>
        <td><button type="button" class="switch ${account.enabled ? 'on' : ''}" role="switch" aria-checked="${account.enabled}" aria-label="Replies for ${esc(account.label)}" data-switch="${esc(account.id)}"><span></span></button> <span class="switch-label">${account.enabled ? 'Enabled' : 'Paused'}</span></td>
        <td><div class="table-actions"><a class="icon-btn" title="View chats" aria-label="View chats for ${esc(account.label)}" href="#inbox/account/${esc(account.id)}">${icon('inbox', 16)}</a>
          ${btn(account.enabled && status(account).group === 'pending' ? 'Connect' : 'Manage', '', `data-manage="${esc(account.id)}"`, 'small')}</div></td>
      </tr>`,
        )
        .join('')}</tbody></table></div>`
      : accounts.length
        ? empty('No matching numbers', 'Try another search or connection status.', 'search')
        : empty(
            'Add your first WhatsApp number',
            'Link a number to bring customer messages into CSbot.',
            'phone',
            btn('Add number', 'plus', 'data-empty-add', 'primary'),
          );
    results.querySelector('[data-empty-add]')?.addEventListener('click', add);
    results.querySelectorAll('[data-manage]').forEach(
      (button) =>
        (button.onclick = () =>
          manageAccount(
            accounts.find((account) => account.id === button.dataset.manage),
            refresh,
          )),
    );
    results.querySelectorAll('[data-switch]').forEach(
      (button) =>
        (button.onclick = async () => {
          const account = accounts.find((item) => item.id === button.dataset.switch);
          button.disabled = true;
          try {
            await api('/accounts/' + account.id, { method: 'PATCH', data: { enabled: !account.enabled } });
            notify(account.enabled ? 'Replies paused.' : 'Replies resumed.');
            await refresh();
          } catch (error) {
            notify(error.message, true);
            button.disabled = false;
          }
        }),
    );
  }
  async function refresh() {
    try {
      const next = await api('/accounts', { signal });
      if (!signal.aborted && JSON.stringify(next) !== JSON.stringify(accounts)) {
        accounts = next;
        show();
      }
    } catch (error) {
      if (!signal.aborted) notify(error.message, true);
    }
  }
  const add = () =>
    openAdd(async (account) => {
      await refresh();
      if (!signal.aborted) manageAccount(account, refresh);
    });
  container.querySelector('[data-add]').onclick = add;
  container.querySelector('.field-search input').oninput = (event) => {
    query = event.target.value.trim().toLowerCase();
    show();
  };
  show();
  if (route === 'new') {
    history.replaceState(null, '', '#numbers');
    add();
  } else if (route) {
    const account = accounts.find((item) => item.id === route);
    if (account) manageAccount(account, refresh);
  }
  timer = setInterval(refresh, 5000);
  signal.addEventListener('abort', () => clearInterval(timer), { once: true });
}
