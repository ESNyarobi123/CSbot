import { setTimeout as sleep } from 'node:timers/promises';
import makeWASocket, { Browsers, DisconnectReason, downloadContentFromMessage, isLidUser, isPnUser,
  jidNormalizedUser, normalizeMessageContent, proto, type WAMessage } from 'baileys';
import { config, sessionKey } from './config.js';
import { shop } from './csolution-pos.js';
import { db, log, row, transaction } from './db.js';
import { beat } from './heartbeat.js';
import { isIgnoredJid, pairingNumber } from './jid.js';
import { downloadImage, maxImageBytes } from './media.js';
import { blockedLinkStates, codeRequestMs, qrLifetimeMs } from './pairing.js';
import { seal } from './secrets.js';
import { ingest, phoneOf } from './store.js';
import { whatsappAuth } from './whatsapp-auth.js';

interface Account {
  id: string;
  phone: string | null;
  mode: 'mock' | 'baileys';
  status: string;
  session_version: number;
  pairing_phone: string | null;
  pending_pairing_id: string | null;
}
type Socket = ReturnType<typeof makeWASocket>;

interface Outbound {
  id: string;
  conversation_id: string;
  jid: string;
  origin: 'bot' | 'handoff' | 'admin' | 'alert';
  body: string;
  image_url: string | null;
  provider_id: string;
}

class Session {
  private socket?: Socket;
  private open = false;
  private stopped = false;
  private connecting = false;
  private pendingSend?: Promise<void>;
  private presenceBusy = false;
  private requestedCode?: string;
  private qrOffered = false;
  private verifying = false;
  private eventChain = Promise.resolve();
  private historyJobs = new Set<Promise<void>>();
  private reconnectAt = 0;
  private failures = 0;
  private blocked = false;

  constructor(public account: Account) {
    this.blocked = blockedLinkStates.includes(account.status);
  }

  /** The gateway re-reads accounts every tick so a pairing request is picked up without a restart. */
  update(account: Account) {
    this.account = account;
  }

  private async status(status: string, qr?: string) {
    const { id, session_version: version } = this.account;
    await db.query(`UPDATE accounts SET status=$3,qr=$4,
      qr_at=CASE WHEN $4::text IS NOT NULL THEN now() ELSE NULL END
      WHERE id=$1 AND session_version=$2 AND enabled`,
    [id, version, status, qr ? seal(qr, `qr:${id}:${version}`) : null]);
  }

  private retry(immediate = false) {
    this.open = false;
    if (immediate) {
      // restartRequired is routine: WhatsApp asks every client to reopen after pairing or a session change.
      this.reconnectAt = 0;
      return;
    }
    this.failures += 1;
    this.reconnectAt = Date.now() + Math.min(60000, 1000 * 2 ** Math.min(this.failures, 6));
  }

  private onEvent(work: () => Promise<void>) {
    this.eventChain = this.eventChain.then(async () => {
      if (this.stopped) return;
      for (let attempt = 1; ; attempt += 1) {
        try { await work(); return; } catch (error) {
          if (attempt >= 4 || this.stopped) {
            log.error({ account: this.account.id, code: (error as Error).name }, 'WhatsApp event could not be saved');
            return;
          }
          await sleep(1000 * attempt);
        }
      }
    });
  }

