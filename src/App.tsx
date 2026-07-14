import { useEffect, useMemo, useState } from 'react';
import { portfolioContentSchema, type AntigravityProject, type PortfolioContent, type PortfolioSlide } from './content/portfolio.schema';
import fallbackContent from './content/portfolio.json';
import {
  ArrowDown,
  ArrowUp,
  Archive,
  Copy,
  History,
  ImagePlus,
  LogIn,
  LogOut,
  Monitor,
  Plus,
  RefreshCw,
  Save,
  Send,
  ShieldAlert,
  Smartphone,
  Trash2,
} from 'lucide-react';

interface ConfigStatus {
  ready: boolean;
  missing: string[];
  callback: string;
}

interface SessionState {
  authenticated: boolean;
  user: { id: number; login: string; avatarUrl?: string } | null;
  csrfToken: string | null;
  config: ConfigStatus;
}

interface ContentResponse {
  branch: string;
  baseBranch: string;
  contentSha: string;
  content: PortfolioContent;
  pr?: { number: number; htmlUrl: string; state: string; headSha: string; previewUrl?: string };
  warning?: string;
}

interface AuditEvent {
  id: string;
  actor: { login: string; id: number };
  action: string;
  target: string;
  commitSha?: string;
  timestamp: string;
  eventHash: string;
}

const FALLBACK_PORTFOLIO_URL = 'https://andresun-hyper-portfolio.netlify.app/';
const portfolioUrl = import.meta.env.VITE_PORTFOLIO_URL || FALLBACK_PORTFOLIO_URL;

function portfolioAssetUrl(src?: string): string {
  if (!src) return '';
  if (/^(?:https?:|data:|blob:)/i.test(src)) return src;
  return new URL(src, portfolioUrl).toString();
}

async function api<T>(path: string, options: RequestInit = {}, csrfToken?: string | null): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (csrfToken) headers.set('x-csrf-token', csrfToken);

  const response = await fetch(path, {
    credentials: 'include',
    ...options,
    headers,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || response.statusText);
  }
  return payload as T;
}

function cloneContent(content: PortfolioContent) {
  return portfolioContentSchema.parse(JSON.parse(JSON.stringify(content)));
}

function projectSlides(content: PortfolioContent) {
  return content.slides.filter((slide): slide is PortfolioSlide & { kind: 'project' } => slide.kind === 'project');
}

function findAntigravityProject(content: PortfolioContent, id: string) {
  return content.antigravity.projects.find(project => project.id === id);
}

function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (lower.includes('stale_draft') || lower.includes('draft has changed')) {
    return '草稿已被他人修改，请先刷新再保存。';
  }
  if (lower.includes('missing_pr')) {
    return '当前没有可合并的草稿 Pull Request。';
  }
  if (lower.includes('rate limit') || lower.includes('too many requests') || lower.includes('429')) {
    return 'GitHub API 请求过于频繁，请稍后再试。';
  }
  if (lower.includes('401') || lower.includes('403') || lower.includes('bad credentials') || lower.includes('permission')) {
    return 'PAT 或 GitHub 权限不足，请检查仓库、分支和 Token 配置。';
  }
  if (lower.includes('404') || lower.includes('not found')) {
    return '远端文件不存在，或仓库、分支、PAT 配置有误。';
  }
  if (lower.includes('upload') || lower.includes('asset') || lower.includes('image')) {
    return '图片上传失败，请检查文件格式和网络后重试。';
  }
  if (lower.includes('body_too_large') || lower.includes('too large')) {
    return '请求内容过大，请缩小图片或文件后重试。';
  }
  if (lower.includes('invalid_json')) {
    return '提交数据格式错误，请刷新后重试。';
  }
  return '操作失败，请稍后重试；若问题持续，请检查后台配置。';
}

