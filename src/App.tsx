import { useEffect, useMemo, useState } from 'react';
import { portfolioContentSchema, type AntigravityProject, type PortfolioContent, type PortfolioSlide } from './content/portfolio.schema';
import fallbackContent from './content/portfolio.json';

interface SessionState {
  authenticated: boolean;
  user: { id: number; login: string; avatarUrl?: string } | null;
  csrfToken: string | null;
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

function defaultTabs() {
  return [
    { id: 'overview' as const, label: 'Overview', title: 'Overview', body: 'Describe the project overview.', bullets: ['Audience', 'Goal', 'Output'] },
    { id: 'process' as const, label: 'Process', title: 'Process', body: 'Describe the project process.', bullets: ['Research', 'Iteration', 'Decision'] },
    { id: 'output' as const, label: 'Output', title: 'Output', body: 'Describe the final output.', bullets: ['Deliverable', 'Evidence', 'Result'] },
    { id: 'ai' as const, label: 'AI Workflow', title: 'AI Workflow', body: 'Describe how AI supported the work.', bullets: ['Exploration', 'Refinement', 'Validation'] },
  ];
}

function createProject(id: string): PortfolioSlide & { kind: 'project' } {
  return {
    id,
    kind: 'project',
    title: 'NEW PROJECT',
    subtitle: 'Project subtitle',
    range: 'P.00-00',
    accent: 'teal',
    cover: './project-1.jpg',
    summary: 'Short project summary.',
    role: 'Role / responsibility',
    problem: 'Problem statement.',
    evidence: ['Evidence point'],
    output: 'Output statement.',
    tools: 'Tools',
    aiRole: 'AI workflow note.',
    tags: ['NEW PROJECT'],
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
    role: project.role ?? 'Role / responsibility',
    problem: project.problem ?? 'Problem statement.',
    output: project.output ?? 'Output statement.',
    tools: project.tools ?? 'Tools',
    aiRole: project.aiRole ?? 'AI workflow note.',
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
  const [status, setStatus] = useState('Loading session...');
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
      setStatus('Not signed in.');
      return;
    }
    const nextContent = await api<ContentResponse>('/api/content');
    setContentInfo(nextContent);
    setContent(cloneContent(nextContent.content));
    setSelectedId(projectSlides(nextContent.content)[0]?.id ?? '');
    setStatus(nextContent.warning || 'Draft loaded.');
  }

