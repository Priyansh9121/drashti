import { afterAll, describe, expect, it } from 'vitest';
import { readPptxDeck } from '../pictures';
import { powerPointPlan } from '../deck/plan';
import { placeholderDeckMedia } from './make-deck';
import { jpegSize, kindOf, placeholderDeck, placeholderPdf } from './timing-placeholders';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/*
 * The timing check's placeholders (Session 56): decks a third of whose slides have animations (one in six with a
 * transition too) and half never move, and PDFs of pictures and placeholder words.
 */

const dir = mkdtempSync(join(tmpdir(), 'drashti-timing-placeholders-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A small JPEG's bytes as FFmpeg writes one: SOI, a JFIF APP0, then SOF0 with its size. */
const tinyJpeg = (width: number, height: number) =>
  Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
    0xff,
    0xd9,
  ]);

describe('the timing check’s placeholders', () => {
  it('make decks a third of whose slides have animations, one in six a transition, as the deck is read', async () => {
    const file = join(dir, 'Placeholder deck 30.pptx');
    writeFileSync(file, placeholderDeck(30, placeholderDeckMedia()));
    const deck = await readPptxDeck(file);
    expect(deck.slides).toHaveLength(30);
    expect(deck.slides.filter((s) => s.animated)).toHaveLength(10);
    expect(deck.slides.filter((s) => s.deck?.transition?.name)).toHaveLength(5);
    expect(deck.slides.map((_, i) => kindOf(i)).filter((k) => k === 'plain')).toHaveLength(20);
    // Every slide shown, with its notes; the plan has a step per click.
    const plan = powerPointPlan(deck.slides);
    expect(plan.slides).toHaveLength(30);
    expect(plan.slides.slice(0, 6).map((s) => s.steps.length)).toEqual([4, 1, 1, 3, 1, 1]);
    expect(deck.slides.every((s) => s.notes.startsWith('Placeholder notes'))).toBe(true);
  });

  it('make PDFs of as many pages as asked, each its own picture', () => {
    expect(jpegSize(tinyJpeg(1280, 720))).toEqual({ width: 1280, height: 720 });
    const pdf = placeholderPdf(12, [tinyJpeg(1280, 720), tinyJpeg(640, 360)]).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/Count 12');
    expect(pdf.match(/\/Subtype \/Image/gu)).toHaveLength(12);
    expect(pdf.match(/\/Width 640 \/Height 360/gu)).toHaveLength(6);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  });
});
