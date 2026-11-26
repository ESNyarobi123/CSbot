import {
  api,
  icon,
  esc,
  btn,
  heading,
  empty,
  dateLabel,
  timeLabel,
  customer,
  initials,
  phoneLabel,
  pill,
  stagePill,
  notify,
  showModal,
} from './ui.js';

const limit = 30;
const modePill = (mode, pending = false) => mode === 'human'
  ? pill(pending ? 'Waiting for agent' : 'Manual', 'amber') : pill('CSbot', 'blue');
const person = (name) => {
  const tone = [...name].reduce((sum, letter) => sum + letter.codePointAt(0), 0) % 5;
  return `<span aria-hidden="true" class="person tone-${tone}">${esc(initials(name))}</span>`;
};
const messageBody = (body) => esc(body).replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');

function customerBrief(thread) {
  const { profile = {}, requirements = {}, product, productOptions = [], language, support, lastSupport, lastDocument, posQuotation,
    facts: siteFacts = {}, trace = [] } = thread.memory || {};
  const caseDetails = support ?? lastSupport;
  const environments = { indoor: 'Indoors', outdoor: 'Outdoors', mixed: 'Indoors and outdoors' };
  const obstacles = { open: 'Open area', obstructed: 'Obstructions present' };
  // The flexible memory the bot keeps between chats: whatever the customer said
  // about their own site, shown with a human label.
  const labels = {
    coverage_m: 'Distance to cover', clients: 'Concurrent users', place: 'Indoor / outdoor',
    site: 'Site conditions', system: 'Billing system', fleet: 'Existing fleet',
    equipment: 'Equipment owned', use: 'Use case', budget: 'Budget', asked_mesh: 'Mesh',
    also: 'Also interested in', photo: 'Model from photo',
  };
  const site = Object.entries(siteFacts)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => [labels[key] ?? key, value]);
  const facts = [
    ['Coverage requested', requirements.coverageMeters && `${requirements.coverageMeters} m`],
    ['Users', requirements.users],
    ['Environment', environments[requirements.environment]],
    ['Site conditions', obstacles[requirements.obstacles]],
    ['Mesh', requirements.mesh === true ? 'Requested' : requirements.mesh === false ? 'Not required' : ''],
    ['Use case', profile.useCase],
    ['Budget', profile.budget],
    ['Equipment', profile.equipment],
  ].filter(([, value]) => value !== undefined && value !== null && value !== '');
  const name = customer(thread);
  const contact = [thread.customer_phone && name !== phoneLabel(thread.customer_phone) && phoneLabel(thread.customer_phone),
    language === 'sw' ? 'Kiswahili' : language === 'en' ? 'English' : ''].filter(Boolean).join(' · ');
  const models = product ? [product] : productOptions;
  return `<div class="details-person">${person(name)}<div><b>${esc(name)}</b>${contact ? `<small>${esc(contact)}</small>` : ''}</div></div>
    ${thread.memory?.replyStatus === 'waiting' ? '<p class="brief-waiting">CSbot is waiting for a business enquiry. You can reply manually.</p>' : ''}
    <section class="details-section"><h3>${icon('book', 15)} Customer requirements</h3>
      ${facts.length ? `<dl class="brief-facts">${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>` : '<p>No requirements recorded yet.</p>'}
    </section>
    ${site.length ? `<section class="details-section"><h3>${icon('search', 15)} What CSbot knows</h3>
      <dl class="brief-facts">${site.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(String(value).replace(/\b\w/g, (char) => char.toUpperCase()))}</dd></div>`).join('')}</dl></section>` : ''}
    ${models.length ? `<section class="details-section"><h3>${icon('box', 15)} Models discussed</h3>
      <ul class="brief-models">${models.map((item) => `<li>${esc(item.name)}</li>`).join('')}</ul></section>` : ''}
    ${caseDetails?.problem ? `<section class="details-section"><h3>${icon('alert', 15)} Support request</h3>
      <p>${esc(caseDetails.problem)}</p>${caseDetails.checkResult ? `<p>${esc(caseDetails.checkResult)}</p>` : ''}</section>` : ''}
    ${lastDocument || posQuotation ? `<section class="details-section"><h3>${icon('bag', 15)} Sales documents</h3>
      <p>${esc(lastDocument || posQuotation.number)}</p></section>` : ''}
    ${trace.length ? `<section class="details-section"><h3>${icon('book', 15)} Last answer, step by step</h3>
      <ol class="brief-trace">${trace.map((step) => `<li>${esc(step)}</li>`).join('')}</ol></section>` : ''}
    <section class="details-section"><h3>${icon('bag', 15)} Latest order</h3>
      ${thread.sale ? `<div class="details-row"><a class="quiet-link" href="#sales/${esc(thread.id)}/${esc(thread.sale.id)}">Order #${esc(thread.sale.id)} ${icon('chevron', 13)}</a>${stagePill(thread.sale.stage)}</div>
        ${thread.sale.quote?.text ? `<p class="details-quote">${esc(thread.sale.quote.text)}</p>` : ''}` : '<p>No order yet.</p>'}
    </section>`;
}

function encodePdf(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',', 2)[1]);
    reader.onerror = () => reject(new Error('The PDF could not be read.'));
    reader.readAsDataURL(file);
  });
}

export async function inbox(container, signal, segments, initialSearch = '') {
  const accounts = await api('/accounts', { signal });
  if (signal.aborted) return;
  let account = segments[0] === 'account' ? segments[1] : '';
  let mode = segments[0] === 'human' ? 'human' : '';
  let selected = /^\d+$/.test(segments[0] || '') ? segments[0] : '';
  let query = initialSearch;
  let chats = [];
  let listVersion = 0;
  let threadVersion = 0;
  let thread;
  let history = [];
  let latestSnapshot = '';
  let seen = new Set();
  let canLoadMore = false;
  let oldestReached = true;
  const drafts = new Map();
  const retryRequests = new Map();
  const sending = new Set();
  const switching = new Set();
  let briefDialog;
  let lastListPaint = '';
  let searchTimer;
  let pollTimer;
  container.innerHTML = `${heading('Inbox', 'Customer conversations across your WhatsApp numbers.')}
    <section class="card inbox-panel ${selected ? 'has-active' : ''}">
      <aside class="chat-list" aria-label="Conversations"><div class="inbox-filters">
        <div class="list-head"><h2>Chats</h2><select aria-label="Filter by WhatsApp number"><option value="">All numbers</option>${accounts.map((item) => `<option value="${esc(item.id)}" ${item.id === account ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}</select></div>
        <label class="field-search">${icon('search', 16)}<input type="search" aria-label="Search conversations" placeholder="Search chats" maxlength="80" value="${esc(query)}"></label>
        <div class="reply-filters" role="group" aria-label="Filter by reply mode">${[['', 'All'], ['bot', 'CSbot'], ['human', 'Agent inbox']].map(([value, label]) => `<button type="button" data-mode="${value}" aria-pressed="${mode === value}">${label}</button>`).join('')}</div>
        </div><div id="conversation-list" class="conversation-list"></div></aside>
      <section id="conversation-pane" class="conversation-pane" aria-label="Conversation"></section>
      <aside id="conversation-details" class="conversation-details" aria-label="Customer brief"></aside>
    </section>`;
  const pane = container.querySelector('#conversation-pane');
  const details = container.querySelector('#conversation-details');
  const list = container.querySelector('#conversation-list');
  const panel = container.querySelector('.inbox-panel');
  const accountFilter = container.querySelector('.inbox-filters select');
  const modeFilters = container.querySelectorAll('[data-mode]');
  const search = container.querySelector('.inbox-filters input');

  function listView(animate = false) {
    if (signal.aborted) return;
    const lastScroll = list.scrollTop;
    const focusedChat = document.activeElement?.dataset.conversation;
    const markup = chats.length
      ? chats
          .map((chat) => {
            const name = customer(chat);
            return `<button type="button" class="conversation-item ${chat.id === selected ? 'selected' : ''}" data-conversation="${esc(chat.id)}" aria-pressed="${chat.id === selected}">
        ${person(name)}<span class="conversation-preview"><span class="chat-line"><b>${esc(name)}</b><small>${dateLabel(chat.last_at || chat.updated_at)}</small></span>
        <span class="preview-text">${esc(chat.last_body || 'Conversation started')}</span>
        <span class="chat-line">${modePill(chat.mode, chat.memory?.handoffPending)}${chat.unread_count ? `<span class="unread-count" aria-label="${esc(chat.unread_count)} unread">${esc(chat.unread_count)}</span>` : ''}</span></span>
      </button>`;
          })
          .join('') +
        (canLoadMore
          ? '<button type="button" class="text-button load-more" data-load>Load more chats</button>'
          : '')
      : empty(
          'No chats found',
          query || mode || account ? 'Try changing the inbox filters.' : 'New customer chats appear here.',
          'inbox',
        );
    if (lastListPaint === markup) return;
    lastListPaint = markup;
    list.innerHTML = markup;
    if (focusedChat) list.querySelector(`[data-conversation="${CSS.escape(focusedChat)}"]`)?.focus({ preventScroll: true });
    list.scrollTop = lastScroll;
    list.classList.remove('enter');
    if (animate) {
      // Restart the cascade only for a deliberate filter or search change, never for polling.
      void list.offsetWidth;
      list.classList.add('enter');
    }
    list
      .querySelectorAll('[data-conversation]')
      .forEach((button) => (button.onclick = () => selectChat(button.dataset.conversation)));
    const load = list.querySelector('[data-load]');
    if (load)
      load.onclick = async () => {
        load.disabled = true;
        try {
          await loadList(true);
        } catch (error) {
          handleError(error);
        } finally {
          load.disabled = false;
        }
      };
  }

  async function loadList(append = false, animate = false) {
    const generation = ++listVersion;
    const filters = new URLSearchParams({ limit: String(limit) });
    if (account) filters.set('account', account);
    if (mode) filters.set('mode', mode);
    if (query) filters.set('q', query.slice(0, 80));
    if (append && chats.length) {
      filters.set('before', chats.at(-1).cursor_at);
      filters.set('beforeId', chats.at(-1).id);
    }
    const incoming = await api('/conversations?' + filters, { signal });
    if (signal.aborted || generation !== listVersion) return;
    canLoadMore = incoming.length === limit;
    if (append) {
      const old = new Set(chats.map((chat) => chat.id));
      chats.push(...incoming.filter((chat) => !old.has(chat.id)));
    } else {
      chats = incoming;
    }
    listView(animate);
  }

  function resetThread() {
    panel.classList.toggle('has-active', Boolean(selected));
    if (selected) {
      pane.innerHTML = `<header class="thread-head"><button class="icon-btn mobile-back" aria-label="Back to conversations" data-back>${icon('back', 20)}</button>
        <div class="thread-customer"></div><div class="thread-actions">
        <button type="button" class="btn small" data-handoff disabled></button>
        <button type="button" class="icon-btn brief-trigger" data-brief aria-haspopup="dialog" aria-label="Open customer brief" title="Customer brief" disabled>${icon('book', 17)}</button></div></header>
        <div class="thread-messages" role="region" aria-label="Message history" tabindex="0"></div>
        <form class="composer"><div class="compose-box"><textarea placeholder="Write a reply…" aria-label="Reply message" aria-describedby="compose-hint" maxlength="3500" rows="2" required></textarea>
          <label class="composer-attachment">Invoice PDF <input type="file" accept=".pdf,application/pdf" aria-describedby="compose-hint"></label>
          <div class="composer-actions"><small id="compose-hint"></small><button class="btn primary" type="submit" title="Send reply (Ctrl or ⌘ + Enter)" disabled>${icon('send', 15)} Send</button></div></div></form>`;
      pane.querySelector('[data-back]').onclick = () => selectChat('');
      pane.querySelector('[data-handoff]').onclick = changeMode;
      pane.querySelector('[data-brief]').onclick = () => {
        if (thread) briefDialog = showModal('Customer brief', '', `<div class="brief-content">${customerBrief(thread)}</div>`, () => { briefDialog = undefined; });
      };
      const form = pane.querySelector('form');
      form.onsubmit = send;
      form.querySelector('[type=file]').onchange = updateComposer;
      const input = form.querySelector('textarea');
      input.value = drafts.get(selected) || '';
      input.oninput = () => {
        if (input.value) drafts.set(selected, input.value); else drafts.delete(selected);
        updateComposer();
      };
      input.onkeydown = (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.isComposing) {
          event.preventDefault();
          form.requestSubmit();
        }
      };
      pane.querySelector('.thread-messages').innerHTML =
        '<div class="inline-loading"><div class="spinner"></div><span>Loading messages…</span></div>';
    } else {
      pane.innerHTML = empty(
        'Select a conversation',
        'Open a customer chat to read messages, see their order and reply.',
        'inbox',
      );
    }
    details.innerHTML = '';
  }

  function messagesView(keepPosition = false) {
    const target = pane.querySelector('.thread-messages');
    const oldHeight = target.scrollHeight;
    const oldTop = target.scrollTop;
    const atEnd = oldHeight - oldTop - target.clientHeight < 62;
    const pending = (thread?.outbound ?? [])
      .filter((item) => item.origin !== 'alert' && ['queued', 'sending', 'uncertain'].includes(item.state))
      .reverse();
    // Only messages that arrived after the first paint get an entrance, so polling stays calm.
    const painted = seen.size > 0;
    const fresh = new Set(history.filter((item) => !seen.has(item.id)).map((item) => item.id));
    const groups = [...history]
      .reverse()
      .map((item, index, array) => {
        const date = dateLabel(item.occurred_at);
        const divider =
          !index || dateLabel(array[index - 1].occurred_at) !== date
            ? `<div class="date-divider"><span>${date}</span></div>`
            : '';
        return (
          divider +
          `<div class="bubble ${item.direction === 'outbound' ? 'outgoing' : ''} ${painted && fresh.has(item.id) ? 'bubble-new' : ''}">
        ${item.media_id && item.kind === 'document'
          ? `<a class="media-link" href="/v1/conversations/${esc(selected)}/documents/${esc(item.media_id)}" download>Download PDF</a>`
          : item.media_id && item.kind === 'audio'
            ? `<button type="button" class="media-link" data-audio="${esc(item.media_id)}">Play voice note</button>`
            : item.media_id ? `<button type="button" class="media-link" data-image="${esc(item.media_id)}">${icon('image', 17)} View image</button>` : ''}
        ${item.body ? `<div class="message-body">${messageBody(item.body)}</div>` : ''}
        <small>${item.actor === 'bot' ? 'CSbot · ' : item.actor === 'admin' ? 'Admin · ' : ''}${timeLabel(item.occurred_at)}</small>
      </div>`
        );
      })
      .join('');
    target.innerHTML =
      (oldestReached
        ? ''
        : '<button type="button" class="text-button load-more" data-earlier>Load earlier messages</button>') +
      groups +
      pending
        .map(
          (item) =>
            `<div class="bubble outgoing delivery ${item.state === 'uncertain' ? 'uncertain' : ''}"><div class="message-body">${messageBody(item.body)}</div><small>${item.state === 'uncertain' ? 'Delivery unconfirmed' : item.state === 'sending' ? 'Sending' : 'Queued'}</small></div>`,
        )
        .join('');
    if (!target.innerHTML)
      target.innerHTML = empty(
        'No messages yet',
        'Messages from this conversation will appear here.',
        'inbox',
      );
    seen = new Set(history.map((item) => item.id));
    if (keepPosition) target.scrollTop = target.scrollHeight - oldHeight + oldTop;
    else if (atEnd) target.scrollTop = target.scrollHeight;
    else target.scrollTop = oldTop;
    target.querySelector('[data-earlier]')?.addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      const active = selected;
      try {
        const older = await api(`/conversations/${active}/messages?limit=60&before=${history.at(-1).id}`, {
          signal,
        });
        if (signal.aborted || active !== selected) return;
        const saved = new Set(history.map((item) => item.id));
        history.push(...older.filter((item) => !saved.has(item.id)));
        oldestReached = older.length < 60;
        messagesView(true);
      } catch (error) {
        if (!signal.aborted) notify(error.message, true);
      } finally {
        if (event.target instanceof HTMLButtonElement) event.target.disabled = false;
      }
    });
    target.querySelectorAll('[data-audio]').forEach(button => {
      button.onclick = async () => {
        try {
          const { dataUrl } = await api('/media/' + button.dataset.audio, { signal });
          if (signal.aborted || !/^data:audio\/(?:ogg|opus|mpeg|mp4|aac|amr|wav|webm);base64,[a-z0-9+/=]+$/i.test(dataUrl)) return;
          showModal('Customer voice note', '',
            `<audio controls src="${esc(dataUrl)}"></audio><p><a download href="${esc(dataUrl)}">Download audio</a></p>`);
        } catch (error) {
          if (!signal.aborted) notify(error.message, true);
        }
      };
    });
    target.querySelectorAll('[data-image]').forEach(
      (button) =>
        (button.onclick = async () => {
          try {
            const { dataUrl } = await api('/media/' + button.dataset.image, { signal });
            if (signal.aborted || !/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(dataUrl))
              return;
            showModal(
              'Customer image',
              '',
              `<img class="media-view" alt="Image shared by the customer" src="${esc(dataUrl)}">`,
            );
          } catch (error) {
            if (!signal.aborted) notify(error.message, true);
          }
        }),
    );
  }

  function infoView() {
    const name = customer(thread);
    const number = accounts.find((item) => item.id === thread.account_id);
    pane.querySelector('.thread-customer').innerHTML =
      `${person(name)}<div><strong>${esc(name)}</strong><small>${esc(number?.label || thread.account_id)} · ${modePill(thread.mode, thread.memory?.handoffPending)}</small></div>`;
    const handoff = pane.querySelector('[data-handoff]');
    handoff.textContent = thread.mode === 'bot' || thread.memory?.handoffPending ? 'Take over' : 'Enable bot';
    handoff.disabled = switching.has(selected);
    pane.querySelector('[data-brief]').disabled = false;
    const brief = customerBrief(thread);
    details.innerHTML = '<div class="details-head">Customer brief</div>' + brief;
    if (briefDialog?.open) briefDialog.querySelector('.brief-content').innerHTML = brief;
    updateComposer();
  }

  function updateComposer() {
    const form = pane.querySelector('form');
    if (!form) return;
    const file = form.querySelector('[type=file]').files[0];
    const text = form.querySelector('textarea').value.trim();
    const invalid = file && (file.size > 4 * 1024 * 1024 || !/\.pdf$/i.test(file.name) || text.length > 1000);
    form.querySelector('button').disabled = !thread || sending.has(selected) || !text || Boolean(invalid);
    form.querySelector('#compose-hint').textContent = invalid
      ? 'Choose a PDF up to 4 MB and keep its caption under 1,001 characters.'
      : thread?.mode === 'bot' || thread?.memory?.handoffPending ? 'Sending a reply takes over this chat.' : 'You are replying as an agent.';
  }

  async function changeMode() {
    if (!thread || switching.has(selected)) return;
    const active = selected;
    switching.add(active);
    infoView();
    try {
      await api('/conversations/' + active + '/mode', { method: 'PATCH', data: { mode: thread.mode === 'bot' || thread.memory?.handoffPending ? 'human' : 'bot' } });
      if (selected === active && !signal.aborted) await loadThread();
    } catch (error) { handleError(error); }
    finally {
      switching.delete(active);
      if (selected === active && thread && !signal.aborted) infoView();
    }
  }

  async function loadThread(initial = false) {
    if (!selected) return;
    const active = selected;
    const generation = ++threadVersion;
    const [next, recent] = await Promise.all([
      api('/conversations/' + active, { signal }),
      api('/conversations/' + active + '/messages?limit=60', { signal }),
    ]);
    if (signal.aborted || active !== selected || generation !== threadVersion) return;
    const fingerprint = JSON.stringify([next, recent]);
    if (!initial && fingerprint === latestSnapshot) return;
    latestSnapshot = fingerprint;
    thread = next;
    const found = new Set(recent.map((item) => item.id));
    history = [...recent, ...history.filter((item) => !found.has(item.id))];
    if (initial) oldestReached = recent.length < 60;
    infoView();
    messagesView();
  }

  async function selectChat(id) {
    if (selected === id && thread) return;
    selected = id;
    history = [];
    seen = new Set();
    thread = undefined;
    latestSnapshot = '';
    listView();
    resetThread();
    historyReplace(activeHash(id));
    if (!selected) return;
    try {
      await api('/conversations/' + id + '/read', { method: 'PATCH', signal });
      if (selected !== id || signal.aborted) return;
      await Promise.all([loadThread(true), loadList(false, true)]);
    } catch (error) {
      if (!signal.aborted && selected === id) {
        pane.querySelector('.thread-messages').innerHTML = empty(
          'Couldn’t load messages',
          error.message,
          'alert',
        );
      }
    }
  }

  function activeHash(id) {
    if (id) return '#inbox/' + id;
    if (account) return '#inbox/account/' + account;
    return mode === 'human' ? '#inbox/human' : '#inbox';
  }
  function historyReplace(hash) {
    window.history.replaceState(null, '', hash);
  }

  async function send(event) {
    event.preventDefault();
    const active = selected;
    const form = event.currentTarget;
    const input = form.querySelector('textarea');
    const attachment = form.querySelector('[type=file]');
    const file = attachment.files[0];
    const text = input.value.trim();
    if (form.querySelector('button').disabled) return;
    sending.add(active);
    updateComposer();
    try {
      const invoicePdf = file ? { name: file.name.slice(0, -4).replace(/[^A-Za-z0-9 ._-]/g, '_')
        .replace(/^[^A-Za-z0-9]+/, '').slice(0, 110).concat('.pdf'), base64: await encodePdf(file) } : undefined;
      if (invoicePdf?.name === '.pdf') invoicePdf.name = 'Invoice.pdf';
      const previous = retryRequests.get(active);
      const sameAttachment = previous?.invoicePdf?.name === invoicePdf?.name &&
        previous?.invoicePdf?.base64 === invoicePdf?.base64;
      const request = previous?.text === text && sameAttachment ? previous
        : { text, invoicePdf, requestId: crypto.randomUUID() };
      retryRequests.set(active, request);
      await api('/conversations/' + active + '/messages', { method: 'POST', data: request });
      retryRequests.delete(active);
      if (drafts.get(active)?.trim() === text) drafts.delete(active);
      if (selected === active && !signal.aborted) {
        const current = pane.querySelector('textarea');
        if (current.value.trim() === text) current.value = '';
        if (attachment.files[0] === file) attachment.value = '';
        await loadThread();
      }
      if (!signal.aborted) notify('Reply queued.');
    } catch (error) { handleError(error); }
    finally {
      sending.delete(active);
      if (!signal.aborted) updateComposer();
    }
  }
  search.oninput = () => {
    query = search.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void loadList(false, true).catch(handleError), 230);
  };
  accountFilter.onchange = () => {
    account = accountFilter.value;
    void loadList(false, true).catch(handleError);
  };
  for (const button of modeFilters) button.onclick = () => {
    mode = button.dataset.mode;
    for (const other of modeFilters) other.setAttribute('aria-pressed', String(other === button));
    void loadList(false, true).catch(handleError);
  };
  const handleError = (error) => {
    if (!signal.aborted) notify(error.message, true);
  };
  resetThread();
  if (selected) await selectChat(selected);
  else await loadList(false, true);
  if (signal.aborted) return;
  pollTimer = setInterval(() => {
    const listRefresh = chats.length <= limit ? loadList() : Promise.resolve();
    void Promise.all([listRefresh, loadThread()]).catch(() => {});
  }, 5000);
  signal.addEventListener(
    'abort',
    () => {
      clearTimeout(searchTimer);
      clearInterval(pollTimer);
    },
    { once: true },
  );
}
