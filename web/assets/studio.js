import { api, icon, esc, btn, heading, notify, stagePill } from './ui.js';

/**
 * A customer simulator on the real reply engine.
 *
 * The admin types the way a customer does and sees two things: the message a
 * real customer would receive, and the reasoning behind it — the device it
 * read, the datasheet fields it used, the site facts it remembered. Nothing is
 * sent to WhatsApp and no customer chat is touched.
 */
const starters = [
  'Nahitaji access point ya mita 300',
  'TP LINK EAP 650 ina mesh na inasimamia wateja wangapi?',
  'Nina Omada controller, nahitaji AP mbili za hoteli',
  'Nielezee mesh technology kwa ufupi',
];

export async function studio(container, signal) {
  let turns = [];
  let busy = false;
  let picked = 0;

  container.innerHTML = `${heading(
    'Studio',
    'Talk to CSbot like a customer. Every answer shows the facts and steps behind it.',
    btn('Reset', 'refresh', 'data-reset'),
  )}
    <div class="studio">
      <section class="card chat-pane">
        <header class="chat-head">
          <span class="chat-avatar">${icon('bot', 19)}</span>
          <div><b>CSbot</b><small id="chat-status">Ready — Gemini not used for this answer yet</small></div>
          <span class="pill green"><span class="pill-dot"></span>Live engine</span>
        </header>
        <div class="chat-log" id="chat-log" aria-live="polite"></div>
        <div class="chat-starters" id="chat-starters">
          ${starters.map((text, index) =>
            `<button type="button" class="starter" data-starter="${index}">${esc(text)}</button>`).join('')}
        </div>
        <form class="chat-form" id="chat-form">
          <button type="button" class="chat-attach" id="chat-attach" aria-label="Attach a photo of the device">${icon('image', 17)}</button>
          <input type="file" id="chat-file" accept="image/jpeg,image/png,image/webp" hidden>
          <label class="sr-only" for="chat-input">Message CSbot</label>
          <textarea id="chat-input" rows="1" maxlength="1200"
            placeholder="Andika kama mteja… (e.g. Nahitaji AP ya nje)"></textarea>
          <button class="btn primary" type="submit" aria-label="Send">${icon('send', 17)}</button>
        </form>
        <p class="chat-attached" id="chat-attached" hidden></p>
      </section>
      <aside class="card trace-pane" id="trace-pane" aria-live="polite">
        ${traceEmpty()}
      </aside>
    </div>`;

  const log = container.querySelector('#chat-log');
  const pane = container.querySelector('#trace-pane');
  const form = container.querySelector('#chat-form');
  const field = container.querySelector('#chat-input');
  const status = container.querySelector('#chat-status');
  const file = container.querySelector('#chat-file');
  const attached = container.querySelector('#chat-attached');
  // A photo is read by the same vision path the WhatsApp worker uses; the studio
  // keeps it beside the message so the trace can prove what was recognised.
  let pending = null;

  function drawAttached() {
    attached.hidden = !pending;
    attached.textContent = pending ? `Photo attached — it will be read with your next message` : '';
  }

  function scroll() {
    log.scrollTop = log.scrollHeight;
  }

  function draw() {
    container.querySelector('#chat-starters').hidden = turns.length > 0;
    log.innerHTML = turns.length ? turns.map((turn, index) => `
      <div class="bubble customer">${turn.photo ? `<span class="bubble-photo">${icon('image', 13)} Picha ya kifaa</span>` : ''}${esc(turn.customer)}
      </div>
      <div class="bubble bot">
        ${esc(turn.reply).replace(/\n/g, '<br>')}
        <footer><span>${turn.ms} ms</span>${turn.stage ? stagePill(turn.stage) : ''}
          <button type="button" class="trace-link" data-trace="${index}">${icon('search', 13)}Why?</button></footer>
      </div>`).join('') : `<div class="chat-blank">
        <span class="empty-icon">${icon('inbox', 22)}</span>
        <p>Send the first message. The bot answers from the same catalog, datasheets and memory it uses on WhatsApp.</p>
      </div>`;
    log.querySelectorAll('[data-trace]').forEach((button) =>
      (button.onclick = () => {
        picked = Number(button.dataset.trace);
        trace();
        log.querySelectorAll('[data-trace]').forEach(item => item.classList.toggle('active', item === button));
      }));
    scroll();
  }

  function traceEmpty() {
    return `<header class="card-head"><div class="card-title"><span class="card-icon">${icon('book', 17)}</span>
      <div><h2>How it answered</h2><p>Facts read, memory kept, and the step that decided the reply</p></div></div></header>
      <div class="trace-body"><div class="empty"><span class="empty-icon">${icon('search', 22)}</span>
        <strong>No answer yet</strong><p>Send a message and this panel shows what the bot looked up.</p></div></div>`;
  }

  function trace() {
    const turn = turns[picked];
    if (!turn) {
      pane.innerHTML = traceEmpty();
      return;
    }
    pane.innerHTML = `<header class="card-head"><div class="card-title"><span class="card-icon">${icon('book', 17)}</span>
      <div><h2>How it answered</h2><p>Message ${picked + 1} of ${turns.length}</p></div></div></header>
      <div class="trace-body">
        <section><h3>Steps</h3><ol class="trace-steps">
          ${(turn.trace?.length ? turn.trace : ['Answered from the rule engine; no datasheet or knowledge was read'])
            .map(step => `<li>${esc(step)}</li>`).join('')}
        </ol></section>
        <section><h3>What it remembered</h3>
          ${turn.facts?.length ? `<div class="fact-chips">${turn.facts.map(fact =>
            `<span class="fact-chip"><b>${esc(fact.label)}</b>${esc(fact.value)}</span>`).join('')}</div>`
            : '<p class="trace-muted">Nothing site-specific in this chat yet.</p>'}
        </section>
        <section><h3>Reply</h3><p class="trace-reply">${esc(turn.reply).replace(/\n/g, '<br>')}</p>
          <p class="trace-muted">${turn.ms} ms · ${turn.stage ? 'stage: ' + esc(turn.stage) : 'no stage change'}</p></section>
      </div>`;
  }

  async function send(text, photo = pending) {
    const body = text.trim() || (photo ? 'Nimetuma picha ya kifaa' : '');
    if (busy || !body) return;
    busy = true;
    const history = turns.map(turn => turn.customer);
    history.push(body);
    log.insertAdjacentHTML('beforeend',
      `<div class="bubble customer pending">${photo ? `<span class="bubble-photo">${icon('image', 13)} Picha ya kifaa</span>` : ''}${esc(body)}</div><div class="bubble bot typing" id="typing">
        <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>`);
    scroll();
    try {
      const data = { messages: history.slice(-12) };
      if (photo) data.photo = { base64: photo.base64, mimetype: photo.mimetype };
      const result = await api('/playground', { method: 'POST', data, signal });
      turns = result.turns;
      picked = turns.length - 1;
      if (photo) pending = null;
      drawAttached();
      status.textContent = result.vision
        ? `Vision ready · ${result.model ?? 'Gemini'}`
        : 'Rule engine only — Gemini is not configured, so photos cannot be read';
    } catch (error) {
      notify(error.message, true);
      turns = turns.concat([{ customer: body, reply: 'CSbot could not answer that one. Try again.',
        trace: [], facts: [], stage: null, ms: 0, photo: Boolean(photo) }]);
    } finally {
      busy = false;
      draw();
      trace();
    }
  }

  form.onsubmit = (event) => {
    event.preventDefault();
    const text = field.value;
    field.value = '';
    field.style.height = '';
    void send(text);
  };
  field.oninput = () => {
    field.style.height = 'auto';
    field.style.height = Math.min(120, field.scrollHeight) + 'px';
  };
  field.onkeydown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  };
  container.querySelectorAll('[data-starter]').forEach((button) =>
    (button.onclick = () => void send(starters[Number(button.dataset.starter)])));
  container.querySelector('#chat-attach').onclick = () => file.click();
  file.onchange = async () => {
    const chosen = file.files?.[0];
    file.value = '';
    if (!chosen) return;
    if (chosen.size > 4_000_000) return notify('Photo is too large — use one under 4 MB', true);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(chosen.type)) {
      return notify('Send a JPEG, PNG or WebP photo', true);
    }
    const url = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(chosen);
    }).catch(() => undefined);
    if (!url) return notify('That photo could not be read', true);
    pending = { base64: url.split(',')[1], mimetype: chosen.type };
    drawAttached();
    field.focus();
  };
  container.querySelector('[data-reset]').onclick = () => {
    turns = [];
    picked = 0;
    pending = null;
    drawAttached();
    status.textContent = 'Ready — Gemini not used for this answer yet';
    draw();
    trace();
    field.focus();
  };

  if (signal.aborted) return;
  draw();
  trace();
  field.focus();
}
