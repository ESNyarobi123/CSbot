import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  Body, Controller, ForbiddenException, Get, Header, HttpCode, Post, Req, Res, UnauthorizedException,
} from '@nestjs/common';
import { config } from './config.js';

export const dashboardDir = fileURLToPath(new URL('../web/', import.meta.url));
const adminToken = config.ADMIN_API_TOKEN;
if (!adminToken || adminToken.length < 32) throw new Error('ADMIN_API_TOKEN must have at least 32 characters');
const secret = Buffer.from(adminToken);
const cookieName = 'csbot_admin';
const sessionSeconds = 8 * 60 * 60;

export interface DashboardRequest {
  method: string;
  headers: Record<string, string | undefined>;
  secure: boolean;
}

interface DashboardResponse {
  setHeader(name: string, value: string): void;
  sendFile(path: string): void;
}

function tokenMatches(token: unknown) {
  if (typeof token !== 'string' || token.length > 1024) return false;
  const supplied = Buffer.from(token);
  return supplied.length === secret.length && timingSafeEqual(supplied, secret);
}

function signature(payload: string) {
  return createHmac('sha256', secret).update('csbot-dashboard-v1:').update(payload).digest();
}

export function dashboardAuthorized(request: DashboardRequest) {
  const cookie = request.headers.cookie?.split(';').map(item => item.trim())
    .find(item => item.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  if (!cookie) return false;
  const parts = /^(\d{10,12})\.([0-9a-f]{32})\.([0-9a-f]{64})$/.exec(cookie);
  if (!parts || Number(parts[1]) <= Math.floor(Date.now() / 1000)) return false;
  return timingSafeEqual(signature(parts[1] + '.' + parts[2]), Buffer.from(parts[3], 'hex'));
}

export function checkDashboardOrigin(request: DashboardRequest) {
  if (request.headers['x-csbot-dashboard'] !== '1' ||
      request.headers['sec-fetch-site'] === 'cross-site' ||
      (request.headers.origin && request.headers.origin !== (request.secure ? 'https://' : 'http://') + request.headers.host)) {
    throw new ForbiddenException('Open the CSbot dashboard to make this change');
  }
}

export function adminAuthorized(request: DashboardRequest) {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ') && tokenMatches(authorization.slice(7))) return true;
  if (!dashboardAuthorized(request)) return false;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) checkDashboardOrigin(request);
  return true;
}

function setSession(response: DashboardResponse, secure: boolean, session: string, age: number) {
  response.setHeader('Set-Cookie',
    `${cookieName}=${session}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`);
}

@Controller()
export class DashboardController {
  @Get(['', 'admin'])
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; media-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
  ui(@Res() response: DashboardResponse) {
    response.sendFile(dashboardDir + 'index.html');
  }

  @Get('dashboard/session')
  @Header('Cache-Control', 'no-store')
  session(@Req() request: DashboardRequest) {
    return { authenticated: dashboardAuthorized(request) };
  }

  @Post('dashboard/session')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  login(@Req() request: DashboardRequest, @Res({ passthrough: true }) response: DashboardResponse, @Body() body: unknown) {
    checkDashboardOrigin(request);
    const supplied = (body as { token?: unknown } | null)?.token;
    if (!tokenMatches(supplied)) throw new UnauthorizedException('The admin access token is incorrect');
    const payload = `${Math.floor(Date.now() / 1000) + sessionSeconds}.${randomBytes(16).toString('hex')}`;
    setSession(response, request.secure, payload + '.' + signature(payload).toString('hex'), sessionSeconds);
    return { authenticated: true };
  }

  @Post('dashboard/session/logout')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  logout(@Req() request: DashboardRequest, @Res({ passthrough: true }) response: DashboardResponse) {
    checkDashboardOrigin(request);
    setSession(response, request.secure, '', 0);
    return { authenticated: false };
  }
}
