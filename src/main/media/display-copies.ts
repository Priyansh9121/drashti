import type { PictureLook, PixelSize } from '../../shared/picture-look';
import type { SharpenJobView } from '../../shared/pictures';

export interface DisplayCandidate { path: string; sha256: string; look?: PictureLook | null; }
export interface DisplayFile { key: string; width: number; height: number; path: string; hash: string; bytes: number; ext: 'jpg' | 'png'; }
export type DisplayResult = { ok: true; copy: DisplayFile | null } | { ok: false; message: string };
export interface DisplayDeps {
  mediaDir: string;
  targets(): readonly PixelSize[];
  open(gone: () => void): { id: number; destroy(): void };
  changed(): void;
  log(message: string): void;
  canWork?(): boolean;
  freeBytes?(): number;
}
export class DisplayCopies {
  constructor(_deps: DisplayDeps) {}
  async prepare(_candidate: DisplayCandidate, _signal?: AbortSignal): Promise<DisplayResult> { return {ok:true,copy:null}; }
  async next(_sender: number): Promise<SharpenJobView | null> { return null; }
  async made(_sender: number, _key: unknown, _bytes: unknown): Promise<boolean> { return false; }
  ready(_sha: string, _look?: PictureLook | null): DisplayFile | null { return null; }
  relativePath(_sha: string, _key: string): string | null { return null; }
  fileOf(_sha: string, _key: string): DisplayFile | null { return null; }
  async refresh(_candidates: readonly DisplayCandidate[]): Promise<void> {}
  async idle(): Promise<void> {}
  close(): void {}
}
