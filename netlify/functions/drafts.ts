import type { Config } from '@netlify/functions';
import { z } from 'zod';
import { portfolioContentSchema } from '../../src/content/portfolio.schema';
import { writeAuditEvent } from './_lib/audit';
import { assertOrigin, requireSession } from './_lib/security';
import { errorResponse, json, readJsonBody } from './_lib/http';
import { getDraftInfo, writePortfolioContent } from './_lib/github';

export const config: Config = {
  path: '/api/drafts',
};

const saveDraftSchema = z.object({
  baseSha: z.string().min(1),
  content: portfolioContentSchema,
});

export default async function handler(request: Request) {
  try {
    if (request.method === 'GET') {
      await requireSession(request);
      return json(await getDraftInfo());
    }

    if (request.method === 'POST') {
      assertOrigin(request);
      const session = await requireSession(request, { csrf: true });
      const body = saveDraftSchema.parse(await readJsonBody(request, 2_000_000));
      const result = await writePortfolioContent(body.content, body.baseSha);
      await writeAuditEvent({
        actor: session.actor,
        action: 'save_draft',
        target: 'portfolio.json',
        commitSha: result.commitSha,
        metadata: { branch: result.branch, pr: result.pr?.number },
      });
      return json(result);
    }

    return json({ error: 'method_not_allowed' }, 405);
  } catch (error) {
    return errorResponse(error);
  }
}
