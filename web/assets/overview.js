import {
  api,
  icon,
  esc,
  btn,
  heading,
  empty,
  status,
  accountPill,
  dateLabel,
  nf,
  customer,
  initials,
  phoneLabel,
  countUp,
  reducedMotion,
} from './ui.js';

const secondaryDate = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  timeZone: 'Africa/Dar_es_Salaam',
});
const dayLabel = (item) => secondaryDate.format(new Date(item.date + 'T12:00:00Z'));
const number = (value) => nf.format(value ?? 0);

function metric(label, value, symbol, color, supporting, href) {
  return `<a href="${href}" class="card metric"><span class="metric-icon ${color}">${icon(symbol, 20)}</span>
    <span class="metric-arrow">${icon('arrow', 16)}</span><span class="metric-label">${esc(label)}</span>
    <strong data-count="${Number(value) || 0}">${number(value)}</strong><span class="metric-note">${supporting}</span></a>`;
}

/** Ring segments share one circumference, so each percentage maps straight to a dash length. */
function donut(marks, total) {
  const colors = ['#6c5be9', '#f2b953', '#d9dde9'];
  let offset = 0;
  const segments = marks
    .map((mark, index) => {
      if (mark <= 0) return '';
      const gap = mark > 4 ? 1.6 : 0;
      const arc = Math.max(0, mark - gap);
      const segment = `<circle class="donut-seg" cx="21" cy="21" r="15.9155" stroke="${colors[index]}"
        stroke-dasharray="${arc} ${100 - arc}" stroke-dashoffset="${-offset}" data-arc="${arc}"/>`;
      offset += mark;
      return segment;
    })
    .join('');
  return `<div class="donut" role="img" aria-label="${total} ${total === 1 ? 'number' : 'numbers'}">
    <svg class="donut-ring" viewBox="0 0 42 42" aria-hidden="true">
      <circle class="donut-track" cx="21" cy="21" r="15.9155"/>${segments}</svg>
    <div><strong data-count="${Number(total) || 0}">${number(total)}</strong><span>Total numbers</span></div></div>`;
}

function chart(data, days) {
  const maximum = Math.max(0, ...data.activity.flatMap((item) => [item.received, item.sent]));
  const base = maximum > 12 ? 10 ** Math.floor(Math.log10(maximum)) : 4;
  const limit = Math.max(4, Math.ceil(maximum / base) * base);
  const ticks = [limit, limit * 0.75, limit * 0.5, limit * 0.25, 0].map((value) =>
    nf.format(Number(value.toFixed(1))),
  );
  const items = data.activity
    .map((item, index) => {
      const date = dateLabel(item.date + 'T12:00:00Z');
      const visibleDate = days === 7 || index % 5 === 0 || index === data.activity.length - 1;
      return `<div class="chart-column" style="--motion-delay:${Math.min(index, 10) * 24}ms"><button class="bar-pair" aria-label="${date}, ${item.received} received, ${item.sent} sent">
      <span class="bar in" style="--bar:${(item.received / limit) * 100}%"></span>
      <span class="bar out" style="--bar:${(item.sent / limit) * 100}%"></span>
      <span class="bar-tip"><b>${date}</b><span>${item.received} received · ${item.sent} sent</span></span></button>
      <span class="bar-label">${visibleDate ? esc(days === 7 ? dayLabel(item) : date.split(' ')[0]) : ''}</span></div>`;
    })
    .join('');
  return `<div class="chart-key"><span><i class="key-dot"></i>Received</span><span><i class="key-dot pale"></i>Sent</span></div>
    <div class="chart"><div class="chart-y">${ticks.map((tick) => `<span>${tick}</span>`).join('')}</div>
    <div class="chart-plot"><div class="chart-grid"><i></i><i></i><i></i><i></i><i></i></div>
    ${maximum ? '' : '<div class="chart-empty"><strong>No message activity yet</strong><span>Activity appears when your numbers send or receive messages.</span></div>'}
    <div class="chart-columns ${days === 30 ? 'compact' : ''}">${items}</div></div></div>`;
}

