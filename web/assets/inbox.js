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
const modePill = (mode) => (mode === 'human' ? pill('Human', 'amber', false) : pill('CSbot', 'blue', false));
const person = (name) => `<span class="person">${esc(initials(name))}</span>`;

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
  let retrySend;
  let submitting = false;
  let actionPending = false;
  let searchTimer;
  let pollTimer;
  container.innerHTML = `${heading('Inbox', 'View customer messages and step in when a conversation needs you.')}
    <section class="card inbox-panel ${selected ? 'has-active' : ''}">
      <aside class="chat-list"><div class="inbox-filters"><label class="field-search">${icon('search', 16)}<input type="search" aria-label="Search conversations" placeholder="Search conversations" value="${esc(query)}"></label>
        <div><select aria-label="Filter by WhatsApp number"><option value="">All numbers</option>${accounts.map((item) => `<option value="${esc(item.id)}" ${item.id === account ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}</select>
          <select aria-label="Filter by reply mode"><option value="">All replies</option><option value="bot">Bot</option><option value="human" ${mode ? 'selected' : ''}>Human</option></select></div></div>
        <div id="conversation-list" class="conversation-list" aria-label="Conversations"></div></aside>
      <div id="conversation-pane" class="conversation-pane"></div>
      <aside id="conversation-details" class="conversation-details"></aside>
    </section>`;
  const pane = container.querySelector('#conversation-pane');
  const details = container.querySelector('#conversation-details');
  const list = container.querySelector('#conversation-list');
  const panel = container.querySelector('.inbox-panel');
  const [accountFilter, modeFilter] = container.querySelectorAll('.inbox-filters select');
  const search = container.querySelector('.inbox-filters input');

  function listView(animate = false) {
    if (signal.aborted) return;
    const lastScroll = list.scrollTop;
    list.innerHTML = chats.length
      ? chats
          .map((chat) => {
            const name = customer(chat);
            return `<button type="button" class="conversation-item ${chat.id === selected ? 'selected' : ''}" data-conversation="${chat.id}" aria-pressed="${chat.id === selected}">
        ${person(name)}<span class="conversation-preview"><b>${esc(name)}</b><small>${esc(chat.last_body || 'Conversation started')}</small></span>
        <span class="conversation-meta"><small>${dateLabel(chat.last_at || chat.updated_at)}</small>${chat.unread_count ? `<i>${chat.unread_count}</i>` : ''}</span>
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
        <div class="thread-customer"></div><div class="thread-actions"></div></header>
        <div class="thread-messages"></div>
        <form class="composer"><textarea placeholder="Write a reply…" aria-label="Reply message" maxlength="3500" rows="2" required></textarea>
          <div class="composer-actions"><small>Sending a reply puts this chat in manual mode.</small><button class="btn primary" type="submit">${icon('send', 16)} Send</button></div></form>`;
      pane.querySelector('[data-back]').onclick = () => selectChat('');
      pane.querySelector('form').onsubmit = send;
      pane.querySelector('.thread-messages').innerHTML =
        '<div class="inline-loading"><div class="spinner"></div><span>Loading messages…</span></div>';
    } else {
      pane.innerHTML = empty(
        'Select a conversation',
        'Open a customer chat to read messages, see their order and reply.',
        'inbox',
      );
    }
    details.innerHTML = selected ? '' : `<div class="details-head">Customer details</div>`;
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
        ${item.media_id ? `<button type="button" class="media-link" data-image="${item.media_id}">${icon('image', 17)} View image</button>` : ''}
        ${item.body ? `<div>${esc(item.body)}</div>` : ''}
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
            `<div class="bubble outgoing delivery ${item.state === 'uncertain' ? 'uncertain' : ''}"><div>${esc(item.body)}</div><small>${item.state === 'uncertain' ? 'Delivery unconfirmed' : item.state === 'sending' ? 'Sending' : 'Queued'}</small></div>`,
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
      `${person(name)}<div><strong>${esc(name)}</strong><small>${esc(number?.label || thread.account_id)} · ${modePill(thread.mode)}</small></div>`;
    const actions = pane.querySelector('.thread-actions');
    actions.innerHTML = btn(
      thread.mode === 'bot' ? 'Take over' : 'Enable bot',
      thread.mode === 'bot' ? 'user' : 'bot',
      'data-handoff',
      'small',
    );
    actions.querySelector('button').disabled = actionPending;
    actions.querySelector('button').onclick = async (event) => {
      const active = selected;
      actionPending = true;
      event.currentTarget.disabled = true;
      try {
        await api('/conversations/' + active + '/mode', {
          method: 'PATCH',
          data: { mode: thread.mode === 'bot' ? 'human' : 'bot' },
        });
        await loadThread();
      } catch (error) {
        notify(error.message, true);
      } finally {
        actionPending = false;
        actions.querySelector('button').disabled = false;
      }
    };
    const profile = thread.memory?.profile ?? {};
    details.innerHTML = `<div class="details-head">Customer details</div><div class="details-person">${person(name)}<b>${esc(name)}</b><small>${phoneLabel(thread.customer_phone)}</small></div>
      <div class="details-section"><h3>Latest order</h3>
      ${
        thread.sale
          ? `<div class="details-row"><b>#${thread.sale.id}</b>${stagePill(thread.sale.stage)}</div>${thread.sale.quote?.text ? `<p class="details-quote">${esc(thread.sale.quote.text)}</p>` : ''}
      <a class="quiet-link" href="#sales/${thread.id}/${thread.sale.id}">View order ${icon('chevron', 13)}</a>`
          : '<p>No order yet</p>'
      }</div>
      <div class="details-section"><h3>Saved context</h3>
      ${
        [
          ['Equipment', profile.equipment],
          ['Budget', profile.budget],
          ['Use case', profile.useCase],
        ]
          .filter(([, value]) => value)
          .map(([label, value]) => `<p><b>${label}</b><br>${esc(value)}</p>`)
          .join('') || '<p>No customer details saved yet.</p>'
      }</div>`;
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
    retrySend = undefined;
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
    const button = form.querySelector('button');
    const text = input.value.trim();
    if (!text || submitting || !thread) return;
    submitting = true;
    button.disabled = true;
    retrySend = retrySend?.text === text ? retrySend : { text, requestId: crypto.randomUUID() };
    try {
      await api('/conversations/' + active + '/messages', { method: 'POST', data: retrySend });
      if (selected === active) {
        if (input.value.trim() === text) input.value = '';
        retrySend = undefined;
        await loadThread();
      }
      notify('Reply queued.');
    } catch (error) {
      notify(error.message, true);
    } finally {
      submitting = false;
      button.disabled = false;
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
  modeFilter.onchange = () => {
    mode = modeFilter.value;
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
