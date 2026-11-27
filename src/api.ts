import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Header, Headers, HttpCode, Injectable, Module,
  NotFoundException, Param, Patch, Post, Put, Query, Res, ServiceUnavailableException, StreamableFile, UnauthorizedException, UseGuards,
  type CanActivate, type ExecutionContext,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import qrcode from 'qrcode';
import { z } from 'zod';
import { customerTurn as respond } from './assistant.js';
import { factList } from './brain.js';
import { config } from './config.js';
import { adminAuthorized, DashboardController, dashboardDir, type DashboardRequest } from './dashboard.js';
import { db, row, transaction } from './db.js';
import { imageAllowed, downloadImage, maxImageBytes } from './media.js';
import { blockedLinkStates, codeDisplayMs, codeRequestMs, qrLifetimeMs } from './pairing.js';
import { catalog, productImageRef, readProduct } from './pos.js';
import { advanceSale, currentSale, openSale, saleByRequest, salesHistory, withoutQuote } from './sales.js';
import { seal, unseal } from './secrets.js';
import { listSpecs, saveSpec } from './specs.js';
import { enqueue, ingest, recipient, setMode, type Conversation } from './store.js';
import { audioAllowed, audioType } from './voice.js';
import { authorizedDiagnostic, diagnosticReport, recordDiagnostic } from './support-diagnostics.js';

function read<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException(result.error.issues.map(issue => `${issue.path.join('.') || 'input'}: ${issue.message}`));
  }
  return result.data;
}

const idSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/);
const recordId = z.string().regex(/^[1-9]\d{0,17}$/);
const phone = z.string().trim().regex(/^\+?[1-9]\d{6,14}$/).transform(value => value.replace(/^\+/, ''));
const bodyText = z.string().trim().min(1).max(3500);
const pageSize = z.coerce.number().int().min(1).max(100).default(30);

@Injectable()
class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const http = context.switchToHttp();
    if (!adminAuthorized(http.getRequest<DashboardRequest>())) throw new UnauthorizedException();
    http.getResponse().setHeader('Cache-Control', 'no-store');
    return true;
  }
}

@Controller()
class HealthController {
  @Get('health/live')
  live() { return { status: 'ok', service: 'CSbot API' }; }

  @Get('health/ready')
  async ready() {
    try {
      await db.query('SELECT 1 FROM accounts LIMIT 1');
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException();
    }
  }
}

@Controller('v1')
@UseGuards(AdminGuard)
class AdminController {
  @Get('accounts')
  async accounts() {
    return (await db.query(`SELECT id,label,phone,mode,enabled,status,qr_at,
      pairing_phone IS NOT NULL AS pairing FROM accounts ORDER BY id`)).rows;
  }

  @Post('accounts')
  async create(@Body() body: unknown) {
    const account = read(z.object({
      id: idSchema, label: z.string().trim().min(1).max(100), phone: phone.optional(),
      mode: z.enum(['baileys', 'mock']).default('baileys'),
    }), body);
    if (account.mode === 'mock' && !config.ALLOW_MOCK) throw new ForbiddenException('Mock mode is disabled');
    // A QR-first link can start without the number; the gateway adopts it from the phone that scans.
    const result = await row(db, `INSERT INTO accounts (id,label,phone,mode) VALUES ($1,$2,$3,$4)
      ON CONFLICT DO NOTHING RETURNING id,label,phone,mode,status,enabled`,
    [account.id, account.label, account.phone ?? null, account.mode]);
    if (!result) throw new BadRequestException('Account ID or WhatsApp number already exists');
    return result;
  }

  @Post('accounts/:id/pairing-code')
  @HttpCode(200)
  async pairingCode(@Param('id') id: string) {
    read(idSchema, id);
    return transaction(async client => {
      const account = await row<{ phone: string | null; status: string; enabled: boolean;
        pending: boolean; has_code: boolean }>(client, `SELECT phone,status,enabled,
        NOT pairing_error AND pairing_code IS NULL AND
          pairing_requested_at > now()-($2::int * interval '1 ms') AS pending,
        pairing_code IS NOT NULL AND pairing_code_at > now()-($3::int * interval '1 ms') AS has_code
        FROM accounts WHERE id=$1 AND mode='baileys' FOR NO KEY UPDATE`, [id, codeRequestMs, codeDisplayMs]);
      if (!account) throw new NotFoundException('Baileys account not found');
      if (!account.phone) throw new BadRequestException('Register the account phone number before pairing');
      if (!account.enabled || ['connected', 'verifying'].includes(account.status)) {
        throw new ConflictException('Pairing requires an enabled account that is not linked or verifying');
      }
      if (blockedLinkStates.includes(account.status)) {
        throw new ConflictException('Reset the device link before requesting a pairing code');
      }
      if (account.pending || account.has_code) {
        return { status: account.has_code ? 'ready' : 'requested', phone: account.phone };
      }
      await client.query(`UPDATE accounts SET pairing_phone=phone,pairing_code=NULL,pairing_code_at=NULL,
        pairing_request_id=$2,pairing_requested_at=now(),pairing_error=false WHERE id=$1`, [id, randomUUID()]);
      return { status: 'requested', phone: account.phone };
    });
  }

