#!/usr/bin/env node
import { apiUrl } from './api-url.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const services = ['postgres', 'redis', 'migrate', 'api', 'worker', 'whatsapp-gateway'];
const longRunning = services.filter(name => name !== 'migrate');
const [command = 'help', ...args] = process.argv.slice(2);

function docker(composeArgs, capture = false) {
  const result = spawnSync('docker', ['compose', ...composeArgs], {
    cwd: root, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8',
  });
  if (result.error) throw new Error('Docker CLI is not available: ' + result.error.message);
  if (!capture && result.status !== 0) process.exit(result.status ?? 1);
  return result;
}

function servicesArg(values) {
  if (!values.length) throw new Error('Name at least one service: ' + services.join(', '));
  for (const value of values) {
    if (!services.includes(value)) throw new Error(`Unknown service "${value}". Choose: ${services.join(', ')}`);
  }
  return values;
}

function stackState() {
  const { stdout } = docker(['ps', '--all', '--format', 'json'], true);
  const text = stdout.trim();
  if (!text) return [];
  if (text.startsWith('[')) return JSON.parse(text);
  return text.split('\n').filter(Boolean).map(line => JSON.parse(line));
}

function envFile() {
  const path = resolve(root, '.env');
  if (!existsSync(path)) throw new Error('.env is missing; copy .env.example and fill it in');
  process.loadEnvFile(path);
  return process.env;
}

