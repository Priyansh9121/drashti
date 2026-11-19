export interface PinnedSource {
  repo: string;
  commit: string;
  licence: string;
  sources: string[];
  files: Record<string, string>;
}
export const SYPHON: PinnedSource;
export const SPOUT: PinnedSource;
export const OWN_SOURCES: { darwin: string[]; win32: string[] };
export const PROGRAMS: {
  darwin: { sender: string; receiver: string };
  win32: { sender: string; receiver: string };
};
export function fetchVideoOut(target: string): Promise<string>;
export function vcvars(): string;
