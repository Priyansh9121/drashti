import type { Block } from '../shared/markdown';

/*
 * The Drashti Manual on paper (x37, Session 60): the red commit's stand-in, which makes nothing yet.
 */

export interface PrintChapter {
  title: string;
  blocks: readonly Block[];
}

export const escapeHtml = (text: string): string => text;

export function manualHtml(p: {
  chapters: readonly PrintChapter[];
  version: string;
  picture: (src: string) => string | null;
}): string {
  return p.version === '' ? '' : '';
}

export function printRequestAllowed(url: string, allowed: ReadonlySet<string>): boolean {
  return url !== '' || allowed.size > 0;
}

export const fileAddress = (path: string): string => path;

export type PrintOutcome = { ok: true; pdf: Buffer | null } | { ok: false; cancelled: boolean; why: string };

export function printManual(p: {
  html: string;
  pictures: readonly string[];
  tempDir: string;
  kind: 'pdf' | 'print';
}): Promise<PrintOutcome> {
  return Promise.resolve({ ok: false, cancelled: false, why: p.kind });
}