const commands = {
  up() {
    docker(['build', 'migrate']);
    docker(['up', '-d', '--wait']);
    commands.status();
  },
  down() {
    docker(['down', ...(args.includes('--volumes') ? ['--volumes'] : [])]);
  },
  build() {
    docker(['build', ...args]);
  },
  ps() {
    docker(['ps', '--all']);
  },
  status() {
    const rows = stackState();
    if (!rows.length) {
      console.log('Stack haijaundwa. Endesha: npm run stack -- up');
      process.exitCode = 1;
      return;
    }
    console.log('SERVICE'.padEnd(20) + 'STATE'.padEnd(12) + 'HEALTH');
    let failed = false;
    for (const service of services) {
      const item = rows.find(row => row.Service === service);
      const state = item?.State ?? 'missing';
      const health = item?.Health || (service === 'migrate' ? 'completed' : '-');
      console.log(service.padEnd(20) + String(state).padEnd(12) + String(health));
      if (longRunning.includes(service) && (state !== 'running' || health === 'unhealthy')) failed = true;
      if (service === 'migrate' && item && state !== 'exited') failed = true;
    }
    if (rows.some(item => item.Service === 'api' && item.State === 'running')) {
      console.log('Dashboard ' + apiUrl() + '/admin');
    }
    process.exitCode = failed ? 1 : 0;
  },
  url() {
    console.log(apiUrl());
  },
  health() {
    commands.status();
  },
  start() {
    docker(['start', ...servicesArg(args)]);
  },
  stop() {
    docker(['stop', ...servicesArg(args)]);
  },
  restart() {
    docker(['restart', ...servicesArg(args)]);
  },
  logs() {
    const target = args.filter(value => services.includes(value));
    docker(['logs', '-f', '--tail=120', ...target]);
  },
  scale() {
    const [service, count] = args;
    if (service !== 'worker') throw new Error('Only the worker service is safe to scale; the gateway holds a single WhatsApp session lock');
    if (!/^[1-9]\d?$/.test(count ?? '')) throw new Error('Usage: npm run stack -- scale worker 2');
    docker(['up', '-d', '--no-recreate', '--scale', `${service}=${count}`, service]);
  },
  exec() {
    const [service, ...rest] = args;
    if (!services.includes(service) || !rest.length) throw new Error('Usage: npm run stack -- exec <service> <command...>');
    docker(['exec', service, ...rest]);
  },
  doctor() {
    const env = envFile();
    const problems = [];
    if (!env.POSTGRES_PASSWORD || env.POSTGRES_PASSWORD.length < 24) problems.push('POSTGRES_PASSWORD must have at least 24 characters');
    if (!env.ADMIN_API_TOKEN || env.ADMIN_API_TOKEN.length < 32) problems.push('ADMIN_API_TOKEN must have at least 32 characters');
    try {
      if (Buffer.from(env.SESSION_KEY ?? '', 'base64').length !== 32) problems.push('SESSION_KEY must be 32 random bytes in base64');
    } catch {
      problems.push('SESSION_KEY is not valid base64');
    }
    const daemon = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8' });
    if (daemon.status !== 0) problems.push('Docker daemon is not reachable');
    else console.log('Docker ' + daemon.stdout.trim());
    if (!env.DEEPSEEK_API_KEY) console.log('Note: DEEPSEEK_API_KEY is empty, so CSbot will use its local rules only.');
    if (!env.POS_BASE_URL && !env.CSOLUTION_POS_DB_URL) console.log('Note: no POS source configured; prices and stock come from the local catalog.');
    if (problems.length) {
      for (const problem of problems) console.error('- ' + problem);
      process.exitCode = 1;
      return;
    }
    console.log('Environment looks ready.');
    commands.status();
  },
  async link() {
    const [id, phone, ...flags] = args;
    if (!id || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(id)) {
      throw new Error('Usage: npm run stack -- link <account-id> <phone> [--code]');
    }
    if (!phone || !/^\+?\d{7,15}$/.test(phone)) {
      throw new Error('Give the WhatsApp number in international form, e.g. +255712345678');
    }
    const env = envFile();
    if (!env.ADMIN_API_TOKEN) throw new Error('ADMIN_API_TOKEN is missing from .env');
    const base = apiUrl();
    const headers = { authorization: `Bearer ${env.ADMIN_API_TOKEN}`, 'content-type': 'application/json' };
    const created = await fetch(`${base}/v1/accounts`, {
      method: 'POST', headers,
      body: JSON.stringify({ id, label: `CSolution ${id}`, phone: phone.replace(/^\+/, ''), mode: 'baileys' }),
    });
    if (!created.ok && created.status !== 400) {
      throw new Error(`Could not register ${id}: HTTP ${created.status} ${await created.text()}`);
    }
    if (created.ok) console.log(`Akaunti ${id} imesajiliwa.`);
    else console.log(`Akaunti ${id} ipo tayari; nitaanza pairing.`);
    const result = spawnSync(process.execPath, ['scripts/pair.mjs', id, ...(flags.includes('--code') ? ['--code'] : [])],
      { cwd: root, stdio: 'inherit' });
    process.exit(result.status ?? 1);
  },
  pair() {
    const id = args[0];
    if (!id) throw new Error('Usage: npm run stack -- pair <account-id> [--code]');
    const result = spawnSync(process.execPath, ['scripts/pair.mjs', ...args], { cwd: root, stdio: 'inherit' });
    process.exit(result.status ?? 1);
  },
  help() {
    console.log(`CSbot stack control

  npm run stack -- up                 build, start and wait for every service
  npm run stack -- url                print the running API address
  npm run stack -- status             table of services, states and health checks
  npm run stack -- health             alias of status
  npm run stack -- logs [service...]  follow logs (all services when empty)
  npm run stack -- restart <service>  restart one service, e.g. whatsapp-gateway
  npm run stack -- stop <service...>  stop services without deleting data
  npm run stack -- start <service...> start stopped services
  npm run stack -- scale worker 2     run more reply workers
  npm run stack -- exec api sh        shell inside a service
  npm run stack -- doctor             validate .env and Docker before starting
  npm run stack -- link sales +255712345678 [--code]
                                      register and link a WhatsApp number
  npm run stack -- pair sales         show the QR (or the pairing code with --code)
  npm run stack -- down [--volumes]   stop everything (volumes optional)`);
  },
};

try {
  if (!commands[command]) throw new Error(`Unknown command "${command}"`);
  await commands[command]();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
