import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { droppedPdf } from './dropped-pdf';

/*
 * flow:choose with a dropped file (alpha.24, QA24-FLOWDROP-1): Main takes only a full path on this computer to a file
 * named as a PDF; anything else the window might send is refused before the store reads a thing. Placeholder names.
 */

describe('a dropped PDF, as Main is handed it', () => {
  it('a full path to a PDF: taken as given, in any case', () => {
    const file = join(tmpdir(), 'Placeholder order.pdf');
    expect(droppedPdf(file)).toBe(file);
    const upper = join(tmpdir(), 'PLACEHOLDER ORDER.PDF');
    expect(droppedPdf(upper)).toBe(upper);
  });

  it('not a PDF, a name alone, a path with a NUL in it or one longer than any system has: refused', () => {
    expect(droppedPdf(join(tmpdir(), 'Placeholder notes.txt'))).toBeNull();
    expect(droppedPdf(join(tmpdir(), 'Placeholder order.pdf.txt'))).toBeNull();
    expect(droppedPdf('Placeholder order.pdf')).toBeNull();
    expect(droppedPdf(join('placeholder', 'Placeholder order.pdf'))).toBeNull();
    expect(droppedPdf(`${join(tmpdir(), 'Placeholder')}\0.pdf`)).toBeNull();
    expect(droppedPdf(join(tmpdir(), `${'a'.repeat(40_000)}.pdf`))).toBeNull();
    expect(droppedPdf('')).toBeNull();
  });

  it('anything but words: refused', () => {
    for (const raw of [undefined, null, 1, true, {}, [join(tmpdir(), 'Placeholder order.pdf')]])
      expect(droppedPdf(raw)).toBeNull();
  });
});
