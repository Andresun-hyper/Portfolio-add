import type { Config } from '@netlify/functions';
import { writeAuditEvent } from './_lib/audit';
import { mergeDraftPullRequest } from './_lib/github';
import { assertOrigin, requireSession } from './_lib/security';
import { errorResponse, json } from './_lib/http';

export const config: Config = {
  path: '/api/publish',
  rateLimit: {
    action: 'rate_limit',
    aggregateBy: ['ip', 'domain'],
    windowLimit: 6,
    windowSize: 180,
  },
};

export default async function handler(request: Request) {
  try {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    assertOrigin(request);
    const session = await requireSession(request, { csrf: true });
    const result = await mergeDraftPullRequest();
    await writeAuditEvent({
      actor: session.actor,
      action: 'publish',
      target: `pull/${result.pr.number}`,
      commitSha: result.sha,
      metadata: { merged: result.merged, message: result.message },
    });
    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
