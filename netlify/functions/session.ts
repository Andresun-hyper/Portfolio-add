import type { Config } from '@netlify/functions';
import { z } from 'zod';
import { writeAuditEvent } from './_lib/audit';
import { ApiError, errorResponse, getRequiredEnv, json, redirect, readJsonBody } from './_lib/http';
import {
  appOrigin,
  assertOrigin,
  bumpSessionVersion,
  clearOAuthState,
  createOAuthStateHeaders,
  createSession,
  destroySession,
  readSession,
  requireSession,
  verifyOAuthState,
} from './_lib/security';

export const config: Config = {
  path: ['/api/session', '/api/session/callback'],
  rateLimit: {
    action: 'rate_limit',
    aggregateBy: ['ip', 'domain'],
    windowLimit: 30,
    windowSize: 60,
  },
};

const sessionActionSchema = z.object({
  action: z.literal('invalidate_all'),
});

async function exchangeGitHubCode(code: string, redirectUri: string) {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      client_id: getRequiredEnv('ADMIN_GITHUB_CLIENT_ID'),
      client_secret: getRequiredEnv('ADMIN_GITHUB_CLIENT_SECRET'),
      code,
      redirect_uri: redirectUri,
    }),
  });
  const payload = await response.json() as { access_token?: string; error?: string; error_description?: string };
  if (!response.ok || !payload.access_token) {
    throw new ApiError(401, 'oauth_exchange_failed', payload.error_description || payload.error || 'GitHub OAuth failed.');
  }
  return payload.access_token;
}

async function fetchGitHubUser(accessToken: string) {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${accessToken}`,
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new ApiError(401, 'github_user_failed', 'Unable to read GitHub user.');
  }
  return await response.json() as { id: number; login: string; avatar_url?: string };
}

async function beginLogin(request: Request) {
  const { state, headers } = createOAuthStateHeaders();
  const redirectUri = new URL('/api/session/callback', appOrigin(request)).toString();
  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', getRequiredEnv('ADMIN_GITHUB_CLIENT_ID'));
  authorize.searchParams.set('redirect_uri', redirectUri);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('scope', 'read:user');
  return redirect(authorize.toString(), { headers });
}

async function finishLogin(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  if (!code) throw new ApiError(400, 'missing_oauth_code', 'Missing GitHub OAuth code.');

  verifyOAuthState(request, returnedState);
  const headers = clearOAuthState();
  const redirectUri = new URL('/api/session/callback', appOrigin(request)).toString();
  const accessToken = await exchangeGitHubCode(code, redirectUri);
  const user = await fetchGitHubUser(accessToken);

  if (String(user.id) !== getRequiredEnv('ADMIN_ALLOWED_GITHUB_USER_ID')) {
    return redirect('/?login=denied', { headers });
  }

  const { session, headers: sessionHeaders } = await createSession({
    id: user.id,
    login: user.login,
    avatarUrl: user.avatar_url,
  });
  sessionHeaders.forEach((value, key) => headers.append(key, value));
  await writeAuditEvent({ actor: session.actor, action: 'login', target: 'admin-session' });
  return redirect('/?login=ok', { headers });
}

export default async function handler(request: Request) {
  try {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname.endsWith('/callback')) {
      return await finishLogin(request);
    }

    if (request.method === 'GET' && url.searchParams.get('login') === 'github') {
      return await beginLogin(request);
    }

    if (request.method === 'GET') {
      const session = await readSession(request);
      return json({
        authenticated: Boolean(session),
        user: session?.actor ?? null,
        csrfToken: session?.csrfToken ?? null,
      });
    }

    if (request.method === 'DELETE') {
      assertOrigin(request);
      const headers = await destroySession(request);
      return json({ ok: true }, 200, { headers });
    }

    if (request.method === 'POST') {
      assertOrigin(request);
      const session = await requireSession(request, { csrf: true });
      const body = sessionActionSchema.parse(await readJsonBody(request));
      if (body.action === 'invalidate_all') {
        const version = await bumpSessionVersion();
        const headers = await destroySession(request);
        await writeAuditEvent({
          actor: session.actor,
          action: 'invalidate_sessions',
          target: 'admin-session',
          metadata: { version },
        });
        return json({ ok: true, version }, 200, { headers });
      }
    }

    return json({ error: 'method_not_allowed' }, 405);
  } catch (error) {
    return errorResponse(error);
  }
}
