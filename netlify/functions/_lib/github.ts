import { Buffer } from 'node:buffer';
import { portfolioContentSchema, type PortfolioContent } from '../../../src/content/portfolio.schema';
import fallbackContent from '../../../src/content/portfolio.json';
import { ApiError, getOptionalEnv, getRequiredEnv } from './http';

const CONTENT_PATH = 'app/src/content/portfolio.json';
const DRAFT_BRANCH = 'portfolio-admin-draft';
export const MISSING_SHA = 'missing_sha_sentinel';

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
  warning?: string;
  pr?: {
    number: number;
    htmlUrl: string;
    state: string;
    headSha: string;
    previewUrl?: string;
  };
}

interface ContentState {
  kind: 'draft' | 'base' | 'fallback';
  sha: string;
  content: PortfolioContent;
  warning?: string;
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

async function pathExistsInBranchTree(branch: string): Promise<boolean> {
  const { owner, name } = repo();
  const tree = await github<{
    tree: Array<{ path: string; type: string }>;
    truncated?: boolean;
  }>(`/repos/${owner}/${name}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  if (tree.truncated) {
    throw new ApiError(502, 'github_tree_truncated', 'GitHub 仓库目录过大，无法可靠确认内容文件是否存在。');
  }
  return tree.tree.some(item => item.type === 'blob' && item.path === CONTENT_PATH);
}

async function verifyContent404(branch: string): Promise<void> {
  const exists = await pathExistsInBranchTree(branch);
  if (exists) {
    throw new ApiError(
      502,
      'github_content_unavailable',
      'GitHub Contents API returned 404 but the file exists in the repository tree; the content may be unavailable due to a service issue.',
    );
  }
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

export async function getFileContent(branch: string): Promise<{ sha: string; content: PortfolioContent }> {
  const { owner, name } = repo();
  const file = await github<GitHubContentResponse>(
    `/repos/${owner}/${name}/contents/${CONTENT_PATH}?ref=${encodeURIComponent(branch)}`,
  );
  if (file.encoding !== 'base64') {
    throw new ApiError(502, 'unsupported_encoding', 'GitHub 返回了不支持的文件编码。');
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

async function getDraftContentState(): Promise<ContentState> {
  const { baseBranch } = repo();
  const branch = await ensureDraftBranch();

  try {
    const { sha, content } = await getFileContent(branch);
    return { kind: 'draft', sha, content };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      await verifyContent404(branch);
      try {
        const { sha, content } = await getFileContent(baseBranch);
        return {
          kind: 'base',
          sha,
          content,
          warning: '草稿分支尚未包含 portfolio.json，已从基础分支加载。首次保存将在草稿分支创建该文件。',
        };
      } catch (baseError) {
        if (baseError instanceof ApiError && baseError.status === 404) {
          await verifyContent404(baseBranch);
          return {
            kind: 'fallback',
            sha: MISSING_SHA,
            content: fallbackPortfolioContent(),
            warning: '远端仓库尚无 portfolio.json，已加载本地默认内容。首次保存将自动创建该文件。',
          };
        }
        throw baseError;
      }
    }
    throw error;
  }
}

export async function getDraftInfo(): Promise<DraftInfo> {
  const { baseBranch } = repo();
  const branch = await ensureDraftBranch();
  const state = await getDraftContentState();

  return {
    branch,
    baseBranch,
    contentSha: state.kind === 'draft' ? state.sha : MISSING_SHA,
    content: state.content,
    warning: state.warning,
    pr: await findDraftPullRequest(),
  };
}

export async function writePortfolioContent(content: PortfolioContent, baseSha: string) {
  const { owner, name } = repo();
  const branch = await ensureDraftBranch();

  let currentSha: string | undefined;
  let currentExists = false;
  try {
    const draft = await getFileContent(branch);
    currentSha = draft.sha;
    currentExists = true;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
    await verifyContent404(branch);
  }

  const body = JSON.stringify(portfolioContentSchema.parse(content), null, 2) + '\n';
  const staleError = new ApiError(409, 'stale_draft', '草稿已被他人修改，请先刷新再保存。');

  if (baseSha === MISSING_SHA) {
    if (currentExists) throw staleError;

    let result: { content: { sha: string }; commit: { sha: string } };
    try {
      result = await github<{ content: { sha: string }; commit: { sha: string } }>(
        `/repos/${owner}/${name}/contents/${CONTENT_PATH}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            message: 'Create portfolio content from admin',
            content: Buffer.from(body, 'utf8').toString('base64'),
            branch,
          }),
        },
      );
    } catch (error) {
      if (error instanceof ApiError && (error.status === 409 || error.status === 422)) {
        throw staleError;
      }
      throw error;
    }
    const pr = await ensureDraftPullRequest();
    return { branch, contentSha: result.content.sha, commitSha: result.commit.sha, pr };
  }

  if (!currentExists || currentSha !== baseSha) {
    throw staleError;
  }

  const result = await github<{ content: { sha: string }; commit: { sha: string } }>(
    `/repos/${owner}/${name}/contents/${CONTENT_PATH}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        message: 'Update portfolio content from admin',
        content: Buffer.from(body, 'utf8').toString('base64'),
        sha: currentSha,
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
  try {
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
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) {
      const raced = await findDraftPullRequest();
      if (raced) return raced;
    }
    throw error;
  }
}

export async function mergeDraftPullRequest() {
  const { owner, name } = repo();
  const pr = await findDraftPullRequest();
  if (!pr) {
    throw new ApiError(404, 'missing_pr', '当前没有可合并的草稿 Pull Request。');
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
