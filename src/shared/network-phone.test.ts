import { describe, expect, it } from 'vitest';
import { PHONE_ARGS } from './network-phone';

describe('phone rename names', () => {
  it('cleans control and direction characters before passing on a media name', () => {
    const name = ' \u0001 Placeholder\r\ntrack\u2029name\u009F\u061C\u200E\u202E\u2066 ';
    expect(PHONE_ARGS.mediaRename.parse({ mediaId: 'm-1', name }).name).toBe('Placeholder track name');
  });

  it('validates the length of the cleaned name', () => {
    expect(PHONE_ARGS.mediaRename.safeParse({ mediaId: 'm-1', name: '\t\u202E\u2069' }).success).toBe(false);
    const maxName = 'x'.repeat(200);
    expect(PHONE_ARGS.mediaRename.parse({ mediaId: 'm-1', name: maxName + '\u202E' }).name).toBe(maxName);
    expect(PHONE_ARGS.mediaRename.safeParse({ mediaId: 'm-1', name: maxName + 'x' }).success).toBe(false);
  });

  it('preserves letters, marks and joiners in a presentation name', () => {
    const name = 'ક્\u200Dષ क्\u200Cष';
    expect(PHONE_ARGS.presentationRename.parse({ presentationId: 'p-1', name }).name).toBe(name);
  });
});
