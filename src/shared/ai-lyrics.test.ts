import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyLyricSuggestions, suggestLyrics, type LyricProposal } from './ai-lyrics';
const f = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../docs/examples/placeholder-ai.json'), 'utf8'),
) as { lyrics: { gu: string; hi: string; en: string; romanFirstGu: string; romanFirstHi: string } };
function proposal(text: string, action: 'breaks' | 'transliteration'): LyricProposal {
  const result = suggestLyrics({ source: 'pasted-lyrics', text, action });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.value;
}
describe('reviewable lyric suggestions', () => {
  it('only proposes a break; approval inserts it without changing any word', () => {
    const p = proposal(f.lyrics.gu, 'breaks');
    expect(p.language).toBe('gu');
    expect(p.sourceText).toBe(f.lyrics.gu);
    expect(p.changes).toHaveLength(1);
    expect(applyLyricSuggestions(f.lyrics.gu, p, [])).toEqual({ ok: true, value: f.lyrics.gu });
    const lines = f.lyrics.gu.split('\n');
    expect(
      applyLyricSuggestions(
        f.lyrics.gu,
        p,
        p.changes.map((x) => x.id),
      ),
    ).toEqual({ ok: true, value: lines.slice(0, 2).join('\n') + '\n\n' + lines.slice(2).join('\n') });
  });
  it('keeps CRLF bytes and existing paragraph boundaries', () => {
    const text = f.lyrics.en.replaceAll('\n', '\r\n');
    const p = proposal(text, 'breaks');
    expect(
      applyLyricSuggestions(
        text,
        p,
        p.changes.map((x) => x.id),
      ),
    ).toEqual({ ok: true, value: text.replace('two\r\n', 'two\r\n\r\n') });
    expect(proposal(text.replace('two\r\n', 'two\r\n\r\n'), 'breaks').changes).toHaveLength(0);
  });
  it.each([
    ['gu', 'romanFirstGu'],
    ['hi', 'romanFirstHi'],
  ] as const)('proposes %s Roman letters only after approval, retaining the original line', (lang, roman) => {
    const text = f.lyrics[lang];
    const p = proposal(text, 'transliteration');
    const first = p.changes[0];
    if (!first) throw new Error('Missing placeholder transliteration');
    expect(p.language).toBe(lang);
    expect(first.preview).toBe(f.lyrics[roman]);
    const lines = text.split('\n');
    expect(applyLyricSuggestions(text, p, [first.id])).toEqual({
      ok: true,
      value: [lines[0], f.lyrics[roman], ...lines.slice(1)].join('\n'),
    });
  });
  it('does not add another copy of an existing transliteration', () => {
    const first = f.lyrics.gu.split('\n')[0] ?? '';
    expect(proposal(first + '\n' + f.lyrics.romanFirstGu, 'transliteration').changes).toHaveLength(0);
    expect(proposal(f.lyrics.en, 'transliteration').changes).toHaveLength(0);
  });
  it('refuses Books and translation requests without producing any words', () => {
    expect(suggestLyrics({ source: 'books', text: f.lyrics.gu, action: 'transliteration' }).ok).toBe(false);
    expect(suggestLyrics({ source: 'pasted-lyrics', text: f.lyrics.gu, action: 'translate' }).ok).toBe(false);
  });
  it('refuses stale inputs, unknown approvals, repeated approvals and forged insertion text atomically', () => {
    const p = proposal(f.lyrics.gu, 'breaks');
    const first = p.changes[0];
    if (!first) throw new Error('Missing split');
    expect(applyLyricSuggestions(f.lyrics.gu + ' ', p, [first.id]).ok).toBe(false);
    expect(applyLyricSuggestions(f.lyrics.gu, p, ['unknown']).ok).toBe(false);
    expect(applyLyricSuggestions(f.lyrics.gu, p, [first.id, first.id]).ok).toBe(false);
    expect(
      applyLyricSuggestions(f.lyrics.gu, { ...p, changes: [{ ...first, insert: f.lyrics.en }] }, [first.id])
        .ok,
    ).toBe(false);
  });
});
