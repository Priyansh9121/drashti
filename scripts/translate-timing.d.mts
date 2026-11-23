export type Size = 'tiny' | 'full';
export const FIXTURE_DIR: string;
export const FIXTURE_FILES: string[];
export const FIXTURE_SHA256: Record<Size, Record<string, string>>;
export const LIMIT_MS: number;
export const LOAD_LIMIT_MS: number;
export const SENTENCE: string;
export const SENTENCE_PIECES: string[];
export const SIZES: Record<
  Size,
  {
    width: number;
    heads: number;
    ffn: number;
    encoderLayers: number;
    decoderLayers: number;
    sourceVocab: number;
    targetVocab: number;
    positions: number;
  }
>;

export interface Variable {
  name: string;
  dims: number[];
  type: 'float32' | 'int8' | 'int16';
  fill: 'scalar' | 'random' | 'zeros' | 'ones' | 'scale';
  value?: number;
}
export function modelLayout(size: Size): { variables: Variable[]; aliases: [string, string][] };
export function makeModel(dir: string, size: Size): void;
export function hashModel(size: Size): Record<string, string>;
export function checkModel(dir: string, size: Size): string[];

export interface Ct2Log {
  cpu: string | null;
  isa: string | null;
  gemm8: string | null;
}
export function readCt2Log(text: string): Ct2Log;
export interface System {
  arch: string;
  brand: string;
  avx: boolean;
  avx2: boolean;
  fma: boolean;
  avx512f: boolean;
  dotprod: boolean;
}
export function readSystem(arch: string, values: Record<string, string>): System;
export interface Symbols {
  avx2: boolean;
  avx512: boolean;
  neon: boolean;
}
export function readSymbols(program: string): Symbols;
export interface SampleCounts {
  avx512: number;
  avx2: number;
  avx: number;
  neon: number;
  standard: number;
}
export function readSample(text: string): SampleCounts;

export interface Run {
  beam: number;
  ms: number[];
  helperMs?: number[];
  tokens: number[];
}
export interface Timing {
  ok: boolean;
  problems: string[];
  loadMs?: number | null;
  runs: Run[];
  ct2?: Ct2Log;
  sample?: SampleCounts | null;
  sampleError?: string | null;
}
export function timeModel(
  program: string,
  dir: string,
  size: Size,
  plan: { beam: number; count: number; warm?: number; sample?: boolean }[],
  options?: { sampleFile?: string | null },
): Promise<Timing>;

export interface Verdict {
  green: boolean;
  problems: string[];
  lines: string[];
}
export function judge(input: {
  system: System;
  symbols: Symbols;
  ct2: Ct2Log;
  sample: SampleCounts | null;
  sampleError: string | null;
  tiny: Timing;
  full: Timing;
}): Verdict;
export function proof(
  program: string,
  work: string,
  options?: { runsTiny?: number; runsFull?: number },
): Promise<Verdict>;
