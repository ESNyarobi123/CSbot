import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export function apiUrl() {
  if (existsSync(root + '.env')) process.loadEnvFile(root + '.env');
  if (process.env.CSBOT_API_URL) return process.env.CSBOT_API_URL.replace(/\/$/, '');
  const published = spawnSync('docker', ['compose', 'port', 'api', '8080'], {
    cwd: root, encoding: 'utf8', timeout: 5000,
  });
  const port = published.status === 0 && /:(\d+)$/.exec(published.stdout.trim())?.[1];
  if (port) return 'http://127.0.0.1:' + port;
  const configured = process.env.CSBOT_HTTP_PORT || '8080';
  if (configured === '0') throw new Error('No published API port found. Start the stack or set CSBOT_API_URL.');
  return 'http://127.0.0.1:' + configured;
}