  @Patch('accounts/:id')
  async edit(@Param('id') id: string, @Body() body: unknown) {
    read(idSchema, id);
    const patch = read(z.object({ enabled: z.boolean() }), body);
    const result = await row(db, `UPDATE accounts SET enabled=$2,
      status=CASE WHEN $2 THEN status ELSE 'offline' END,
      qr=CASE WHEN $2 THEN qr ELSE NULL END,qr_at=CASE WHEN $2 THEN qr_at ELSE NULL END,
      pairing_phone=CASE WHEN $2 THEN pairing_phone ELSE NULL END,
      pairing_code=CASE WHEN $2 THEN pairing_code ELSE NULL END,
      pairing_request_id=CASE WHEN $2 THEN pairing_request_id ELSE NULL END,
      pairing_requested_at=CASE WHEN $2 THEN pairing_requested_at ELSE NULL END,
      pairing_code_at=CASE WHEN $2 THEN pairing_code_at ELSE NULL END,
      pairing_error=$2 AND pairing_error
      WHERE id=$1 RETURNING id,label,phone,mode,status,enabled,
        pairing_phone IS NOT NULL AS pairing`, [id, patch.enabled]);
    if (!result) throw new NotFoundException();
    return result;
  }

  @Get('accounts/:id/pairing')
  @Header('Cache-Control', 'no-store')
  async pairing(@Param('id') id: string, @Query('format') format: unknown) {
    read(idSchema, id);
    const account = await row(db, `SELECT status,mode,enabled,session_version,pairing_phone,
      CASE WHEN enabled AND qr_at > now()-($2::int * interval '1 ms') THEN qr END AS qr,
      CASE WHEN enabled THEN GREATEST(0, EXTRACT(epoch FROM (qr_at +
        ($2::int * interval '1 ms') - now())) * 1000)::int ELSE 0 END AS qr_left,
      CASE WHEN enabled AND status NOT IN ('connected','verifying') AND
        pairing_code_at > now()-($3::int * interval '1 ms') THEN pairing_code END AS pairing_code,
      CASE WHEN enabled AND pairing_code_at > now()-($3::int * interval '1 ms')
        THEN GREATEST(0, EXTRACT(epoch FROM (pairing_code_at +
          ($3::int * interval '1 ms') - now())) * 1000)::int ELSE 0 END AS code_left,
      CASE WHEN NOT enabled OR pairing_request_id IS NULL THEN 'idle'
        WHEN pairing_error THEN 'failed'
        WHEN pairing_code_at > now()-($3::int * interval '1 ms') THEN 'ready'
        WHEN pairing_code_at IS NULL AND pairing_requested_at > now()-($4::int * interval '1 ms') THEN 'requesting'
        ELSE 'expired' END AS pairing_state,
      EXISTS (SELECT 1 FROM service_heartbeats WHERE name='whatsapp-gateway'
        AND beat_at > now()-interval '45 seconds') AS gateway_healthy,
      EXISTS (SELECT 1 FROM service_heartbeats WHERE name='worker'
        AND beat_at > now()-interval '45 seconds') AS worker_healthy
      FROM accounts WHERE id=$1`, [id, qrLifetimeMs, codeDisplayMs, codeRequestMs]);
    if (!account) throw new NotFoundException();
    const qr = account.qr ? unseal(account.qr, `qr:${id}:${account.session_version}`) : undefined;
    const code = account.pairing_code
      ? unseal(account.pairing_code, `pairing:${id}:${account.session_version}`) : null;
    const base = { status: account.status, mode: account.mode, enabled: account.enabled,
      pairingPhone: account.pairing_phone, pairingCode: code, pairingState: account.pairing_state,
      qrRemainingMs: qr ? account.qr_left : 0, qrLifetimeMs,
      codeRemainingMs: code ? account.code_left : 0, codeLifetimeMs: codeDisplayMs,
      gatewayHealthy: account.gateway_healthy, workerHealthy: account.worker_healthy };
    if (format === 'terminal') {
      return { ...base, qr: qr ? await qrcode.toString(qr, { type: 'terminal', small: true }) : null };
    }
    return { ...base, qrDataUrl: qr ? await qrcode.toDataURL(qr) : null };
  }

  @Post('accounts/:id/reset-session')
  @HttpCode(200)
  async reset(@Param('id') id: string) {
    read(idSchema, id);
    return transaction(async client => {
      const result = await row(client, `UPDATE accounts SET status='offline',qr=NULL,qr_at=NULL,
        pairing_phone=NULL,pairing_code=NULL,pairing_request_id=NULL,pairing_code_at=NULL,
        pairing_requested_at=NULL,pairing_error=false,session_version=session_version+1
        WHERE id=$1 AND mode='baileys' RETURNING id,status`, [id]);
      if (!result) throw new NotFoundException('Baileys account not found');
      await client.query('DELETE FROM whatsapp_auth WHERE account_id=$1', [id]);
      return result;
    });
  }

  @Put('accounts/:id/admin-numbers')
  async admins(@Param('id') id: string, @Body() body: unknown) {
    read(idSchema, id);
    const { numbers } = read(z.object({ numbers: z.array(phone).max(20) }), body);
    return transaction(async client => {
      const account = await row(client, 'SELECT phone FROM accounts WHERE id=$1 FOR NO KEY UPDATE', [id]);
      if (!account) throw new NotFoundException();
      const unique = [...new Set(numbers)];
      if (account.phone && unique.includes(account.phone)) throw new BadRequestException('Use a separate number for admin alerts');
      await client.query('DELETE FROM admin_numbers WHERE account_id=$1', [id]);
      await client.query('INSERT INTO admin_numbers (account_id,phone) SELECT $1,unnest($2::text[])', [id, unique]);
      return { numbers: unique };
    });
  }

  @Get('accounts/:id/admin-numbers')
  async listAdmins(@Param('id') id: string) {
    read(idSchema, id);
    if (!await row(db, 'SELECT 1 FROM accounts WHERE id=$1', [id])) throw new NotFoundException();
    return { numbers: (await db.query<{ phone: string }>('SELECT phone FROM admin_numbers WHERE account_id=$1 ORDER BY phone',
      [id])).rows.map(admin => admin.phone) };
  }

