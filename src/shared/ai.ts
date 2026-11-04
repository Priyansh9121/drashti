import { z } from 'zod';
import type { SearchResult } from './search';
import type { LyricProposal } from './ai-lyrics';
export type { AiResult, LyricProposal, LyricRequest } from './ai-lyrics';
export const AI_FEATURES = ['search', 'tidy', 'playlist'] as const;
export type AiFeature = (typeof AI_FEATURES)[number];
export const aiSettingsSchema = z
  .object({ search: z.boolean(), tidy: z.boolean(), playlist: z.boolean() })
  .strict();
export type AiSettings = z.infer<typeof aiSettingsSchema>;
export const DEFAULT_AI_SETTINGS: Readonly<AiSettings> = { search: false, tidy: false, playlist: false };
export function aiSettings(value: unknown): AiSettings {
  const parsed = aiSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : { ...DEFAULT_AI_SETTINGS };
}
export const AI_QUERY_MAX = 500;
export const aiSearchRequestSchema = z
  .object({ query: z.string().trim().min(1).max(AI_QUERY_MAX), requestId: z.string().min(1).max(100) })
  .strict();
export const aiPlaylistRequestSchema = z
  .object({
    date: z.iso.date(),
    pastIds: z.array(z.string().min(1).max(200)).min(1).max(50),
    requestId: z.string().min(1).max(100),
  })
  .strict();
export interface AiSearchProgress {
  requestId: string;
  result: SearchResult;
  checking: boolean;
}
export interface AiLyricReview {
  id: string;
  proposal: LyricProposal;
}
export interface AiPlaylistRow {
  id: string;
  label: string;
  source: string;
}
export interface AiPlaylistReview {
  id: string;
  name: string;
  date: string;
  rows: AiPlaylistRow[];
  calendar: string | null;
}
export const AI_MODEL = {
  id: 'intfloat/multilingual-e5-small',
  revision: '614241f622f53c4eeff9890bdc4f31cfecc418b3',
  licence: 'MIT',
  dimensions: 384,
  files: {
    'model.onnx': {
      bytes: 118346824,
      sha256: 'dd476dd0c2514e9b9be83aeb3853fac0763e0bdf4a71645407587d77c48a2d88',
    },
    'tokenizer.json': {
      bytes: 17082730,
      sha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39',
    },
    'tokenizer_config.json': {
      bytes: 443,
      sha256: 'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b',
    },
    'config.json': { bytes: 655, sha256: '69137736cab8b8903a07fe8afaafdda25aac55415a12a55d1bffa9f581abf959' },
  },
} as const;
