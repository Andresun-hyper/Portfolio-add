import type { Config } from '@netlify/functions';
import { errorResponse, json } from './_lib/http';
import { fallbackPortfolioContent, getDraftInfo } from './_lib/github';
import { requireSession } from './_lib/security';

export const config: Config = {
  path: '/api/content',
};

export default async function handler(request: Request) {
  try {
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    await requireSession(request);

    try {
      return json(await getDraftInfo());
    } catch (error) {
      if (error instanceof Error && error.message.includes('GITHUB_FINE_GRAINED_PAT')) {
        return json({
          branch: 'local-fallback',
          baseBranch: 'main',
          contentSha: 'local',
          content: fallbackPortfolioContent(),
          pr: undefined,
          warning: 'GitHub environment variables are not configured.',
        });
      }
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
