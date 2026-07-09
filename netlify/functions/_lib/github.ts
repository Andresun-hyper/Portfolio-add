import { Buffer } from 'node:buffer';
import { portfolioContentSchema, type PortfolioContent } from '../../../src/content/portfolio.schema';
import fallbackContent from '../../../src/content/portfolio.json';
import { ApiError, getOptionalEnv, getRequiredEnv } from './http';

const CONTENT_PATH = 'app/src/content/portfolio.json';
const DRAFT_BRANCH = 'portfolio-admin-draft';

interface GitHubContentResponse {
  sha: string;
  content: string;
  encoding: string;
}

export interface DraftInfo {
  branch: string;
  baseBranch: string;
  contentSha: string;
  content: PortfolioContent;
  pr?: {
    number: number;
    htmlUrl: string;
    state: string;
    headSha: string;
    previewUrl?: string;
  };
}

function repo() {
  return {
    owner: getRequiredEnv('GITHUB_REPO_OWNER'),
    name: getRequiredEnv('GITHUB_REPO_NAME'),
    baseBranch: getOptionalEnv('GITHUB_BASE_BRANCH', 'main'),
  };
}

async function github<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${getRequiredEnv('GITHUB_FINE_GRAINED_PAT')}`,
      'x-github-api-version': '2022-11-28',
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ApiError(response.status, 'github_error', `GitHub API failed: ${body || response.statusText}`);
  }

  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

export async function getBaseRefSha(branch = repo().baseBranch) {
  const { owner, name } = repo();
  const ref = await github<{ object: { sha: string } }>(`/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(branch)}`);
  return ref.object.sha;
}

async function branchExists(branch: string) {
  const { owner, name } = repo();
  const response = await fetch(`https://api.github.com/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(branch)}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${getRequiredEnv('GITHUB_FINE_GRAINED_PAT')}`,
      'x-github-api-version': '2022-11-28',
    },
  });
  if (response.status === 404) return false;
  if (!response.ok) throw new ApiError(response.status, 'github_error', await response.text());
  return true;
}

export async function ensureDraftBranch() {
  const { owner, name, baseBranch } = repo();
  if (await branchExists(DRAFT_BRANCH)) return DRAFT_BRANCH;

  const baseSha = await getBaseRefSha(baseBranch);
  await github(`/repos/${owner}/${name}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({
      ref: `refs/heads/${DRAFT_BRANCH}`,
      sha: baseSha,
    }),
  });
  return DRAFT_BRANCH;
}

export async function getFileContent(branch: string) {
  const { owner, name } = repo();
  const file = await github<GitHubContentResponse>(
    `/repos/${owner}/${name}/contents/${CONTENT_PATH}?ref=${encodeURIComponent(branch)}`,
  );
  if (file.encoding !== 'base64') {
    throw new ApiError(502, 'unsupported_encoding', 'GitHub returned unsupported file encoding.');
  }
  const parsed = portfolioContentSchema.parse(JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')));
  return { sha: file.sha, content: parsed };
}

export function fallbackPortfolioContent() {
  return portfolioContentSchema.parse(fallbackContent);
}

async function findDraftPullRequest() {
  const { owner, name } = repo();
  const pulls = await github<Array<{
    number: number;
    html_url: string;
    state: string;
    head: { sha: string; ref: string };
  }>>(`/repos/${owner}/${name}/pulls?state=open&head=${encodeURIComponent(`${owner}:${DRAFT_BRANCH}`)}`);
  const pr = pulls[0];
  if (!pr) return undefined;
  const previewUrl = await getNetlifyPreviewUrl(pr.head.sha).catch(() => undefined);
  return {
    number: pr.number,
    htmlUrl: pr.html_url,
    state: pr.state,
    headSha: pr.head.sha,
    previewUrl,
  };
}

async function getNetlifyPreviewUrl(sha: string) {
  const { owner, name } = repo();
  const statuses = await github<{
    statuses: Array<{ context: string; target_url?: string; state: string }>;
  }>(`/repos/${owner}/${name}/commits/${sha}/status`);
  const netlify = statuses.statuses.find(status =>
    /netlify/i.test(status.context) && status.target_url?.includes('deploy-preview-'),
  );
  return netlify?.target_url;
}

export async function getDraftInfo(): Promise<DraftInfo> {
  const { baseBranch } = repo();
  const branch = await ensureDraftBranch();
  const { sha, content } = await getFileContent(branch).catch(async error => {
    if (error instanceof ApiError && error.status === 404) {
      return await getFileContent(baseBranch);
    }
    throw error;
  });

  return {
    branch,
    baseBranch,
    contentSha: sha,
    content,
    pr: await findDraftPullRequest(),
  };
}

export async function writePortfolioContent(content: PortfolioContent, baseSha: string) {
  const { owner, name } = repo();
  const branch = await ensureDraftBranch();
  const current = await getFileContent(branch).catch(async error => {
    if (error instanceof ApiError && error.status === 404) {
      return await getFileContent(repo().baseBranch);
    }
    throw error;
  });

  if (current.sha !== baseSha) {
    throw new ApiError(409, 'stale_draft', 'Draft has changed. Refresh before saving again.');
  }

  const body = JSON.stringify(portfolioContentSchema.parse(content), null, 2) + '\n';
  const result = await github<{ content: { sha: string }; commit: { sha: string } }>(
    `/repos/${owner}/${name}/contents/${CONTENT_PATH}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        message: 'Update portfolio content from admin',
        content: Buffer.from(body, 'utf8').toString('base64'),
        sha: current.sha,
        branch,
      }),
    },
  );

  const pr = await ensureDraftPullRequest();
  return { branch, contentSha: result.content.sha, commitSha: result.commit.sha, pr };
}

export async function writeAsset(path: string, bytes: Buffer, message: string) {
  const { owner, name } = repo();
  const branch = await ensureDraftBranch();

  let existingSha: string | undefined;
  try {
    const existing = await github<{ sha: string }>(
      `/repos/${owner}/${name}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    );
    existingSha = existing.sha;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
  }

  const result = await github<{ content: { sha: string }; commit: { sha: string } }>(
    `/repos/${owner}/${name}/contents/${path}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content: bytes.toString('base64'),
        sha: existingSha,
        branch,
      }),
    },
  );

  const pr = await ensureDraftPullRequest();
  return { branch, path, contentSha: result.content.sha, commitSha: result.commit.sha, pr };
}

export async function ensureDraftPullRequest() {
  const existing = await findDraftPullRequest();
  if (existing) return existing;

  const { owner, name, baseBranch } = repo();
  const pr = await github<{
    number: number;
    html_url: string;
    state: string;
    head: { sha: string };
  }>(`/repos/${owner}/${name}/pulls`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Portfolio admin draft',
      head: DRAFT_BRANCH,
      base: baseBranch,
      body: '@netlify /\n\nGenerated by the portfolio admin.',
      draft: false,
    }),
  });
  return {
    number: pr.number,
    htmlUrl: pr.html_url,
    state: pr.state,
    headSha: pr.head.sha,
  };
}

export async function mergeDraftPullRequest() {
  const { owner, name } = repo();
  const pr = await findDraftPullRequest();
  if (!pr) {
    throw new ApiError(404, 'missing_pr', 'No active draft pull request found.');
  }
  const result = await github<{ sha: string; merged: boolean; message: string }>(
    `/repos/${owner}/${name}/pulls/${pr.number}/merge`,
    {
      method: 'PUT',
      body: JSON.stringify({
        commit_title: 'Publish portfolio admin draft',
        merge_method: 'squash',
      }),
    },
  );
  return { ...result, pr };
}
