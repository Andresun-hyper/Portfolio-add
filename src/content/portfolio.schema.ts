import { z } from 'zod';

export const accentSchema = z.enum(['teal', 'gold', 'black']);
export const jobTrackSchema = z.enum(['industrial', 'ux', 'ai']);
export const trackFilterSchema = z.enum(['all', 'industrial', 'ux', 'ai']);
export const projectTabKeySchema = z.enum(['overview', 'process', 'output', 'ai']);

export const galleryItemSchema = z.object({
  src: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['image', 'video']).optional(),
  caption: z.string().min(1),
  evidenceType: z.string().min(1),
  projectId: z.string().min(1).optional(),
});

export const projectTabSchema = z.object({
  id: projectTabKeySchema,
  label: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  bullets: z.array(z.string().min(1)),
});

export const portfolioSlideSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['cover', 'contents', 'project', 'contact']),
  title: z.string().min(1),
  subtitle: z.string().min(1),
  visible: z.boolean().optional(),
  archived: z.boolean().optional(),
  range: z.string().min(1).optional(),
  accent: accentSchema,
  cover: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).optional(),
  gallery: z.array(galleryItemSchema).optional(),
  video: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  problem: z.string().min(1).optional(),
  evidence: z.array(z.string().min(1)).optional(),
  output: z.string().min(1).optional(),
  tools: z.string().min(1).optional(),
  aiRole: z.string().min(1).optional(),
  jobTracks: z.array(jobTrackSchema).optional(),
  tabs: z.array(projectTabSchema).optional(),
});

export const antigravityProjectSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().min(1),
  visible: z.boolean().optional(),
  archived: z.boolean().optional(),
  range: z.string().min(1),
  accent: accentSchema,
  cover: z.string().min(1),
  summary: z.string().min(1),
  role: z.string().min(1),
  problem: z.string().min(1),
  output: z.string().min(1),
  tools: z.string().min(1),
  aiRole: z.string().min(1),
  tags: z.array(z.string().min(1)),
  gallery: z.array(galleryItemSchema),
  tabs: z.array(projectTabSchema),
});

export const portfolioContentSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().min(1),
  contact: z.object({
    githubUrl: z.string().url(),
    wechatId: z.string().min(1),
    resumeFile: z.string().min(1),
  }),
  trackLabels: z.record(trackFilterSchema, z.object({
    label: z.string().min(1),
    caption: z.string().min(1),
  })),
  slides: z.array(portfolioSlideSchema),
  antigravity: z.object({
    searchSuggestions: z.array(z.string().min(1)),
    skillTags: z.array(z.object({
      title: z.string().min(1),
      detail: z.string().min(1),
    })),
    projects: z.array(antigravityProjectSchema),
  }),
});

export type Accent = z.infer<typeof accentSchema>;
export type JobTrack = z.infer<typeof jobTrackSchema>;
export type TrackFilter = z.infer<typeof trackFilterSchema>;
export type ProjectTabKey = z.infer<typeof projectTabKeySchema>;
export type GalleryItem = z.infer<typeof galleryItemSchema>;
export type ProjectTab = z.infer<typeof projectTabSchema>;
export type PortfolioSlide = z.infer<typeof portfolioSlideSchema>;
export type PortfolioProjectSlide = PortfolioSlide & { kind: 'project' };
export type PortfolioContent = z.infer<typeof portfolioContentSchema>;
export type AntigravityProject = z.infer<typeof antigravityProjectSchema>;