  private async consume(socket: Socket, message: WAMessage, historical: boolean) {
    const actual = socket.user?.id && phoneOf(jidNormalizedUser(socket.user.id));
    // Before a QR link completes the account has no number yet; consume adopts it on connect.
    if (this.account.phone && actual !== this.account.phone) return;
    const rawJid = message.key.remoteJid;
    const id = message.key.id;
    if (!rawJid || !id || isIgnoredJid(rawJid) || (!isPnUser(rawJid) && !isLidUser(rawJid))) return;
    const content = normalizeMessageContent(message.message);
    if (!content || content.protocolMessage || content.reactionMessage || content.senderKeyDistributionMessage) return;
    const jid = jidNormalizedUser(rawJid);
    const alt = message.key.remoteJidAlt ??
      (isLidUser(jid) ? await socket.signalRepository.lidMapping.getPNForLID(jid) : undefined);
    const text = content.conversation ?? content.extendedTextMessage?.text ?? content.imageMessage?.caption
      ?? content.videoMessage?.caption ?? content.documentMessage?.caption
      ?? content.buttonsResponseMessage?.selectedDisplayText ?? content.listResponseMessage?.title
      ?? content.interactiveResponseMessage?.body?.text;
    const key = Object.keys(content).find(value => value.endsWith('Message')) ?? 'text';
    const kind = content.conversation || content.extendedTextMessage ? 'text' : key.replace(/Message$/, '');
    const timestamp = Number(message.messageTimestamp ?? 0);
    const image = !historical && !message.key.fromMe && content.imageMessage
      ? await this.readImage(content.imageMessage) : undefined;
    const conversationId = await ingest({
      image,
      accountId: this.account.id, providerId: id, jid,
      alternateJid: alt && (isPnUser(alt) || isLidUser(alt)) ? jidNormalizedUser(alt) : undefined,
      name: message.key.fromMe ? undefined : message.pushName?.slice(0, 100) ?? undefined,
      body: text?.trim().slice(0, 3500) || `[WhatsApp ${kind}]`, kind,
      occurredAt: timestamp > 0 && timestamp < 4102444800 ? new Date(timestamp * 1000) : new Date(),
      fromMe: Boolean(message.key.fromMe), historical, sessionVersion: this.account.session_version,
    });
    if (!conversationId || historical || message.key.fromMe) return;
    // Blue ticks tell the customer that CSbot has received the message.
    await socket.readMessages([message.key]).catch(() => undefined);
  }

