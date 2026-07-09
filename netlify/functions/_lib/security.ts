import { getStore } from '@netlify/blobs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiError, getOptionalEnv, getRequiredEnv } from './http';

export interface AdminActor {
  id: number;
  login: string;
  avatarUrl?: string;
}

export interface AdminSession {
  idHash: string;
  actor: AdminActor;
  csrfToken: string;
  version: number;
  createdAt: string;
  expiresAt: string;
}

const SESSION_COOKIE = '__Host-admin_session';
const STATE_COOKIE = '__Host-admin_oauth_state';
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
const STATE_MAX_AGE_SECONDS = 10 * 60;

function secureCookie(name: string, value: string, maxAge: number, sameSite: 'Strict' | 'Lax') {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=${maxAge}`;
}

function clearCookie(name: string) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function parseCookies(header: string | null) {
  const cookies = new Map<string, string>();
  if (!header) return cookies;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    cookies.set(key, decodeURIComponent(value));
  }
  return cookies;
}

function hashWithSecret(value: string) {
  return createHash('sha256')
    .update(getRequiredEnv('ADMIN_SESSION_SECRET'))
    .update(':')
    .update(value)
    .digest('hex');
}

function safeEqual(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

export function appOrigin(request: Request) {
  return getOptionalEnv('ADMIN_PUBLIC_ORIGIN', new URL(request.url).origin);
}

export function assertOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== appOrigin(request)) {
    throw new ApiError(403, 'invalid_origin', 'Request origin is not allowed.');
  }
}

export function createOAuthStateHeaders() {
  const state = randomBytes(32).toString('base64url');
  const headers = new Headers();
  headers.append('set-cookie', secureCookie(STATE_COOKIE, state, STATE_MAX_AGE_SECONDS, 'Lax'));
  return { state, headers };
}

export function verifyOAuthState(request: Request, returnedState: string | null) {
  const storedState = parseCookies(request.headers.get('cookie')).get(STATE_COOKIE);
  if (!storedState || !returnedState || !safeEqual(storedState, returnedState)) {
    throw new ApiError(403, 'invalid_oauth_state', 'OAuth state did not match.');
  }
}

export function clearOAuthState(headers = new Headers()) {
  headers.append('set-cookie', clearCookie(STATE_COOKIE));
  return headers;
}

async function getSessionVersion() {
  const store = getStore('admin-security');
  const value = await store.get('session-version', { type: 'json' }).catch(() => null) as { version?: number } | null;
  return Number(value?.version ?? 1);
}

export async function bumpSessionVersion() {
  const store = getStore('admin-security');
  const next = (await getSessionVersion()) + 1;
  await store.setJSON('session-version', { version: next, updatedAt: new Date().toISOString() });
  return next;
}

export async function createSession(actor: AdminActor) {
  const sessionId = randomBytes(32).toString('base64url');
  const idHash = hashWithSecret(sessionId);
  const now = new Date();
  const session: AdminSession = {
    idHash,
    actor,
    csrfToken: randomBytes(32).toString('base64url'),
    version: await getSessionVersion(),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000).toISOString(),
  };

  await getStore('admin-sessions').setJSON(`session:${idHash}`, session);
  const headers = new Headers();
  headers.append('set-cookie', secureCookie(SESSION_COOKIE, sessionId, SESSION_MAX_AGE_SECONDS, 'Strict'));
  return { session, headers };
}

export async function readSession(request: Request) {
  const sessionId = parseCookies(request.headers.get('cookie')).get(SESSION_COOKIE);
  if (!sessionId) return null;

  const idHash = hashWithSecret(sessionId);
  const session = await getStore('admin-sessions')
    .get(`session:${idHash}`, { type: 'json' })
    .catch(() => null) as AdminSession | null;
  if (!session) return null;

  const expiresAt = new Date(session.expiresAt).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;
  if (session.version !== await getSessionVersion()) return null;
  return session;
}

export async function requireSession(request: Request, options: { csrf?: boolean } = {}) {
  const session = await readSession(request);
  if (!session) {
    throw new ApiError(401, 'unauthorized', 'Admin session is required.');
  }

  if (options.csrf) {
    const token = request.headers.get('x-csrf-token') ?? '';
    if (!token || !safeEqual(token, session.csrfToken)) {
      throw new ApiError(403, 'invalid_csrf', 'CSRF token is missing or invalid.');
    }
  }

  return session;
}

export async function destroySession(request: Request) {
  const sessionId = parseCookies(request.headers.get('cookie')).get(SESSION_COOKIE);
  if (sessionId) {
    await getStore('admin-sessions').delete(`session:${hashWithSecret(sessionId)}`).catch(() => undefined);
  }
  const headers = new Headers();
  headers.append('set-cookie', clearCookie(SESSION_COOKIE));
  return headers;
}