  @Get('conversations')
  async inbox(@Query() query: unknown) {
    const filters = read(z.object({
      account: idSchema.optional(), mode: z.enum(['human', 'bot']).optional(), q: z.string().trim().max(80).optional(),
      before: z.iso.datetime({ offset: true }).optional(), beforeId: recordId.optional(), limit: pageSize,
    }).refine(value => Boolean(value.before) === Boolean(value.beforeId), 'Supply before and beforeId together'), query);
    return (await db.query(`SELECT *,to_char(updated_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at FROM conversations
      WHERE ($1::text IS NULL OR account_id=$1) AND ($2::text IS NULL OR mode=$2)
        AND ($3::timestamptz IS NULL OR (updated_at,id)<($3,$4::bigint))
        AND ($6::text IS NULL OR concat_ws(' ',customer_name,customer_phone,last_body) ILIKE '%'||$6||'%')
      ORDER BY updated_at DESC,id DESC LIMIT $5`,
    [filters.account ?? null, filters.mode ?? null, filters.before ?? null, filters.beforeId ?? null, filters.limit,
      filters.q ?? null])).rows;
  }

  @Get('stats')
  async stats() {
    const totals = await row(db, `SELECT
      (SELECT count(*) FROM conversations)::int AS conversations,
      (SELECT count(*) FROM conversations WHERE mode='human')::int AS human,
      (SELECT count(*) FROM conversations WHERE unread_count>0)::int AS unread,
      (SELECT count(*) FROM messages WHERE processing='pending')::int AS pending,
      (SELECT count(*) FROM outbound WHERE state='queued')::int AS queued,
      (SELECT count(*) FROM outbound WHERE state='uncertain')::int AS uncertain,
      (SELECT count(*) FROM commercial_retries)::int AS pending_catalog_checks,
      (SELECT count(DISTINCT m.conversation_id) FROM messages m JOIN conversations c ON c.id=m.conversation_id
        JOIN accounts a ON a.id=c.account_id WHERE a.enabled AND m.processing='pending' AND
        m.received_at < now()-interval '2 minutes')::int AS stalled_chats,
      (SELECT count(*) FROM conversations c JOIN accounts a ON a.id=c.account_id
        WHERE a.enabled AND c.memory @> '{"handoffPending":true}' AND
          (SELECT direction FROM messages WHERE conversation_id=c.id AND kind NOT LIKE 'history:%'
            AND actor <> 'bot' ORDER BY occurred_at DESC,id DESC LIMIT 1) = 'inbound')::int AS handoffs_waiting,
      (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY elapsed))::int FROM (
        SELECT extract(epoch FROM (reply.occurred_at - incoming.occurred_at))::double precision AS elapsed
        FROM conversations c
        CROSS JOIN LATERAL (
          SELECT occurred_at FROM messages WHERE conversation_id=c.id AND direction='inbound'
            AND auto_reply AND kind NOT LIKE 'history:%' ORDER BY occurred_at,id LIMIT 1
        ) incoming
        CROSS JOIN LATERAL (
          SELECT occurred_at FROM messages WHERE conversation_id=c.id AND direction='outbound'
            AND occurred_at >= incoming.occurred_at AND kind NOT LIKE 'history:%'
          ORDER BY occurred_at,id LIMIT 1
        ) reply
        WHERE incoming.occurred_at >= now()-interval '7 days'
      ) first_replies) AS first_reply_median_seconds,
      (SELECT count(*) FROM sales WHERE closed_at IS NULL)::int AS open_sales`);
    const accounts = (await db.query(`SELECT id,status,enabled,
      (SELECT count(*) FROM outbound o WHERE o.account_id=accounts.id AND o.state='queued')::int AS queued
      FROM accounts ORDER BY id`)).rows;
    return { ...totals, accounts };
  }

  @Get('dashboard/sales')
  async dashboardSales(@Query() query: unknown) {
    const { before, limit } = read(z.object({ before: recordId.optional(), limit: pageSize }), query);
    return (await db.query(`SELECT s.id,s.conversation_id,s.stage,s.quote,s.opened_at,s.updated_at,s.closed_at,
      c.customer_name,c.customer_phone,a.label AS account_label
      FROM sales s JOIN conversations c ON c.id=s.conversation_id JOIN accounts a ON a.id=c.account_id
      WHERE ($1::bigint IS NULL OR s.id<$1) ORDER BY s.id DESC LIMIT $2`, [before ?? null, limit])).rows;
  }

  @Get('dashboard/activity')
  async activity(@Query('days') raw: unknown) {
    const days = Number(read(z.enum(['7','30']).default('7'), raw));
    const [activity, services] = await Promise.all([
      db.query(`WITH range AS (
        SELECT (now() AT TIME ZONE 'Africa/Dar_es_Salaam')::date-($1::int-1) AS first_day
      ), daily AS (
        SELECT (occurred_at AT TIME ZONE 'Africa/Dar_es_Salaam')::date AS day,
          count(*) FILTER (WHERE direction='inbound')::int AS received,
          count(*) FILTER (WHERE direction='outbound')::int AS sent
        FROM messages, range
        WHERE occurred_at >= (first_day::timestamp AT TIME ZONE 'Africa/Dar_es_Salaam')
          AND occurred_at <= now() AND kind NOT LIKE 'history:%'
        GROUP BY 1
      )
      SELECT to_char(first_day + offset_day, 'YYYY-MM-DD') AS date,
        COALESCE(received,0) AS received, COALESCE(sent,0) AS sent
      FROM range CROSS JOIN generate_series(0,$1::int-1) AS offset_day
      LEFT JOIN daily ON daily.day=first_day + offset_day ORDER BY offset_day`, [days]),
      db.query(`SELECT name, beat_at > now()-interval '45 seconds' AS healthy FROM service_heartbeats
        WHERE name IN ('worker','whatsapp-gateway')`),
    ]);
    return { activity: activity.rows, services: services.rows };
  }