  private async readImage(image: proto.Message.IImageMessage) {
    if (!image?.mimetype || !/^image\/(?:jpeg|png|webp)$/.test(image.mimetype)) return;
    if (Number(image.fileLength ?? 0) > maxImageBytes) return;
    try {
      const stream = await downloadContentFromMessage(image, 'image', { options: { signal: AbortSignal.timeout(6000) } });
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of stream) {
        size += Buffer.byteLength(chunk);
        if (size > maxImageBytes) return;
        chunks.push(Buffer.from(chunk));
      }
      if (!chunks.length) return;
      return { bytes: Buffer.concat(chunks), mimetype: image.mimetype };
    } catch (error) {
      log.warn({ account: this.account.id, code: (error as Error).name }, 'Inbound media could not be stored');
    }
  }

  private async pumpPresence() {
    if (!this.open || this.stopped) return;
    // Drain ephemeral typing signals even for mock accounts so the table never grows without a socket.
    const signals = await db.query<{ jid: string; kind: 'composing' | 'paused' }>(
      `DELETE FROM gateway_signals WHERE id IN (
        SELECT id FROM gateway_signals WHERE account_id=$1 ORDER BY id LIMIT 25) RETURNING jid,kind`,
      [this.account.id]);
    if (this.account.mode !== 'baileys' || !this.socket) return;
    for (const signal of signals.rows) {
      await this.socket.sendPresenceUpdate(signal.kind, signal.jid).catch(() => undefined);
    }
  }

  private async requestPairing(socket: Socket, phone: string, requestId: string) {
    const { id, session_version: version } = this.account;
    try {
      const code = await socket.requestPairingCode(pairingNumber(phone));
      await db.query(`UPDATE accounts SET pairing_code=$3,pairing_code_at=now()
        WHERE id=$1 AND session_version=$2 AND enabled AND pairing_request_id=$4
          AND pairing_requested_at > now()-($5::int * interval '1 ms')`,
      [id, version, seal(code, `pairing:${id}:${version}`), requestId, codeRequestMs]);
    } catch (error) {
      await db.query(`UPDATE accounts SET pairing_error=true
        WHERE id=$1 AND session_version=$2 AND pairing_request_id=$3`, [id, version, requestId]);
      log.warn({ account: id, code: (error as Error).name }, 'Pairing code request failed');
    }
  }

  /** Delivery and read receipts arrive as messages.update; they never contain message content. */
  private async acknowledge(providerId: string, status: number) {
    if (status < proto.WebMessageInfo.Status.DELIVERY_ACK) return;
    await db.query(`UPDATE outbound SET delivered_at=COALESCE(delivered_at,now()),
      read_at=CASE WHEN $3::int >= 4 THEN COALESCE(read_at,now()) ELSE read_at END
      WHERE account_id=$1 AND provider_id=$2`, [this.account.id, providerId, status]);
  }

  async tick() {
    if (this.stopped || this.blocked) return;
    if (this.account.mode === 'mock' && !this.open) {
      if (!config.ALLOW_MOCK) return;
      await this.status('mock');
      this.open = true;
    }
    if (this.open && !this.pendingSend) {
      this.pendingSend = this.dispatch().catch(error => {
        log.warn({ account: this.account.id, code: (error as Error).name }, 'Outbound check failed');
      }).finally(() => { this.pendingSend = undefined; });
    }
    if (this.open && !this.presenceBusy) {
      this.presenceBusy = true;
      void this.pumpPresence().catch(error => {
        log.warn({ account: this.account.id, code: (error as Error).name }, 'Presence update failed');
      }).finally(() => { this.presenceBusy = false; });
    }
    const { pending_pairing_id: requestId, pairing_phone: phone } = this.account;
    const socket = this.socket;
    if (socket && this.qrOffered && !this.verifying && !this.open && requestId && phone &&
        this.requestedCode !== requestId) {
      this.requestedCode = requestId;
      this.onEvent(async () => {
        if (this.socket === socket && !this.verifying && !this.open && this.account.pending_pairing_id === requestId) {
          await this.requestPairing(socket, phone, requestId);
        }
      });
    }
    if (this.account.mode === 'mock' || this.socket || this.connecting || Date.now() < this.reconnectAt) return;
    this.connecting = true;
    void this.connect().catch(async error => {
      this.retry();
      log.warn({ account: this.account.id, code: (error as Error).name }, 'WhatsApp connection could not start');
      await this.status('reconnecting').catch(() => undefined);
    }).finally(() => { this.connecting = false; });
  }

  private async connect() {
    const auth = await whatsappAuth(this.account.id, this.account.session_version);
    await this.status(this.verifying ? 'verifying' : 'connecting');
    if (this.stopped) return;
    const socket = makeWASocket({
      // macOS Chrome is the browser profile WhatsApp expects from a linked device; Desktop can fail to issue a QR.
      auth: auth.state, browser: Browsers.macOS('Chrome'), logger: log.child({}, { level: 'silent' }),
      emitOwnEvents: false, markOnlineOnConnect: false, syncFullHistory: config.SYNC_FULL_HISTORY,
      connectTimeoutMs: 20000, defaultQueryTimeoutMs: 10000, qrTimeout: qrLifetimeMs,
      // Groups, status updates and newsletters are not part of a sales inbox.
      shouldIgnoreJid: jid => isIgnoredJid(jid),
    });
    this.socket = socket;
    socket.ev.on('creds.update', () => this.onEvent(async () => { await auth.saveCreds(); }));
    socket.ev.on('connection.update', update => {
      if (this.socket !== socket || this.stopped) return;
      if (update.connection === 'close') this.open = false;
      this.onEvent(async () => {
        if (this.socket !== socket) return;
        if (update.isNewLogin) {
          this.verifying = true;
          this.qrOffered = false;
          await this.status('verifying');
        }
        if (update.qr && !this.verifying) {
          this.failures = 0;
          this.qrOffered = true;
          await this.status('pairing', update.qr);
        }
        if (update.connection === 'open') {
          const actual = socket.user?.id && phoneOf(jidNormalizedUser(socket.user.id));
          if (actual && !this.account.phone) {
            // The QR flow links first and learns the number second, so the shop never has to type it.
            try {
              await db.query('UPDATE accounts SET phone=$2 WHERE id=$1 AND phone IS NULL', [this.account.id, actual]);
              this.account.phone = actual;
              log.info({ account: this.account.id }, 'WhatsApp number learned from the linked device');
            } catch (error) {
              log.warn({ account: this.account.id, code: (error as Error).name }, 'Linked number could not be stored');
            }
          }
          if (actual !== this.account.phone) {
            this.blocked = true;
            this.socket = undefined;
            socket.end(undefined);
            await this.status('wrong_number');
            return;
          }
          this.verifying = false;
          this.qrOffered = false;
          await db.query(`UPDATE accounts SET status='connected',qr=NULL,qr_at=NULL,
            pairing_phone=NULL,pairing_code=NULL,pairing_request_id=NULL,pairing_code_at=NULL,
            pairing_requested_at=NULL,pairing_error=false
            WHERE id=$1 AND session_version=$2 AND enabled`, [this.account.id, this.account.session_version]);
          this.failures = 0;
          this.open = true;
        }
        if (update.connection === 'close') {
          this.socket = undefined;
          this.qrOffered = false;
          const error = update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined;
          const code = error?.output?.statusCode;
          // A restart request is normal: WhatsApp wants the client to reopen, so reconnect without backoff.
          this.verifying = this.verifying && code === DisconnectReason.restartRequired;
          this.retry(code === DisconnectReason.restartRequired);
          if (code !== DisconnectReason.restartRequired) {
            log.warn({ account: this.account.id, disconnectCode: code }, 'WhatsApp connection closed');
          }
          const blocked = code === DisconnectReason.loggedOut || code === DisconnectReason.badSession
            ? 'logged_out' : code === DisconnectReason.connectionReplaced ? 'replaced'
              : code === DisconnectReason.forbidden || code === DisconnectReason.multideviceMismatch ? 'blocked' : '';
          this.blocked = Boolean(blocked);
          await this.status(blocked || (this.verifying ? 'verifying' : 'reconnecting'));
        }
      });
    });
    socket.ev.on('messages.upsert', event => {
      if (this.socket !== socket || this.stopped) return;
      for (const message of event.messages) {
        this.onEvent(() => this.consume(socket, message, event.type !== 'notify'));
      }
    });
    socket.ev.on('messages.update', updates => {
      if (this.socket !== socket || this.stopped) return;
      for (const item of updates) {
        const status = Number(item.update.status ?? 0);
        if (item.key.id && status >= proto.WebMessageInfo.Status.DELIVERY_ACK) {
          this.onEvent(() => this.acknowledge(item.key.id!, status));
        }
      }
    });
    socket.ev.on('messaging-history.set', event => {
      if (this.socket !== socket || this.stopped) return;
      const job = (async () => {
        for (const message of event.messages) {
          if (this.stopped || this.socket !== socket) break;
          await this.consume(socket, message, true);
        }
      })().catch(error => log.warn({ account: this.account.id, code: error.name }, 'History import interrupted'));
      this.historyJobs.add(job);
      void job.finally(() => this.historyJobs.delete(job));
    });
  }

  private pickOutbound() {
    const { id, session_version: version } = this.account;
    return row<Outbound>(db, `UPDATE outbound o SET state='sending',attempted_at=now()
      WHERE o.id=(SELECT out.id FROM outbound out JOIN accounts a ON a.id=out.account_id
        WHERE out.account_id=$1 AND out.state='queued' AND a.enabled AND a.session_version=$2 ORDER BY out.id LIMIT 1
        FOR UPDATE OF out SKIP LOCKED) RETURNING o.*`, [id, version]);
  }

  private async dispatch() {
    const { id, session_version: version } = this.account;
    const picked = await this.pickOutbound();
    if (!picked) return;
    const mock = this.account.mode === 'mock';
    const image = !mock && picked.image_url ? await downloadImage(picked.image_url).catch(() => undefined) : undefined;
    try {
      await transaction(async client => {
        const conversation = await row(client, 'SELECT mode FROM conversations WHERE id=$1 FOR NO KEY UPDATE',
          [picked.conversation_id]);
        const sendState = await row(client, 'SELECT state FROM outbound WHERE id=$1', [picked.id]);
        if (sendState?.state !== 'sending') return;
        const account = await row(client, 'SELECT enabled,session_version FROM accounts WHERE id=$1', [id]);
        const canceled = !account?.enabled || account.session_version !== version ||
          (picked.origin === 'bot' && conversation?.mode !== 'bot') ||
          (picked.origin === 'alert' && !await row(client, `SELECT 1 FROM admin_numbers
            WHERE account_id=$1 AND phone=$2`, [id, phoneOf(picked.jid)]));
        if (canceled) {
          await client.query("UPDATE outbound SET state='canceled',reason='settings_changed' WHERE id=$1", [picked.id]);
          return;
        }
        if (!this.open || this.stopped || (!mock && !this.socket)) {
          await client.query("UPDATE outbound SET state='queued',attempted_at=NULL WHERE id=$1", [picked.id]);
          return;
        }
        let body = picked.body;
        if (picked.image_url && !mock && !image) body += '\nPicha haipatikani kwa sasa / Photo unavailable right now.';
        if (!mock) {
          const socket = this.socket!;
          // Close the socket on the deadline to avoid leaving a send in flight after releasing the conversation lock.
          const deadline = setTimeout(() => {
            this.open = false;
            socket.end(new Error('Message submission timed out'));
          }, 20000);
          try {
            const sent = await socket.sendMessage(picked.jid, image ? { ...image, caption: body } : { text: body },
              { messageId: picked.provider_id, mediaUploadTimeoutMs: 10000 });
            if (!sent?.key.id) throw new Error('Message submission was not confirmed');
          } finally {
            clearTimeout(deadline);
          }
        }
        await client.query("UPDATE outbound SET state='sent',body=$2,sent_at=now() WHERE id=$1", [picked.id, body]);
        if (picked.origin !== 'alert') {
          await client.query(`INSERT INTO messages (conversation_id,provider_id,direction,actor,body,kind,occurred_at)
            VALUES ($1,$2,'outbound',$3,$4,$5,now()) ON CONFLICT DO NOTHING`,
          [picked.conversation_id, picked.provider_id, picked.origin === 'admin' ? 'admin' : 'bot',
            body, image || (mock && picked.image_url) ? 'image' : 'text']);
          await client.query('UPDATE conversations SET last_body=left($2,240),last_at=now() WHERE id=$1',
            [picked.conversation_id, body]);
        }
      });
      await this.socket?.sendPresenceUpdate('paused', picked.jid).catch(() => undefined);
    } catch (error) {
      await db.query("UPDATE outbound SET state='uncertain',reason='submission_unconfirmed' WHERE id=$1 AND state='sending'",
        [picked.id]);
      log.warn({ account: id, outboundId: picked.id, code: (error as Error).name }, 'WhatsApp submission unconfirmed');
    }
  }

  async stop() {
    this.stopped = true;
    this.open = false;
    this.socket?.end(undefined);
    await Promise.allSettled([this.pendingSend, this.eventChain, ...this.historyJobs]);
  }
}