function auditActionLabel(action: string): string {
  const labels: Record<string, string> = {
    login: '登录后台',
    save_draft: '保存草稿',
    upload_asset: '上传图片',
    publish: '发布作品集',
    invalidate_sessions: '退出所有会话',
    rate_limit: '触发访问限制',
  };
  return labels[action] ?? '后台操作';
}

function defaultTabs() {
  return [
    { id: 'overview' as const, label: '概述', title: '项目概述', body: '描述项目背景与目标。', bullets: ['受众', '目标', '产出'] },
    { id: 'process' as const, label: '过程', title: '设计过程', body: '描述项目推进过程。', bullets: ['研究', '迭代', '决策'] },
    { id: 'output' as const, label: '产出', title: '最终产出', body: '描述最终交付物。', bullets: ['交付物', '证据', '结果'] },
    { id: 'ai' as const, label: 'AI 工作流', title: 'AI 工作流', body: '描述 AI 如何辅助本项目。', bullets: ['探索', '细化', '验证'] },
  ];
}

function createProject(id: string): PortfolioSlide & { kind: 'project' } {
  return {
    id,
    kind: 'project',
    title: '新项目',
    subtitle: '项目副标题',
    range: 'P.00-00',
    accent: 'teal',
    cover: './project-1.jpg',
    summary: '简短项目摘要。',
    role: '角色 / 职责',
    problem: '问题陈述。',
    evidence: ['证据点'],
    output: '产出说明。',
    tools: '工具',
    aiRole: 'AI 工作流说明。',
    tags: ['新项目'],
    jobTracks: ['industrial'],
    gallery: [],
    tabs: defaultTabs(),
  };
}

function createAntigravityProject(project: PortfolioSlide & { kind: 'project' }): AntigravityProject {
  return {
    id: project.id,
    title: project.title,
    subtitle: project.subtitle,
    range: project.range ?? 'P.00-00',
    accent: project.accent,
    cover: project.cover ?? './project-1.jpg',
    summary: project.summary ?? project.title,
    role: project.role ?? '角色 / 职责',
    problem: project.problem ?? '问题陈述。',
    output: project.output ?? '产出说明。',
    tools: project.tools ?? '工具',
    aiRole: project.aiRole ?? 'AI 工作流说明。',
    tags: project.tags ?? [],
    gallery: project.gallery ?? [],
    tabs: project.tabs ?? defaultTabs(),
  };
}

function encodeFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

