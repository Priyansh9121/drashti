import type { Lang } from './model';

export function pdfWordFont(_words: string): { family: string; lang: Lang } {
  return { family: 'Noto Sans', lang: 'en' };
}
