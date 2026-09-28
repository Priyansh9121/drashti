import { describe, expect, it } from 'vitest';
import { decodeText } from './decode';

const utf16le = (text: string) => Buffer.from(text, 'utf16le');
const utf16be = (text: string) => {
  const le = Buffer.from(text, 'utf16le');
  for (let i = 0; i + 1 < le.length; i += 2) [le[i], le[i + 1]] = [le[i + 1] ?? 0, le[i] ?? 0];
  return le;
};

describe('decodeText', () => {
  it('reads UTF-8, with or without a byte-order mark', () => {
    const text = 'Placeholder line\nનમૂનાની પંક્તિ';
    expect(decodeText(Buffer.from(text))).toEqual({ text, encoding: 'utf-8', issues: [] });
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]);
    expect(decodeText(bom).text).toBe(text);
  });

  it('reads UTF-16 by its byte-order mark, and without one by its zero bytes', () => {
    const text = 'Placeholder verse\nनमूने की पंक्ति';
    expect(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), utf16le(text)]))).toMatchObject({
      text,
      encoding: 'utf-16le',
    });
    expect(decodeText(Buffer.concat([Buffer.from([0xfe, 0xff]), utf16be(text)]))).toMatchObject({
      text,
      encoding: 'utf-16be',
    });
    expect(decodeText(utf16le('Placeholder chorus line'))).toMatchObject({ encoding: 'utf-16le' });
    expect(decodeText(utf16be('Placeholder chorus line'))).toMatchObject({ encoding: 'utf-16be' });
  });

  it('falls back to Windows-1252 for bytes that are not UTF-8, and says so', () => {
    const bytes = Buffer.from([0x93, 0x50, 0x6c, 0x61, 0x63, 0x65, 0x94, 0x20, 0x63, 0x61, 0x66, 0xe9]);
    const decoded = decodeText(bytes);
    expect(decoded.text).toBe('“Place” café');
    expect(decoded.encoding).toBe('windows-1252');
    expect(decoded.issues.map((i) => i.code)).toEqual(['not-utf8']);
  });

  it('handles empty input', () => {
    expect(decodeText(new Uint8Array())).toEqual({ text: '', encoding: 'utf-8', issues: [] });
  });
});