  @Get('conversations/:id')
  async conversation(@Param('id') id: string) {
    read(recordId, id);
    const conversation = await row(db, 'SELECT * FROM conversations WHERE id=$1', [id]);
    if (!conversation) throw new NotFoundException();
    const [sale, sales, outbound, media] = await Promise.all([
      currentSale(db, id),
      db.query('SELECT * FROM sales_events WHERE conversation_id=$1 ORDER BY id DESC LIMIT 50', [id]),
      db.query(`SELECT id,provider_id,origin,state,reason,body,image_url,document_id,document_name,created_at,attempted_at,sent_at FROM outbound
        WHERE conversation_id=$1 ORDER BY id DESC LIMIT 50`, [id]),
      db.query(`SELECT id,kind,mimetype,size,created_at FROM media
        WHERE conversation_id=$1 ORDER BY id DESC LIMIT 20`, [id]),
    ]);
    return { ...conversation, sale: sale ?? null, sales: sales.rows, outbound: outbound.rows, media: media.rows };
  }

  @Get('media/:id')
  @Header('Cache-Control', 'private, max-age=300')
  async mediaItem(@Param('id') id: string) {
    read(recordId, id);
    const item = await row<{ id: string; kind: string; mimetype: string; size: number; created_at: Date; bytes: Buffer }>(
      db, 'SELECT id,kind,mimetype,size,created_at,bytes FROM media WHERE id=$1', [id]);
    if (!item) throw new NotFoundException();
    return { ...item, bytes: undefined,
      dataUrl: `data:${item.mimetype};base64,${item.bytes.toString('base64')}` };
  }

  @Get('conversations/:id/documents/:mediaId')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async downloadDocument(@Param('id') id: string, @Param('mediaId') mediaId: string) {
    read(recordId, id);
    read(recordId, mediaId);
    const item = await row<{ bytes: Buffer; document_name: string }>(db, `SELECT m.bytes,o.document_name FROM media m
      JOIN outbound o ON o.document_id=m.id AND o.conversation_id=m.conversation_id
      WHERE m.conversation_id=$1 AND m.id=$2 AND m.kind='document' AND o.state='sent'`, [id, mediaId]);
    if (!item) throw new NotFoundException();
    return new StreamableFile(item.bytes, { type: 'application/pdf',
      disposition: `attachment; filename="${item.document_name}"` });
  }

  @Get('conversations/:id/messages')
  async history(@Param('id') id: string, @Query() query: unknown) {
    read(recordId, id);
    const { before, limit } = read(z.object({ before: recordId.optional(), limit: pageSize }), query);
    if (!await row(db, 'SELECT 1 FROM conversations WHERE id=$1', [id])) throw new NotFoundException();
    return (await db.query(`SELECT id,direction,actor,body,kind,occurred_at,media_id FROM messages
      WHERE conversation_id=$1 AND ($2::bigint IS NULL OR (occurred_at,id) <
        (SELECT occurred_at,id FROM messages WHERE conversation_id=$1 AND id=$2))
      ORDER BY occurred_at DESC,id DESC LIMIT $3`,
    [id, before ?? null, limit])).rows;
  }

  @Patch('conversations/:id/mode')
  async mode(@Param('id') id: string, @Body() body: unknown) {
    read(recordId, id);
    const { mode } = read(z.object({ mode: z.enum(['bot', 'human']) }), body);
    return transaction(async client => {
      if (!await row(client, 'SELECT 1 FROM conversations WHERE id=$1 FOR NO KEY UPDATE', [id])) throw new NotFoundException();
      await setMode(client, id, mode);
      return { id, mode };
    });
  }

  @Patch('conversations/:id/read')
  async readConversation(@Param('id') id: string) {
    read(recordId, id);
    const updated = await row(db, 'UPDATE conversations SET unread_count=0 WHERE id=$1 RETURNING id,unread_count', [id]);
    if (!updated) throw new NotFoundException();
    return updated;
  }