sessionKey();
const owner = await db.connect();
const sessions = new Map<string, Session>();
let stopping = false;
let hasLock = false;
let lockLost = false;
const stop = () => { stopping = true; };
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, stop);
owner.on('error', () => { lockLost = true; stop(); });

try {
  // A session gateway holds this PostgreSQL connection for its lifetime.
  while (!stopping && !hasLock) {
    hasLock = Boolean((await row(owner, "SELECT pg_try_advisory_lock(hashtextextended('csbot-gateway',0)) AS owns"))?.owns);
    if (!hasLock) await sleep(2000);
  }
  if (hasLock && !stopping) {
    await owner.query(`UPDATE outbound SET state='uncertain',reason='gateway_restarted'
      WHERE state='sending'`);
    await owner.query(`UPDATE accounts SET status='offline', qr=NULL, qr_at=NULL
      WHERE status NOT IN ('logged_out','wrong_number','replaced','blocked')`);
    log.info('WhatsApp gateway started');
  }
  let lastBeat = 0;
  while (!stopping) {
    const accounts = (await owner.query<Account>(`SELECT id,phone,mode,status,session_version,pairing_phone,
      CASE WHEN NOT pairing_error AND pairing_code IS NULL AND pairing_requested_at >
        now()-($1::int * interval '1 ms') THEN pairing_request_id END AS pending_pairing_id
      FROM accounts WHERE enabled`, [codeRequestMs])).rows;
    const byId = new Map(accounts.map(account => [account.id, account]));
    for (const [id, session] of sessions) {
      if (byId.get(id)?.session_version === session.account.session_version) continue;
      await session.stop();
      sessions.delete(id);
    }
    for (const account of accounts) {
      let session = sessions.get(account.id);
      if (!session) {
        session = new Session(account);
        sessions.set(account.id, session);
      } else {
        session.update(account);
      }
      await session.tick();
    }
    // Health checks read this row; writing it every ten seconds also proves the DB connection is alive.
    if (Date.now() - lastBeat > 10000) {
      lastBeat = Date.now();
      await beat('whatsapp-gateway', { sessions: sessions.size, accounts: accounts.length });
    }
    if (!stopping) await sleep(500);
  }
} finally {
  await Promise.allSettled([...sessions.values()].map(session => session.stop()));
  if (hasLock && !lockLost) {
    await owner.query(`UPDATE accounts SET status='offline',qr=NULL,qr_at=NULL
      WHERE status IN ('connecting','pairing','verifying','connected','reconnecting','mock')`).catch(() => undefined);
    await owner.query("SELECT pg_advisory_unlock(hashtextextended('csbot-gateway',0))").catch(() => undefined);
  }
  owner.release();
  await Promise.all([db.end(), shop?.end()]);
}
if (lockLost) throw new Error('Gateway leadership connection was lost');