  useEffect(() => {
    void Promise.resolve().then(refreshAll).catch(err => {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('Unable to load admin state.');
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
    const copy = { ...cloneContent({ ...content, slides: [selected] }).slides[0], id, title: `${selected.title} COPY` } as PortfolioSlide & { kind: 'project' };
    updateContent(draft => {
      const index = draft.slides.findIndex(slide => slide.id === selected.id);
      draft.slides.splice(index + 1, 0, copy);
      draft.antigravity.projects.push(createAntigravityProject(copy));
    });
    setSelectedId(id);
  }

  function removeProject(archiveOnly: boolean) {
    if (!selected) return;
    updateContent(draft => {
      if (archiveOnly) {
        const project = projectSlides(draft).find(item => item.id === selected.id);
        if (project) project.archived = true;
        const gravity = findAntigravityProject(draft, selected.id);
        if (gravity) gravity.archived = true;
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
    setStatus('Saving draft...');
    setError('');
    const result = await api<{ contentSha: string; pr?: ContentResponse['pr'] }>('/api/drafts', {
      method: 'POST',
      body: JSON.stringify({ baseSha: contentInfo.contentSha, content: portfolioContentSchema.parse(content) }),
    }, session.csrfToken);
    setContentInfo({ ...contentInfo, contentSha: result.contentSha, content: cloneContent(content), pr: result.pr ?? contentInfo.pr });
    setStatus('Draft saved. Netlify Deploy Preview may take a moment to appear.');
  }

  async function publish() {
    if (!session?.csrfToken) return;
    setStatus('Publishing draft PR...');
    const result = await api<{ merged: boolean; sha: string }>('/api/publish', { method: 'POST', body: '{}' }, session.csrfToken);
    setStatus(result.merged ? `Published at ${result.sha.slice(0, 7)}.` : 'Publish request completed.');
  }

  async function uploadCover(file: File) {
    if (!session?.csrfToken || !selected) return;
    setStatus('Uploading image...');
    const data = await encodeFile(file);
    const result = await api<{ src: string }>('/api/assets', {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, mimeType: file.type, data }),
    }, session.csrfToken);
    updateSelected(project => { project.cover = result.src; });
    setStatus('Image uploaded to draft branch. Save the content draft to use it.');
  }

  async function loadAudit() {
    const result = await api<{ events: AuditEvent[] }>('/api/audit-log');
    setAuditEvents(result.events);
  }

  async function logout() {
    await api('/api/session', { method: 'DELETE' });
    window.location.reload();
  }

  async function invalidateSessions() {
    if (!session?.csrfToken) return;
    await api('/api/session', { method: 'POST', body: JSON.stringify({ action: 'invalidate_all' }) }, session.csrfToken);
    window.location.reload();
  }

  if (!session?.authenticated) {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <p className="eyebrow">Andre Portfolio Admin</p>
          <h1>独立后台</h1>
          <p>使用 GitHub OAuth 登录。后台站和正式作品集站分离，正式站不读取后台 API。</p>
          {error && <p className="error">{error}</p>}
          <a className="primary-link" href="/api/session?login=github">Sign in with GitHub</a>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Portfolio CMS</p>
          <h1>作品集后台</h1>
        </div>
        <div className="topbar-actions">
          <span>{session.user?.login}</span>
          <button onClick={refreshAll}>Refresh</button>
          <button onClick={logout}>Logout</button>
        </div>
      </header>

      <section className="status-row">
        <span>{status}</span>
        {dirty && <strong>Unsaved changes</strong>}
        {contentInfo?.pr && <a href={contentInfo.pr.htmlUrl} target="_blank" rel="noreferrer">PR #{contentInfo.pr.number}</a>}
        {error && <span className="error">{error}</span>}
      </section>

      <div className="workspace">
        <aside className="project-list">
          <div className="list-actions">
            <button onClick={insertProject}>New</button>
            <button onClick={duplicateProject} disabled={!selected}>Duplicate</button>
          </div>
          {projects.map(project => (
            <button
              key={project.id}
              className={project.id === selected?.id ? 'active' : ''}
              onClick={() => setSelectedId(project.id)}
            >
              <img src={project.cover} alt="" />
              <span>
                <strong>{project.title}</strong>
                <small>{project.archived ? 'Archived' : project.subtitle}</small>
              </span>
            </button>
          ))}
        </aside>

        {selected && (
          <section className="editor">
            <div className="editor-head">
              <h2>{selected.title}</h2>
              <div>
                <button onClick={() => moveProject(-1)}>Up</button>
                <button onClick={() => moveProject(1)}>Down</button>
                <button onClick={() => removeProject(true)}>Archive</button>
                <button className="danger" onClick={() => removeProject(false)}>Delete</button>
              </div>
            </div>

            <div className="form-grid">
              <label>Title<input value={selected.title} onChange={event => updateSelected(project => { project.title = event.target.value; })} /></label>
              <label>Subtitle<input value={selected.subtitle} onChange={event => updateSelected(project => { project.subtitle = event.target.value; })} /></label>
              <label>Range<input value={selected.range ?? ''} onChange={event => updateSelected(project => { project.range = event.target.value; })} /></label>
              <label>Accent
                <select value={selected.accent} onChange={event => updateSelected(project => { project.accent = event.target.value as PortfolioSlide['accent']; })}>
                  <option value="teal">teal</option>
                  <option value="gold">gold</option>
                  <option value="black">black</option>
                </select>
              </label>
              <label className="wide">Summary<textarea value={selected.summary ?? ''} onChange={event => updateSelected(project => { project.summary = event.target.value; })} /></label>
              <label className="wide">Role<textarea value={selected.role ?? ''} onChange={event => updateSelected(project => { project.role = event.target.value; })} /></label>
              <label className="wide">Problem<textarea value={selected.problem ?? ''} onChange={event => updateSelected(project => { project.problem = event.target.value; })} /></label>
              <label className="wide">Output<textarea value={selected.output ?? ''} onChange={event => updateSelected(project => { project.output = event.target.value; })} /></label>
              <label>Tools<input value={selected.tools ?? ''} onChange={event => updateSelected(project => { project.tools = event.target.value; })} /></label>
              <label>Tags<input value={(selected.tags ?? []).join(', ')} onChange={event => updateSelected(project => { project.tags = event.target.value.split(',').map(tag => tag.trim()).filter(Boolean); })} /></label>
              <label className="wide">AI Role<textarea value={selected.aiRole ?? ''} onChange={event => updateSelected(project => { project.aiRole = event.target.value; })} /></label>
            </div>

            <div className="media-editor">
              <img src={selected.cover} alt={selected.title} />
              <label className="upload">
                Replace cover
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => {
                  const file = event.target.files?.[0];
                  if (file) uploadCover(file).catch(err => setError(err instanceof Error ? err.message : String(err)));
                }} />
              </label>
            </div>

            <h3>Tabs</h3>
            <div className="tabs-editor">
              {(selected.tabs ?? []).map((tab, index) => (
                <label key={tab.id}>
                  {tab.label}
                  <input value={tab.title} onChange={event => updateSelected(project => { if (project.tabs?.[index]) project.tabs[index].title = event.target.value; })} />
                  <textarea value={tab.body} onChange={event => updateSelected(project => { if (project.tabs?.[index]) project.tabs[index].body = event.target.value; })} />
                </label>
              ))}
            </div>

            <h3>Gallery</h3>
            <div className="gallery-editor">
              {(selected.gallery ?? []).map((item, index) => (
                <label key={`${item.src}-${index}`}>
                  <input value={item.label} onChange={event => updateSelected(project => { if (project.gallery?.[index]) project.gallery[index].label = event.target.value; })} />
                  <input value={item.src} onChange={event => updateSelected(project => { if (project.gallery?.[index]) project.gallery[index].src = event.target.value; })} />
                  <textarea value={item.caption} onChange={event => updateSelected(project => { if (project.gallery?.[index]) project.gallery[index].caption = event.target.value; })} />
                </label>
              ))}
              <button onClick={() => updateSelected(project => {
                project.gallery = [...(project.gallery ?? []), { src: project.cover ?? './project-1.jpg', label: 'NEW IMAGE', caption: 'Caption', evidenceType: 'Evidence' }];
              })}>Add gallery item</button>
            </div>

            {selectedGravity && <p className="sync-note">Antigravity project is synced for: {selectedGravity.title}</p>}
          </section>
        )}

        <aside className="preview">
          <div className="preview-actions">
            <button className={previewMode === 'desktop' ? 'active' : ''} onClick={() => setPreviewMode('desktop')}>Desktop</button>
            <button className={previewMode === 'mobile' ? 'active' : ''} onClick={() => setPreviewMode('mobile')}>Mobile</button>
          </div>
          <iframe className={previewMode} src={previewUrl} title="Portfolio preview" />
          <div className="publish-actions">
            <button className="primary" onClick={() => saveDraft().catch(err => setError(err instanceof Error ? err.message : String(err)))} disabled={!dirty}>Save draft</button>
            <button onClick={() => publish().catch(err => setError(err instanceof Error ? err.message : String(err)))}>Publish PR</button>
            <button onClick={loadAudit}>Audit log</button>
            <button className="danger" onClick={invalidateSessions}>Kick sessions</button>
          </div>
          <pre className="diff">{JSON.stringify({ branch: contentInfo?.branch, baseSha: contentInfo?.contentSha, dirty }, null, 2)}</pre>
          {auditEvents.length > 0 && (
            <div className="audit-list">
              {auditEvents.map(event => (
                <div key={event.id}>
                  <strong>{event.action}</strong>
                  <span>{event.actor.login} / {event.target}</span>
                  <small>{new Date(event.timestamp).toLocaleString()}</small>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