  @Post('conversations/:id/messages')
  @HttpCode(202)
  async send(@Param('id') id: string, @Body() body: unknown) {
    read(recordId, id);
    const input = read(z.object({ text: bodyText, requestId: z.string().min(8).max(100),
      saleId: recordId.optional(),
      imageUrl: z.url({ protocol: /^https$/ }).optional(),
      invoicePdf: z.object({
        name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,110}\.pdf$/i),
        base64: z.base64().max(5_592_408),
      }).optional(),
      // A dashboard reply means "a human owns this chat". Automated notices
      // (billing, reseller, payment alerts) must pass false or they silence the
      // bot for every customer who receives one.
      takeover: z.boolean().default(true) }), body);
    if (input.imageUrl && !imageAllowed(input.imageUrl)) {
      throw new BadRequestException('Image host is not listed in PRODUCT_IMAGE_HOSTS');
    }
    const documentBytes = input.invoicePdf && Buffer.from(input.invoicePdf.base64, 'base64');
    if (input.saleId && !documentBytes) throw new BadRequestException('Attach an invoice to link it to an order');
    if (documentBytes && (input.imageUrl || input.text.length > 1000 ||
        documentBytes.length > 4 * 1024 * 1024 || documentBytes.subarray(0, 5).toString() !== '%PDF-')) {
      throw new BadRequestException('Attach one PDF up to 4 MB with a caption up to 1,000 characters');
    }
    const documentHash = documentBytes ? createHash('sha256').update(documentBytes).digest('hex') : null;
    return transaction(async client => {
      const conversation = await row<Conversation>(client, 'SELECT * FROM conversations WHERE id=$1 FOR NO KEY UPDATE', [id]);
      if (!conversation) throw new NotFoundException();
      const existing = await row(client, 'SELECT id,state,body,image_url,document_name,document_hash FROM outbound WHERE conversation_id=$1 AND request_key=$2',
        [id, input.requestId]);
      if (existing) {
        if (existing.body !== input.text || existing.image_url !== (input.imageUrl ?? null) ||
            existing.document_name !== (input.invoicePdf?.name ?? null) || existing.document_hash !== documentHash) {
          throw new BadRequestException('Request ID was used with different content');
        }
        if (input.saleId && !await row(client, `SELECT 1 FROM sales WHERE id=$1 AND conversation_id=$2
          AND quote#>>'{finalInvoice,outboundId}'=$3`, [input.saleId, id, existing.id])) {
          throw new BadRequestException('Request ID was used for a different order');
        }
        return { id: existing.id, state: existing.state };
      }
      const sale = input.saleId ? await currentSale(client, id) : undefined;
      if (input.saleId && (!sale || sale.id !== input.saleId || !sale.quote?.proforma ||
          !['paid', 'completed'].includes(sale.stage))) throw new ConflictException('The proforma order is no longer ready for its final invoice');
      let document;
      if (input.invoicePdf && documentBytes && documentHash) {
        const attachment = (await row<{ id: string }>(client, `INSERT INTO media
          (account_id,conversation_id,provider_id,kind,mimetype,bytes,size)
          VALUES ($1,$2,$3,'document','application/pdf',$4,$5) RETURNING id`,
        [conversation.account_id, id, randomUUID(), documentBytes, documentBytes.length]))!;
        document = { id: attachment.id, name: input.invoicePdf.name, hash: documentHash };
      }
      if (input.takeover) await setMode(client, id, 'human');
      const queued = await enqueue(client, { accountId: conversation.account_id, conversationId: id, jid: recipient(conversation),
        origin: 'admin', body: input.text, imageUrl: input.imageUrl, requestKey: input.requestId, document });
      if (document && queued && sale) {
        await client.query(`UPDATE sales SET quote=quote || $2::jsonb,updated_at=now() WHERE id=$1`, [
          sale.id, { finalInvoice: { outboundId: queued.id, mediaId: document.id, name: document.name } },
        ]);
      }
      return queued;
    });
  }

  @Get('conversations/:id/sales')
  async orders(@Param('id') id: string, @Query() query: unknown) {
    read(recordId, id);
    const { before, limit } = read(z.object({ before: recordId.optional(), limit: pageSize }), query);
    if (!await row(db, 'SELECT 1 FROM conversations WHERE id=$1', [id])) throw new NotFoundException();
    return salesHistory(id, before ?? null, limit);
  }

  @Get('conversations/:id/sales/:saleId')
  async orderDetail(@Param('id') id: string, @Param('saleId') saleId: string) {
    read(recordId, id);
    read(recordId, saleId);
    const sale = await row(db, `SELECT id,conversation_id,stage,quote,opened_at,updated_at,closed_at
      FROM sales WHERE id=$1 AND conversation_id=$2`, [saleId, id]);
    if (!sale) throw new NotFoundException();
    return sale;
  }

  @Get('conversations/:id/sales/:saleId/events')
  async orderEvents(@Param('id') id: string, @Param('saleId') saleId: string, @Query() query: unknown) {
    read(recordId, id);
    read(recordId, saleId);
    const { before, limit } = read(z.object({ before: recordId.optional(), limit: pageSize }), query);
    if (!await row(db, 'SELECT 1 FROM sales WHERE id=$1 AND conversation_id=$2', [saleId, id])) throw new NotFoundException();
    return (await db.query(`SELECT id,sale_id,stage,reason,created_at FROM sales_events
      WHERE sale_id=$1 AND ($2::bigint IS NULL OR id<$2) ORDER BY id DESC LIMIT $3`,
    [saleId, before ?? null, limit])).rows;
  }

  @Post('conversations/:id/sales')
  @HttpCode(200)
  async newOrder(@Param('id') id: string, @Body() body: unknown) {
    read(recordId, id);
    const { requestId } = read(z.object({ requestId: z.string().min(8).max(100) }), body);
    return transaction(async client => {
      const conversation = await row<Conversation>(client, 'SELECT * FROM conversations WHERE id=$1 FOR NO KEY UPDATE', [id]);
      if (!conversation) throw new NotFoundException();
      const repeated = await saleByRequest(client, id, requestId);
      if (repeated) return repeated;
      const latest = await currentSale(client, id);
      if (latest && !latest.closed_at) throw new ConflictException('This conversation already has an open sale');
      await client.query('UPDATE conversations SET memory=$2 WHERE id=$1', [id, withoutQuote(conversation.memory)]);
      return openSale(client, conversation, 'admin_opened', requestId);
    });
  }

  @Post('conversations/:id/sale')
  @HttpCode(200)
  async sale(@Param('id') id: string, @Body() body: unknown) {
    read(recordId, id);
    const { stage, reason, saleId } = read(z.object({
      stage: z.enum(['paid', 'completed']), reason: z.string().trim().min(3).max(250), saleId: recordId.optional(),
    }), body);
    return transaction(async client => {
      const conversation = await row<Conversation>(client, 'SELECT * FROM conversations WHERE id=$1 FOR NO KEY UPDATE', [id]);
      if (!conversation) throw new NotFoundException();
      const latest = await currentSale(client, id);
      if (saleId && latest?.id !== saleId) throw new ConflictException('The requested sale is no longer the latest sale');
      if (!saleId && latest && await row(client,
        'SELECT 1 FROM sales WHERE conversation_id=$1 AND id<$2 LIMIT 1', [id, latest.id])) {
        throw new ConflictException('Supply saleId to identify the sale');
      }
      if (stage === 'completed' && latest?.stage !== 'paid' && latest?.stage !== 'completed') {
        throw new BadRequestException('Confirm payment before completing the sale');
      }
      const sale = await advanceSale(client, conversation, latest, stage, reason);
      return { id, saleId: sale.id, stage: sale.stage };
    });
  }

  @Get('outbound')
  async outboundQueue(@Query() query: unknown) {
    const filters = read(z.object({
      state: z.enum(['queued', 'sending', 'sent', 'uncertain', 'canceled']).optional(),
      account: idSchema.optional(), before: recordId.optional(), limit: pageSize,
    }), query);
    return (await db.query(`SELECT id,account_id,conversation_id,jid,origin,body,image_url,state,reason,
      created_at,attempted_at,sent_at FROM outbound
      WHERE ($1::text IS NULL OR state=$1) AND ($2::text IS NULL OR account_id=$2) AND ($3::bigint IS NULL OR id<$3)
      ORDER BY id DESC LIMIT $4`,
    [filters.state ?? null, filters.account ?? null, filters.before ?? null, filters.limit])).rows;
  }

  @Post('outbound/:id/retry')
  @HttpCode(200)
  async retryOutbound(@Param('id') id: string) {
    read(recordId, id);
    return transaction(async client => {
      const item = await row<{ account_id: string; state: string; reason: string | null }>(client,
        'SELECT account_id,state,reason FROM outbound WHERE id=$1 FOR UPDATE', [id]);
      if (!item) throw new NotFoundException();
      if (item.state !== 'uncertain' && item.state !== 'canceled') {
        throw new ConflictException('Only uncertain or canceled messages can be retried');
      }
      if (item.reason === 'request_superseded') {
        throw new ConflictException('The customer sent a newer message after this check');
      }
      if (!await row(client, 'SELECT 1 FROM accounts WHERE id=$1 AND enabled', [item.account_id])) {
        throw new ConflictException('The sending account is disabled');
      }
      // The provider message ID is kept so WhatsApp can deduplicate if the first attempt did reach the phone.
      await client.query("UPDATE outbound SET state='queued',reason=NULL,attempted_at=NULL WHERE id=$1", [id]);
      return { id, state: 'queued' };
    });
  }

  @Get('knowledge')
  async knowledge(@Query('limit') raw: unknown) {
    const limit = read(pageSize, raw);
    return (await db.query('SELECT * FROM knowledge ORDER BY updated_at DESC,id LIMIT $1', [limit])).rows;
  }

  @Put('knowledge/:id')
  async publish(@Param('id') id: string, @Body() body: unknown) {
    read(idSchema, id);
    const input = read(z.object({ title: z.string().trim().min(1).max(160), content: z.string().trim().min(1).max(8000),
      tags: z.string().max(500).default(''), system: z.enum(['general', 'wotefy', 'lubfy']),
      sourceUrl: z.url({ protocol: /^https$/ }).optional(), published: z.boolean().default(false) }), body);
    return row(db, `INSERT INTO knowledge (id,system,title,content,tags,source_url,published) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (id) DO UPDATE SET system=EXCLUDED.system,title=EXCLUDED.title,content=EXCLUDED.content,
      tags=EXCLUDED.tags,source_url=EXCLUDED.source_url,published=EXCLUDED.published,updated_at=now() RETURNING *`,
    [id, input.system, input.title, input.content, input.tags, input.sourceUrl ?? null, input.published]);
  }

  @Get('device-specs')
  async deviceSpecs(@Query('limit') raw: unknown) {
    return listSpecs(read(pageSize, raw));
  }

  /** The shop adds a new model here instead of waiting for a deploy. */
  @Put('device-specs/:key')
  async saveDeviceSpec(@Param('key') key: string, @Body() body: unknown) {
    const input = read(z.object({
      model: z.string().trim().min(2).max(120),
      brand: z.string().trim().max(80).optional(),
      deployment: z.enum(['indoor', 'outdoor', 'both']).optional(),
      wifi: z.string().trim().max(120).optional(),
      bands: z.string().trim().max(120).optional(),
      ports: z.string().trim().max(120).optional(),
      poe: z.string().trim().max(120).optional(),
      coverageM: z.coerce.number().int().min(1).max(100000).optional(),
      users: z.coerce.number().int().min(1).max(100000).optional(),
      notes: z.string().trim().max(2000).optional(),
      sourceUrl: z.url({ protocol: /^https$/ }).optional(),
      verified: z.boolean().default(false),
      antenna: z.string().trim().max(160).optional(),
      radios: z.string().trim().max(160).optional(),
      gainDbi: z.coerce.number().min(0).max(60).optional(),
      ipRating: z.string().trim().max(40).optional(),
      mesh: z.boolean().optional(),
      controller: z.string().trim().max(160).optional(),
      poeWatts: z.coerce.number().min(0).max(2000).optional(),
      mounting: z.string().trim().max(160).optional(),
      highlights: z.array(z.string().trim().max(200)).max(8).optional(),
      aliases: z.array(z.string().trim().max(80)).max(10).optional(),
    }), body);
    return saveSpec({
      model_key: key, model: input.model, brand: input.brand ?? null,
      deployment: input.deployment ?? null, wifi: input.wifi ?? null, bands: input.bands ?? null,
      ports: input.ports ?? null, poe: input.poe ?? null, coverage_m: input.coverageM ?? null,
      users: input.users ?? null, notes: input.notes ?? null,
      source_url: input.sourceUrl ?? null, verified: input.verified,
      antenna: input.antenna ?? null, radios: input.radios ?? null, gain_dbi: input.gainDbi ?? null,
      ip_rating: input.ipRating ?? null, mesh: input.mesh ?? null, controller: input.controller ?? null,
      poe_watts: input.poeWatts ?? null, mounting: input.mounting ?? null,
      highlights: input.highlights ?? null, aliases: input.aliases ?? null,
    });
  }

  @Get('products')
  async products(@Query('limit') raw: unknown) {
    return (await db.query('SELECT * FROM products ORDER BY updated_at DESC,id LIMIT $1', [read(pageSize, raw)])).rows;
  }

  /**
   * A sandbox for the reply engine. The admin types as a customer and sees the
   * real answer, the memory it built and the steps it took — without touching a
   * customer's chat, without sending anything to WhatsApp.
   */
  @Post('playground')
  @HttpCode(200)
  async playground(@Body() body: unknown) {
    const input = read(z.object({
      messages: z.array(z.string().trim().min(1).max(1200)).min(1).max(12),
      // The same vision path the worker uses on WhatsApp, so the studio can show
      // what a photographed device is read as before it goes live.
      photo: z.object({
        base64: z.string().min(16).max(6_000_000),
        mimetype: z.enum(['image/jpeg', 'image/png', 'image/webp']),
      }).optional(),
    }), body);
    let memory: Conversation['memory'] = {};
    const turns: {
      customer: string; reply: string; trace: string[]; facts: ReturnType<typeof factList>;
      stage: string | null; ms: number; photo: boolean;
    }[] = [];
    const base = {
      id: 'playground', account_id: 'playground', customer_jid: 'playground@s.whatsapp.net',
      customer_phone: null, customer_name: null, mode: 'bot' as const, human_since: null,
      stage: 'inquiry' as Conversation['stage'], unread_count: 0, last_body: null, last_at: null,
    };
    const client = await db.connect();
    try {
      for (const [index, text] of input.messages.entries()) {
        const started = Date.now();
        // A photo belongs to the message it arrived with, so only the last turn
        // receives it; earlier turns were already answered from text.
        const photo = index === input.messages.length - 1 ? input.photo : undefined;
        const outcome = await respond(client, { ...base, memory } as Conversation, text,
          turns.slice(-6).flatMap(turn => [{ direction: 'inbound' as const, body: turn.customer },
            { direction: 'outbound' as const, body: turn.reply }]), false, photo);
        turns.push({
          customer: text, reply: outcome.body, trace: outcome.trace ?? [],
          facts: factList(outcome.memory.facts), stage: outcome.stage ?? null,
          ms: Date.now() - started, photo: Boolean(photo),
        });
        memory = outcome.memory;
        if (outcome.stage) base.stage = outcome.stage;
      }
    } finally {
      client.release();
    }
    return { turns, vision: Boolean(config.DEEPSEEK_API_KEY), model: config.DEEPSEEK_API_KEY ? config.DEEPSEEK_MODEL : null };
  }

  /** Live CSolution catalog: prices, stock, brand, description and photos. */
  @Get('catalog')
  async catalogProducts(@Query('search') rawSearch: unknown, @Query('limit') rawLimit: unknown) {
    const search = typeof rawSearch === 'string' ? rawSearch.trim().slice(0, 120) : '';
    const limit = read(z.coerce.number().int().min(1).max(100), rawLimit ?? 60);
    const live = await catalog(search, limit)
      .catch(error => {
        console.warn('Live catalog unavailable', error);
        return { items: [], source: 'unavailable' as const };
      });
    if (live.source !== 'none' && live.source !== 'unavailable') {
      return {
        source: live.source,
        search,
        items: live.items.map(item => ({
          id: item.id, name: item.name, sku: item.sku ?? null,
          brand: item.brand ?? null, category: item.category ?? null,
          type: item.type ?? null, unit: item.unit ?? null,
          description: item.description ?? '', warranty: item.warranty ?? 0,
          price: item.price, available: item.available ?? (item.available_to_sell ?? 0) > 0,
          available_to_sell: item.available_to_sell ?? 0,
          image: item.images.length ? `/v1/catalog/${encodeURIComponent(item.id)}/image` : null,
        })),
      };
    }
    // POS not connected yet: show the small local list so the page is never empty.
    const rows = await db.query(`SELECT id,name,sku,description,image_url,updated_at FROM products
      WHERE $2='' OR strpos(lower(concat_ws(' ',name,sku,description)),lower($2))>0
      ORDER BY updated_at DESC,id LIMIT $1`, [limit, search]);
    return {
      source: 'local', search,
      items: rows.rows.map(item => ({
        id: item.id, name: item.name, sku: item.sku, brand: null, category: null,
        type: 'Stocked', unit: null, description: item.description ?? '', warranty: 0,
        price: null, available: null, available_to_sell: null,
        image: item.image_url ? `/v1/catalog/${encodeURIComponent(item.id)}/image` : null,
        updated_at: item.updated_at,
      })),
    };
  }

  /** One product with every photo, used by the dashboard detail dialog. */
  @Get('catalog/:id')
  async catalogProduct(@Param('id') id: string) {
    read(idSchema, id);
    const { product, stock } = await readProduct(id);
    return {
      id: product.id, name: product.name, sku: product.sku ?? null,
      brand: product.brand ?? null, category: product.category ?? null,
      type: product.type ?? null, unit: product.unit ?? null,
      description: product.description ?? '', warranty: product.warranty ?? 0,
      price: product.price, available: stock.available ?? stock.available_to_sell > 0,
      available_to_sell: stock.available_to_sell,
      images: product.images.map(image => `/v1/catalog/${encodeURIComponent(id)}/image`),
    };
  }

  /** Same-origin photo proxy so the dashboard CSP and WhatsApp share one source. */
  @Get('catalog/:id/image')
  async catalogImage(@Param('id') id: string, @Res() response: {
    setHeader(name: string, value: string): void; end(data: Buffer): void;
  }) {
    read(idSchema, id);
    let ref: string | undefined;
    try {
      ref = await productImageRef(id);
    } catch {
      ref = undefined;
    }
    if (!ref) {
      ref = (await row<{ image_url: string | null }>(db,
        'SELECT image_url FROM products WHERE id=$1', [id]))?.image_url ?? undefined;
    }
    const image = ref ? await downloadImage(ref).catch(() => undefined) : undefined;
    if (!image) throw new NotFoundException('Product photo not found');
    response.setHeader('Content-Type', image.mimetype);
    response.setHeader('Content-Length', String(image.image.length));
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.end(image.image);
  }

  @Put('products/:id')
  async product(@Param('id') id: string, @Body() body: unknown) {
    read(idSchema, id);
    const product = read(z.object({ name: z.string().trim().min(1).max(160), sku: z.string().trim().min(1).max(80),
      description: z.string().max(800).optional(), imageUrl: z.url({ protocol: /^https$/ }).optional() }), body);
    return row(db, `INSERT INTO products (id,name,sku,description,image_url) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,sku=EXCLUDED.sku,description=EXCLUDED.description,
      image_url=EXCLUDED.image_url,updated_at=now() RETURNING *`,
    [id, product.name, product.sku, product.description ?? null, product.imageUrl ?? null]);
  }

  @Post('accounts/:id/simulate')
  @HttpCode(202)
  async simulate(@Param('id') id: string, @Body() body: unknown) {
    read(idSchema, id);
    if (!config.ALLOW_MOCK) throw new ForbiddenException('Mock mode is disabled');
    const account = await row(db, "SELECT 1 FROM accounts WHERE id=$1 AND mode='mock' AND enabled", [id]);
    if (!account) throw new NotFoundException('Enabled mock account not found');
    const input = read(z.object({ phone, name: z.string().max(100).optional(),
      messageId: z.string().min(1).max(100), text: z.string().trim().max(3500).default(''),
      imageBase64: z.string().max(12_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/).optional(),
      audioBase64: z.string().max(24_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/).optional(),
      audioMime: z.string().max(80).optional(),
      missedCall: z.enum(['voice', 'video']).optional(),
      quotedMessageId: z.string().min(1).max(100).optional(),
    }).refine(value => value.missedCall ? !value.text && !value.imageBase64 && !value.audioBase64
      : Boolean(value.text || value.imageBase64 || value.audioBase64), 'Provide text, media, or a missed call'), body);
    const bytes = input.imageBase64 ? Buffer.from(input.imageBase64, 'base64') : undefined;
    const mimetype = bytes ? imageMimetype(bytes) : undefined;
    if (bytes && (!mimetype || bytes.length > maxImageBytes)) {
      throw new BadRequestException('Simulated images must be PNG, JPEG or WebP and at most 8 MB');
    }
    // The studio sends a voice note through the same path WhatsApp uses, so the
    // transcription and the fallback can be tested without a phone.
    const voice = input.audioBase64 ? Buffer.from(input.audioBase64, 'base64') : undefined;
    const voiceMime = audioType(input.audioMime ?? 'audio/ogg');
    if (voice && !audioAllowed(voiceMime, voice.length)) {
      throw new BadRequestException('Simulated voice notes must be OGG/Opus, MP3, MP4 or WAV and at most 16 MB');
    }
    const conversationId = await ingest({ accountId: id, providerId: input.messageId, jid: input.phone + '@s.whatsapp.net',
      name: input.name, quotedProviderId: input.quotedMessageId,
      body: input.missedCall ? `[Missed WhatsApp ${input.missedCall} call]` :
        input.text || (voice ? '[WhatsApp audio]' : bytes ? '[WhatsApp image]' : ''),
      kind: input.missedCall ? 'missed_call' : voice ? 'audio' : bytes ? 'image' : 'text',
      occurredAt: new Date(), image: bytes && mimetype ? { bytes, mimetype } : undefined,
      audio: voice ? { bytes: voice, mimetype: voiceMime } : undefined });
    return { conversationId: conversationId ?? null };
  }
}

