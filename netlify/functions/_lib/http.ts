export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, status, headers });
}

export function redirect(location: string, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set('location', location);
  headers.set('cache-control', 'no-store');
  return new Response(null, { ...init, status: 302, headers });
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return json({ error: error.code, message: error.message }, error.status);
  }

  console.error(error);
  return json({ error: 'internal_error', message: 'Unexpected server error.' }, 500);
}

export async function readJsonBody<T>(request: Request, maxBytes = 1_000_000): Promise<T> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new ApiError(413, 'body_too_large', 'Request body is too large.');
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(400, 'invalid_json', 'Request body must be valid JSON.');
  }
}

export function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new ApiError(500, 'missing_env', `Missing required environment variable: ${name}`);
  }
  return value;
}

export function getOptionalEnv(name: string, fallback = '') {
  return process.env[name] || fallback;
}
