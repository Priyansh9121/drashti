import type { PreparedSourcePage } from '../../shared/editable-source';

export interface PptxReadStart {
  type: 'read';
  jobId: string;
  file: string;
  outDir: string;
  sourcePages: number[];
  /** The pages whose clicks and transition to read too (SourceRead's `timingPages`). */
  timingPages?: number[];
}
export type ToPptxReader = PptxReadStart | { type: 'cancel'; jobId: string };
export type PptxPage = Omit<PreparedSourcePage, 'assets'> & {
  assets: { token: string; relative: string; kind: 'image' | 'video' | 'audio' }[];
};
export type FromPptxReader =
  | { type: 'prepared'; jobId: string; pages: PptxPage[]; total: number; failed: number[] }
  | { type: 'failed'; jobId: string };

export interface PptxReaderChild {
  post(message: ToPptxReader): void;
  onMessage(listener: (message: unknown) => void): void;
  onExit(listener: (code: number) => void): void;
  kill(): void;
}