function imageMimetype(bytes: Buffer) {
  if (bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png';
  if (bytes.subarray(0, 3).toString('hex') === 'ffd8ff') return 'image/jpeg';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
}

@Controller('integrations/support-diagnostics')
class SupportDiagnosticController {
  @Post()
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async receive(@Body() input: unknown, @Headers('x-csbot-signature') signature?: string) {
    const report = read(diagnosticReport, input);
    if (!authorizedDiagnostic(report, signature)) throw new UnauthorizedException();
    if (!await transaction(client => recordDiagnostic(client, report))) throw new NotFoundException();
  }
}

@Module({ controllers: [HealthController, AdminController, DashboardController, SupportDiagnosticController], providers: [AdminGuard] })
class ApiModule {}

const app = await NestFactory.create<NestExpressApplication>(ApiModule, { logger: ['error', 'warn', 'log'] });
// The studio sends a device photo to the same vision path WhatsApp uses; the
// default 1 MB JSON cap rejects a normal phone camera image.
app.useBodyParser('json', { limit: '7mb' });
// Caddy terminates TLS on the host and proxies to this port, so one trusted hop
// makes req.secure and the dashboard origin check see https instead of http.
app.set('trust proxy', 1);
app.useStaticAssets(dashboardDir + 'assets', { prefix: '/assets/', index: false });
const shutdown = async () => { await app.close(); await db.end(); };
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void shutdown(); });
await app.listen(config.PORT, '0.0.0.0');
console.info('CSbot API listening at', await app.getUrl());
