import type { Config } from '@netlify/functions';
import { listAuditEvents } from './_lib/audit';
import { errorResponse, json } from './_lib/http';
import { requireSession } from './_lib/security';

export const config: Config = {
  path: '/api/audit-log',
};

export default async function handler(request: Request) {
  try {
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    await requireSession(request);
    return json({ events: await listAuditEvents(75) });
  } catch (error) {
    return errorResponse(error);
  }
}