export async function overview(container, signal) {
  let days = 7;
  const [stats, accounts, conversation, daily] = await Promise.all([
    api('/stats', { signal }),
    api('/accounts', { signal }),
    api('/conversations?limit=5', { signal }),
    api('/dashboard/activity?days=7', { signal }),
  ]);
  if (signal.aborted) return;
  const connected = accounts.filter((account) => status(account).group === 'connected').length;
  const pending = accounts.filter((account) => status(account).group === 'pending').length;
  const paused = accounts.length - pending - connected;
  const connectionMarks = [connected, pending, paused].map((value) =>
    accounts.length ? (value / accounts.length) * 100 : 0,
  );
  const live = daily.services.length === 2 && daily.services.every((service) => service.healthy);
  const recentRows = conversation
    .map((chat) => {
      const channel = accounts.find((account) => account.id === chat.account_id);
      const name = customer(chat);
      return `<tr><td><a class="table-person" href="#inbox/${chat.id}"><span class="person">${esc(initials(name))}</span>
      <span><b>${esc(name)}</b><small>${esc(chat.last_body || 'Conversation opened')}</small></span></a></td>
      <td>${esc(channel?.label || chat.account_id)}</td><td>${chat.mode === 'human' ? '<span class="pill amber">Human</span>' : '<span class="pill blue">CSbot</span>'}</td>
      <td>${dateLabel(chat.last_at || chat.updated_at)}</td></tr>`;
    })
    .join('');
  const pairing = accounts.find(
    (account) => account.mode === 'baileys' && account.enabled && account.status !== 'connected',
  );
  const onboarding = !accounts.length || (connected === 0 && pairing);
  container.innerHTML = `${heading(
    'Overview',
    'Monitor your WhatsApp workspace and customer conversations.',
    onboarding ? '' : `<a class="btn primary" href="#numbers/new">${icon('plus', 17)} Add number</a>`,
  )}
    ${
      onboarding
        ? `<section class="onboarding-card"><div class="onboarding-copy">
      <span class="onboarding-icon">${icon('link', 20)}</span><div>
      <h2>${pairing ? 'Finish linking your WhatsApp number' : 'Connect your first WhatsApp number'}</h2>
      <p>${pairing ? esc(pairing.label) + ' is ready for device setup.' : 'Bring your customer chats into one inbox.'}</p></div></div>
      <a class="btn onboarding-action" href="#numbers/${pairing ? esc(pairing.id) : 'new'}">${pairing ? 'Link device' : 'Add number'} ${icon('arrow', 15)}</a>
      <div class="onboarding-orbit" aria-hidden="true"><i></i><i></i><i></i></div>
    </section>`
        : ''
    }
    <div class="metrics">
      ${metric('WhatsApp numbers', accounts.length, 'phone', 'violet', `<span class="live-dot"></span>${number(connected)} connected`, '#numbers')}
      ${metric('Conversations', stats.conversations, 'inbox', 'blue', `${number(stats.unread)} unread chats`, '#inbox')}
      ${metric('Open sales', stats.open_sales, 'bag', 'green', 'Active customer orders', '#sales')}
      ${metric('Needs a human', stats.human, 'user', 'amber', 'Conversations in manual mode', '#inbox/human')}
    </div>
    <div class="metrics">
      ${metric('First reply', stats.first_reply_median_seconds == null ? '—' : number(stats.first_reply_median_seconds) + 's',
        'clock', 'blue', 'Median for new chats · last 7 days', '#inbox')}
      ${metric('Stalled chats', stats.stalled_chats ?? 0, 'inbox', 'amber',
        `${number(stats.pending_catalog_checks ?? 0)} price checks scheduled`, '#inbox')}
      ${metric('Unconfirmed sends', stats.uncertain, 'phone', 'violet', 'Needs WhatsApp delivery review', '#inbox')}
      ${metric('Handoffs awaiting reply', stats.handoffs_waiting ?? 0, 'user', 'amber', 'Customer waiting for the team', '#inbox/human')}
    </div>
    <div class="dashboard-grid">
      <section class="card chart-card"><header class="card-head"><div class="card-title"><span class="card-icon">${icon('bars', 17)}</span><div><h2>Message activity</h2><p>Incoming and outgoing messages</p></div></div>
        <div class="segmented" aria-label="Activity date range"><button type="button" class="selected" data-days="7" aria-pressed="true">7 days</button><button type="button" data-days="30" aria-pressed="false">30 days</button></div></header>
        <div id="activity-chart" class="chart-content">${chart(daily, days)}</div>
      </section>
      <section class="card connection-card"><header class="card-head"><div class="card-title"><span class="card-icon">${icon('chart', 17)}</span><div><h2>Number status</h2><p>WhatsApp connections</p></div></div>
        <a class="quiet-link" href="#numbers">Manage ${icon('chevron', 13)}</a></header>
        <div class="donut-slot">${donut(connectionMarks, accounts.length)}</div>
        <div class="legend-list"><div><span><i></i>Connected</span><b>${number(connected)}</b></div><div><span><i></i>Awaiting connection</span><b>${number(pending)}</b></div><div><span><i></i>Paused</span><b>${number(paused)}</b></div></div>
      </section>
      <section class="card recent-card"><header class="card-head"><div class="card-title"><span class="card-icon">${icon('clock', 17)}</span><div><h2>Recent conversations</h2><p>Latest customer activity</p></div></div>
        <a class="btn small" href="#inbox">Open inbox ${icon('arrow', 14)}</a></header>
        ${
          recentRows
            ? `<div class="table-wrap"><table><thead><tr><th>Customer</th><th>Number</th><th>Handling</th><th>Last active</th></tr></thead><tbody>${recentRows}</tbody></table></div>`
            : empty(
                'No conversations yet',
                'Customer chats will appear here once a connected number receives a message.',
                'inbox',
              )
        }
      </section>
      <section class="card channel-card"><header class="card-head"><div class="card-title"><span class="card-icon">${icon('phone', 17)}</span><div><h2>WhatsApp numbers</h2><p>Your sending channels</p></div></div></header>
        ${
          accounts.length
            ? `<div class="channel-list">${accounts
                .slice(0, 4)
                .map(
                  (account) =>
                    `<a href="#numbers/${esc(account.id)}" class="channel-item"><span class="channel-icon">${icon('phone', 17)}</span><span><b>${esc(account.label)}</b><small>${phoneLabel(account.phone)}</small></span>${accountPill(account)}</a>`,
                )
                .join('')}</div>`
            : empty(
                'Connect your first number',
                'Link a business number to start receiving customer messages.',
                'phone',
                onboarding ? '' : '<a class="quiet-link strong" href="#numbers/new">Add WhatsApp number</a>',
              )
        }
        <div class="service-line"><span class="live-dot ${live ? '' : 'warn'}"></span>${live ? 'Gateway and reply worker active' : 'Reply services need attention'}</div>
      </section>
    </div>`;
  let requestId = 0;
  countUp(container);
  if (!reducedMotion()) {
    container.querySelectorAll('.donut-seg').forEach((segment, index) => {
      const arc = Number(segment.dataset.arc) || 0;
      segment.animate([{ strokeDasharray: '0 100' }, { strokeDasharray: `${arc} ${100 - arc}` }], {
        duration: 720,
        delay: 110 + index * 110,
        easing: 'cubic-bezier(.2,.75,.3,1)',
        fill: 'backwards',
      });
    });
  }
  container.querySelectorAll('[data-days]').forEach(
    (button) =>
      (button.onclick = async () => {
        const next = Number(button.dataset.days);
        if (next === days && !container.querySelector('.chart-error')) return;
        days = next;
        const selected = ++requestId;
        container.querySelectorAll('[data-days]').forEach((item) => {
          const current = item === button;
          item.classList.toggle('selected', current);
          item.setAttribute('aria-pressed', String(current));
        });
        const plot = container.querySelector('#activity-chart');
        plot.setAttribute('aria-busy', 'true');
        try {
          const data = await api('/dashboard/activity?days=' + days, { signal });
          if (selected === requestId && !signal.aborted) plot.innerHTML = chart(data, days);
        } catch (error) {
          if (!signal.aborted && selected === requestId)
            plot.innerHTML = `<p class="chart-error">${esc(error.message)}</p>`;
        } finally {
          if (selected === requestId) plot.removeAttribute('aria-busy');
        }
      }),
  );
}