export default function App() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [contentInfo, setContentInfo] = useState<ContentResponse | null>(null);
  const [content, setContent] = useState<PortfolioContent>(() => portfolioContentSchema.parse(fallbackContent));
  const [selectedId, setSelectedId] = useState<string>('droplet');
  const [status, setStatus] = useState('加载会话中…');
  const [error, setError] = useState('');
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);

  const projects = useMemo(() => projectSlides(content), [content]);
  const selected = projects.find(project => project.id === selectedId) ?? projects[0];
  const selectedGravity = selected ? findAntigravityProject(content, selected.id) : undefined;
  const dirty = contentInfo ? JSON.stringify(contentInfo.content) !== JSON.stringify(content) : false;
  const previewUrl = contentInfo?.pr?.previewUrl || portfolioUrl;

  async function refreshAll() {
    setError('');
    const nextSession = await api<SessionState>('/api/session');
    setSession(nextSession);
    if (!nextSession.authenticated) {
      setStatus('未登录');
      return;
    }
    const nextContent = await api<ContentResponse>('/api/content');
    setContentInfo(nextContent);
    setContent(cloneContent(nextContent.content));
    setSelectedId(projectSlides(nextContent.content)[0]?.id ?? '');
    setStatus(nextContent.warning || '草稿已加载');
  }

  useEffect(() => {
    void Promise.resolve().then(refreshAll).catch(err => {
      setError(friendlyError(err));
      setStatus('无法加载后台状态');
    });
  }, []);

  function updateContent(mutator: (draft: PortfolioContent) => void) {
    setContent(current => {
      const draft = cloneContent(current);
      mutator(draft);
      return draft;
    });
  }

  function updateSelected(mutator: (project: PortfolioSlide & { kind: 'project' }) => void) {
    if (!selected) return;
    updateContent(draft => {
      const project = projectSlides(draft).find(item => item.id === selected.id);
      if (project) mutator(project);
      const gravity = findAntigravityProject(draft, selected.id);
      if (gravity && project) {
        gravity.title = project.title;
        gravity.subtitle = project.subtitle;
        gravity.range = project.range ?? gravity.range;
        gravity.accent = project.accent;
        gravity.cover = project.cover ?? gravity.cover;
        gravity.summary = project.summary ?? gravity.summary;
        gravity.role = project.role ?? gravity.role;
        gravity.problem = project.problem ?? gravity.problem;
        gravity.output = project.output ?? gravity.output;
        gravity.tools = project.tools ?? gravity.tools;
        gravity.aiRole = project.aiRole ?? gravity.aiRole;
        gravity.tags = project.tags ?? gravity.tags;
        gravity.gallery = project.gallery ?? gravity.gallery;
        gravity.tabs = project.tabs ?? gravity.tabs;
      }
    });
  }

  function insertProject() {
    const id = `project-${Date.now()}`;
    const project = createProject(id);
    updateContent(draft => {
      const contactIndex = draft.slides.findIndex(slide => slide.kind === 'contact');
      draft.slides.splice(contactIndex >= 0 ? contactIndex : draft.slides.length, 0, project);
      draft.antigravity.projects.push(createAntigravityProject(project));
    });
    setSelectedId(id);
  }

  function duplicateProject() {
    if (!selected) return;
    const id = `${selected.id}-copy-${Date.now()}`;
    const copy = { ...cloneContent({ ...content, slides: [selected] }).slides[0], id, title: `${selected.title} 副本` } as PortfolioSlide & { kind: 'project' };
    updateContent(draft => {
      const index = draft.slides.findIndex(slide => slide.id === selected.id);
      draft.slides.splice(index + 1, 0, copy);
      draft.antigravity.projects.push(createAntigravityProject(copy));
    });
    setSelectedId(id);
  }

  function removeProject(archiveOnly: boolean) {
    if (!selected) return;
    if (!archiveOnly) {
      const ok = window.confirm('确定永久删除该项目吗？此操作不可撤销。');
      if (!ok) return;
    }
    updateContent(draft => {
      if (archiveOnly) {
        const project = projectSlides(draft).find(item => item.id === selected.id);
        const archived = !project?.archived;
        if (project) project.archived = archived;
        const gravity = findAntigravityProject(draft, selected.id);
        if (gravity) gravity.archived = archived;
      } else {
        draft.slides = draft.slides.filter(slide => slide.id !== selected.id);
        draft.antigravity.projects = draft.antigravity.projects.filter(project => project.id !== selected.id);
      }
    });
    const next = projects.find(project => project.id !== selected.id);
    setSelectedId(next?.id ?? '');
  }

  function moveProject(direction: -1 | 1) {
    if (!selected) return;
    updateContent(draft => {
      const indexes = draft.slides
        .map((slide, index) => ({ slide, index }))
        .filter(item => item.slide.kind === 'project');
      const current = indexes.findIndex(item => item.slide.id === selected.id);
      const target = current + direction;
      if (current < 0 || target < 0 || target >= indexes.length) return;
      const a = indexes[current].index;
      const b = indexes[target].index;
      [draft.slides[a], draft.slides[b]] = [draft.slides[b], draft.slides[a]];
    });
  }

  async function saveDraft() {
    if (!session?.csrfToken || !contentInfo) return;
    setStatus('保存草稿中…');
    setError('');
    try {
      const result = await api<{ contentSha: string; pr?: ContentResponse['pr'] }>('/api/drafts', {
        method: 'POST',
        body: JSON.stringify({ baseSha: contentInfo.contentSha, content: portfolioContentSchema.parse(content) }),
      }, session.csrfToken);
      setContentInfo({ ...contentInfo, contentSha: result.contentSha, content: cloneContent(content), pr: result.pr ?? contentInfo.pr });
      setStatus('草稿已保存，Netlify Deploy Preview 稍后可用');
    } catch (err) {
      setError(friendlyError(err));
      setStatus('保存失败');
    }
  }

  async function publish() {
    if (!session?.csrfToken) return;
    const ok = window.confirm('确定合并发布当前草稿吗？发布后将更新线上作品集。');
    if (!ok) return;
    setStatus('发布合并中…');
    setError('');
    try {
      const result = await api<{ merged: boolean; sha: string }>('/api/publish', { method: 'POST', body: '{}' }, session.csrfToken);
      setStatus(result.merged ? `已发布，提交 ${result.sha.slice(0, 7)}` : '发布请求已完成');
    } catch (err) {
      setError(friendlyError(err));
      setStatus('发布失败');
    }
  }

  async function uploadCover(file: File) {
    if (!session?.csrfToken || !selected) return;
    setStatus('上传图片中…');
    setError('');
    try {
      const data = await encodeFile(file);
      const result = await api<{ src: string }>('/api/assets', {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, mimeType: file.type, data }),
      }, session.csrfToken);
      updateSelected(project => { project.cover = result.src; });
      setStatus('图片已上传至草稿分支，保存草稿后即可生效');
    } catch (err) {
      setError(friendlyError(err));
      setStatus('图片上传失败');
    }
  }

  async function loadAudit() {
    setStatus('加载审计日志…');
    setError('');
    try {
      const result = await api<{ events: AuditEvent[] }>('/api/audit-log');
      setAuditEvents(result.events);
      setStatus('审计日志已加载');
    } catch (err) {
      setError(friendlyError(err));
      setStatus('审计日志加载失败');
    }
  }

  async function logout() {
    try {
      await api('/api/session', { method: 'DELETE' });
      window.location.reload();
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  async function invalidateSessions() {
    if (!session?.csrfToken) return;
    const ok = window.confirm('确定退出所有会话吗？包括当前登录。');
    if (!ok) return;
    try {
      await api('/api/session', { method: 'POST', body: JSON.stringify({ action: 'invalidate_all' }) }, session.csrfToken);
      window.location.reload();
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  if (!session?.authenticated) {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <p className="eyebrow">作品集管理后台</p>
          <h1>独立后台</h1>
          {session?.config && !session.config.ready ? (
            <div className="setup-notice">
              <p>管理后台尚未就绪。请设置以下 Netlify 站点环境变量。密钥名称不得以 VITE_ 开头，避免构建时泄露。</p>
              <ul className="missing-list">
                {session.config.missing.map(name => (
                  <li key={name}><code>{name}</code></li>
                ))}
              </ul>
              <p>GitHub OAuth 回调地址：</p>
              <code className="callback-url">{session.config.callback}</code>
            </div>
          ) : (
            <p>使用 GitHub OAuth 登录。后台站与正式作品集站分离，正式站不读取后台 API。</p>
          )}
          {error && <p className="error">{error}</p>}
          {session?.config?.ready ? (
            <a className="primary-link" href="/api/session?login=github">
              <LogIn size={16} /> 使用 GitHub 登录
            </a>
          ) : (
            <button className="primary-link" disabled>
              {session?.config ? '先配置环境变量' : '加载中…'}
            </button>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">作品集管理后台</p>
          <h1>作品集后台</h1>
        </div>
        <div className="topbar-actions">
          <span className="user-name">{session.user?.login}</span>
          <button onClick={() => refreshAll().catch(err => setError(friendlyError(err)))}>
            <RefreshCw size={14} /> 刷新
          </button>
          <button onClick={logout}>
            <LogOut size={14} /> 退出
          </button>
        </div>
      </header>

      <section className="status-row">
        <span className="status-text">{status}</span>
        {dirty && <strong className="dirty-badge">有未保存修改</strong>}
        {contentInfo?.pr && <a href={contentInfo.pr.htmlUrl} target="_blank" rel="noreferrer">查看草稿 PR #{contentInfo.pr.number}</a>}
        {error && <span className="error">{error}</span>}
      </section>

      <div className="workspace">
        <aside className="project-list">
          <div className="list-actions">
            <button onClick={insertProject}><Plus size={14} /> 新建</button>
            <button onClick={duplicateProject} disabled={!selected}><Copy size={14} /> 复制</button>
          </div>
          {projects.length === 0 ? (
            <p className="empty">暂无项目</p>
          ) : (
            projects.map(project => (
              <button
                key={project.id}
                className={project.id === selected?.id ? 'active' : ''}
                onClick={() => setSelectedId(project.id)}
              >
                <img src={portfolioAssetUrl(project.cover)} alt="" />
                <span>
                  <strong>{project.title}</strong>
                  <small>{project.archived ? '已归档' : project.subtitle}</small>
                </span>
              </button>
            ))
          )}
        </aside>

        {selected && (
          <section className="editor">
            <div className="editor-head">
              <h2>{selected.title}</h2>
              <div>
                <button onClick={() => moveProject(-1)}><ArrowUp size={14} /> 上移</button>
                <button onClick={() => moveProject(1)}><ArrowDown size={14} /> 下移</button>
                <button onClick={() => removeProject(true)}><Archive size={14} /> {selected.archived ? '取消归档' : '归档'}</button>
                <button className="danger" onClick={() => removeProject(false)}><Trash2 size={14} /> 删除</button>
              </div>
            </div>

            <div className="form-grid">
              <label>标题<input value={selected.title} onChange={event => updateSelected(project => { project.title = event.target.value; })} /></label>
              <label>副标题<input value={selected.subtitle} onChange={event => updateSelected(project => { project.subtitle = event.target.value; })} /></label>
              <label>编号<input value={selected.range ?? ''} onChange={event => updateSelected(project => { project.range = event.target.value; })} /></label>
              <label>强调色
                <select value={selected.accent} onChange={event => updateSelected(project => { project.accent = event.target.value as PortfolioSlide['accent']; })}>
                  <option value="teal">青色</option>
                  <option value="gold">金色</option>
                  <option value="black">墨色</option>
                </select>
              </label>
              <label className="wide">摘要<textarea value={selected.summary ?? ''} onChange={event => updateSelected(project => { project.summary = event.target.value; })} /></label>
              <label className="wide">角色 / 职责<textarea value={selected.role ?? ''} onChange={event => updateSelected(project => { project.role = event.target.value; })} /></label>
              <label className="wide">问题<textarea value={selected.problem ?? ''} onChange={event => updateSelected(project => { project.problem = event.target.value; })} /></label>
              <label className="wide">产出<textarea value={selected.output ?? ''} onChange={event => updateSelected(project => { project.output = event.target.value; })} /></label>
              <label>工具<input value={selected.tools ?? ''} onChange={event => updateSelected(project => { project.tools = event.target.value; })} /></label>
              <label>标签<input value={(selected.tags ?? []).join(', ')} onChange={event => updateSelected(project => { project.tags = event.target.value.split(',').map(tag => tag.trim()).filter(Boolean); })} /></label>
              <label className="wide">AI 作用<textarea value={selected.aiRole ?? ''} onChange={event => updateSelected(project => { project.aiRole = event.target.value; })} /></label>
            </div>

            <div className="media-editor">
              <img src={portfolioAssetUrl(selected.cover)} alt={selected.title} />
              <label className="upload">
                <ImagePlus size={14} /> 替换封面
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => {
                  const file = event.target.files?.[0];
                  if (file) uploadCover(file);
                }} />
              </label>
            </div>

            <h3>标签页</h3>
            <div className="tabs-editor">
              {(selected.tabs ?? []).map((tab, index) => (
                <label key={tab.id}>
                  <span className="tab-label">{tab.label}</span>
                  <input value={tab.title} onChange={event => updateSelected(project => { if (project.tabs?.[index]) project.tabs[index].title = event.target.value; })} />
                  <textarea value={tab.body} onChange={event => updateSelected(project => { if (project.tabs?.[index]) project.tabs[index].body = event.target.value; })} />
                </label>
              ))}
            </div>

            <h3>图库</h3>
            <div className="gallery-editor">
              {(selected.gallery ?? []).map((item, index) => (
                <label key={`${item.src}-${index}`}>
                  <input value={item.label} onChange={event => updateSelected(project => { if (project.gallery?.[index]) project.gallery[index].label = event.target.value; })} />
                  <input value={item.src} onChange={event => updateSelected(project => { if (project.gallery?.[index]) project.gallery[index].src = event.target.value; })} />
                  <textarea value={item.caption} onChange={event => updateSelected(project => { if (project.gallery?.[index]) project.gallery[index].caption = event.target.value; })} />
                </label>
              ))}
              <button onClick={() => updateSelected(project => {
                project.gallery = [...(project.gallery ?? []), { src: project.cover ?? './project-1.jpg', label: '新图片', caption: '图片说明', evidenceType: '证据' }];
              })}><Plus size={14} /> 添加图片</button>
            </div>

            {selectedGravity && <p className="sync-note">Antigravity 项目已同步：{selectedGravity.title}</p>}
          </section>
        )}

        <aside className="preview">
          <div className="preview-actions">
            <button className={previewMode === 'desktop' ? 'active' : ''} onClick={() => setPreviewMode('desktop')}>
              <Monitor size={14} /> 电脑
            </button>
            <button className={previewMode === 'mobile' ? 'active' : ''} onClick={() => setPreviewMode('mobile')}>
              <Smartphone size={14} /> 手机
            </button>
          </div>
          <div className={`preview-frame ${previewMode}`}>
            <div className="preview-chrome">
              <span className="preview-title">{previewMode === 'desktop' ? '电脑 1440 × 900' : '手机 390 × 844'}</span>
              <a href={previewUrl} target="_blank" rel="noreferrer">↗ 新窗口打开</a>
            </div>
            <iframe className={previewMode} src={previewUrl} title="作品集预览" />
          </div>
          <div className="publish-actions">
            <button className="primary" onClick={saveDraft} disabled={!dirty}>
              <Save size={14} /> 保存草稿
            </button>
            <button onClick={publish} disabled={!contentInfo?.pr}>
              <Send size={14} /> 发布合并
            </button>
            <button onClick={loadAudit}>
              <History size={14} /> 审计日志
            </button>
            <button className="danger" onClick={invalidateSessions}>
              <ShieldAlert size={14} /> 退出所有会话
            </button>
          </div>
          <dl className="draft-meta">
            <div><dt>草稿分支</dt><dd>{contentInfo?.branch ?? '尚未加载'}</dd></div>
            <div><dt>基础分支</dt><dd>{contentInfo?.baseBranch ?? '尚未加载'}</dd></div>
            <div><dt>内容版本</dt><dd>{contentInfo?.contentSha?.slice(0, 12) ?? '尚未创建'}</dd></div>
            <div><dt>保存状态</dt><dd>{dirty ? '有未保存修改' : '已同步'}</dd></div>
          </dl>
          {auditEvents.length > 0 && (
            <div className="audit-list">
              {auditEvents.map(event => (
                <div key={event.id}>
                  <strong>{auditActionLabel(event.action)}</strong>
                  <span>{event.actor.login} / {event.target}</span>
                  <small>{new Date(event.timestamp).toLocaleString('zh-CN')}</small>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
