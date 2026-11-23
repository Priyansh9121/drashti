// Red: the captions bench's pure parts (CAP-CI-1). Not built yet.
export const BENCH_CANDIDATES = [] as readonly string[];
export type BenchCandidate = 'rc-gu' | 'rc-hi' | 'small-gu' | 'small-hi' | 'small-en';
export const LIVE_MS = 0;
export const GROWTH_MS = 0;
export interface BenchManifest {
  format: string;
  version: number;
  clips: {
    id: string;
    language: 'gu' | 'hi';
    text: string;
    text_digits: string | null;
    file: string;
    bytes: number;
    sha256: string;
    model: string;
  }[];
  english: { sentences: { id: string; text: string }[] };
}
export interface CandidateRun {
  candidate: BenchCandidate;
  plays: { id: string; onsetAt: number; speechEndAt: number; references: string[] }[];
  heard: { final: boolean; text: string; startAt: number; heardAt: number }[];
  holds: number;
  dropped: number;
  engineStartMs: number | null;
  engines: { pid: number; name: string; peak: number; affinity: number }[];
  scored: boolean;
}
const no = (): never => {
  throw new Error('not built yet');
};
export const parseCaptionsInput = (_s: string): unknown => no();
export const candidateLanguage = (_c: string): unknown => no();
export const candidateModel = (_c: string): unknown => no();
export const scoreWords = (_s: string): unknown => no();
export const errorRates = (_r: string[], _h: string): Record<string, number> => no();
export const percentile = (_v: number[], _p: number): unknown => no();
export const speechSpan = (_p: Int16Array): unknown => no();
export const timingsOf = (_p: unknown[], _h: unknown[]): unknown => no();
export const droppedIn = (_l: string[]): unknown => no();
export const summarize = (_r: CandidateRun): { live: boolean; why: string[]; missed: number; wer: null } =>
  no();
export const benchMarkdown = (_s: unknown[], _m: unknown): string => no();
export const affinityArgs = (_p: number, _m: number): string[] => no();
export const childrenArgs = (_p: number): string[] => no();
export const parseChildren = (_s: string): unknown[] => no();
export const englishSpeechArgs = (_t: string, _f: string): { args: string[]; env: unknown } => no();
