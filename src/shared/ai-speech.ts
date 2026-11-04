import { z } from 'zod';
import { LANGS } from './model';
import type { ShastraHit } from './shastra';
export const speechHelperSettingsSchema = z.object({ books: z.boolean(), verse: z.boolean() }).strict();
export type SpeechHelperSettings = z.infer<typeof speechHelperSettingsSchema>;
export const DEFAULT_SPEECH_HELPERS: Readonly<SpeechHelperSettings> = { books: false, verse: false };
export function speechHelperSettings(input: unknown): SpeechHelperSettings {
  const value = speechHelperSettingsSchema.safeParse(input);
  return value.success ? value.data : { ...DEFAULT_SPEECH_HELPERS };
}
// Workers return identities and scores only. Words and references are always read afresh by Main.
export const bookHintSchema = z.object({
  itemId: z.string().min(1).max(200),
  lang: z.enum(LANGS),
  stamp: z.string().regex(/^[a-f0-9]{64}$/u),
  score: z.number().min(0.84).max(1),
});
export type BookHint = z.infer<typeof bookHintSchema>;
export const bookQuerySchema = z.object({ query: z.string().trim().min(1).max(500) }).strict();
export interface BookReview {
  id: string;
  hits: ShastraHit[];
  checking: boolean;
  source: 'typed' | 'speech';
}
export interface VerseReview {
  id: string;
  label: string;
}
export interface SpeechHelperView {
  settings: SpeechHelperSettings;
  listening: 'off' | 'starting' | 'listening' | 'held' | 'failed';
  books: BookReview | null;
  verse: VerseReview | null;
  problem: string | null;
}
