import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { contrastRatio } from './contrast';
import { standardAsBoxes } from './stage-layouts';
import {
  readableOn,
  STAGE_BOX_COLOR,
  STAGE_COLOR_PRESETS,
  STAGE_FLASH_MS,
  STAGE_MESSAGE_SIZES,
  STAGE_TEXT_COLOR,
  type StageCall,
  stageBanner,
  stageCallSchema,
  stageColorSchema,
  stageColorsRead,
  stageFlashColor,
  stageFlashOn,
  stageMessageLook,
  withRecent,
} from './stage-message';

/*
 * The stage message (Session 55, Part 15): the last few a tap away, each once and the newest first; its slow flash as
 * it comes up, in step on every stage screen; and a banner over every stage screen whose layout has no message box.
 */

describe('the stage message', () => {
  it('keeps the last five, each once, the newest first', () => {
    expect(withRecent(undefined, 'A')).toEqual(['A']);
    expect(withRecent(['A', 'B'], 'B')).toEqual(['B', 'A']);
    expect(withRecent(['1', '2', '3', '4', '5'], '6')).toEqual(['6', '1', '2', '3', '4']);
  });

  it('flashes for six seconds from the first whole second it was up, once a second, only when asked', () => {
    const shownAt = 10_250;
    const call = { size: 'standard' as const, flash: true, shownAt };
    expect(stageFlashOn({ ...call, flash: false }, 11_500)).toBe(false);
    expect(stageFlashOn(null, 11_500)).toBe(false);
    const on: boolean[] = [];
    for (let at = 11_000; at < 11_000 + STAGE_FLASH_MS + 2000; at += 1000)
      on.push(stageFlashOn(call, at + 500));
    expect(on).toEqual([true, false, true, false, true, false, false, false]);
  });

  it('shows as a banner over a stage screen whose layout has no message box', () => {
    expect(stageBanner(null)).toBe(true);
    expect(stageBanner({ boxes: [] })).toBe(true);
    let n = 0;
    expect(stageBanner({ boxes: standardAsBoxes(() => `b${String(n++)}`) })).toBe(false);
    expect(stageCallSchema.safeParse({ size: 'huge', flash: true }).success).toBe(true);
    expect(stageCallSchema.safeParse({ size: 'enormous' }).success).toBe(false);
  });

  // Its colours (the owner, 24 Nov 2026).
  const steady = { size: 'standard' as const, flash: false, shownAt: 10_000 };
  const flashing = { ...steady, flash: true, shownAt: 10_250 };
  /** A moment the flash is in its other colour, and one it is not (the engine's clock's odd and even seconds). */
  const [flashOn, flashOff] = [11_500, 12_500];

  it('draws a message with no colours as it always was: amber, black words (a layout box’s own), white while it flashes', () => {
    expect(stageFlashOn(flashing, flashOn)).toBe(true);
    expect(stageFlashOn(flashing, flashOff)).toBe(false);
    expect(stageMessageLook(null, flashOn)).toEqual({ background: '#f5a524', color: '#000000' });
    expect(stageMessageLook(steady, flashOn)).toEqual({ background: '#f5a524', color: '#000000' });
    expect(stageMessageLook(flashing, flashOn)).toEqual({ background: '#ffffff', color: '#000000' });
    expect(stageMessageLook(flashing, flashOff)).toEqual({ background: '#f5a524', color: '#000000' });
    // A layout's message box draws its own words' colour, flashing too.
    expect(stageMessageLook(steady, flashOn, '#ffffff')).toEqual({ background: '#f5a524', color: '#ffffff' });
    expect(stageMessageLook(flashing, flashOn, '#fde68a')).toEqual({
      background: '#ffffff',
      color: '#fde68a',
    });
  });

  it('draws the colours chosen, over a layout box’s own words’ colour, and flashes with white, amber for a white box', () => {
    const blue = { ...flashing, boxColor: '#1d4ed8', textColor: '#ffffff' };
    expect(stageMessageLook(blue, flashOff, '#000000')).toEqual({ background: '#1d4ed8', color: '#ffffff' });
    // White words on the white flash would vanish: black then, which reads on it.
    expect(stageMessageLook(blue, flashOn)).toEqual({ background: '#ffffff', color: '#000000' });
    const white = { ...flashing, boxColor: '#ffffff', textColor: '#ffff00' };
    expect(stageMessageLook(white, flashOff)).toEqual({ background: '#ffffff', color: '#ffff00' });
    expect(stageMessageLook(white, flashOn)).toEqual({ background: STAGE_BOX_COLOR, color: '#000000' });
    // Words that read on the flash colour keep their colour.
    const red = { ...flashing, boxColor: '#b91c1c', textColor: '#000000' };
    expect(stageMessageLook(red, flashOn)).toEqual({ background: '#ffffff', color: '#000000' });
    // In both colours of the flash, the words of every preset read (4.5 to 1 or more).
    for (const p of STAGE_COLOR_PRESETS)
      for (const at of [flashOn, flashOff]) {
        const look = stageMessageLook({ ...flashing, boxColor: p.box, textColor: p.text }, at);
        expect(
          contrastRatio(look.background, look.color),
          `${p.name} at ${String(at)}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
  });

  it('offers presets that read well, the first as it always was, and says which pairs do not', () => {
    expect(STAGE_COLOR_PRESETS[0]).toMatchObject({ box: STAGE_BOX_COLOR, text: STAGE_TEXT_COLOR });
    for (const p of STAGE_COLOR_PRESETS) expect(stageColorsRead(p.box, p.text), p.name).toBe(true);
    expect(new Set(STAGE_COLOR_PRESETS.map((p) => p.id)).size).toBe(STAGE_COLOR_PRESETS.length);
    expect(stageColorsRead('#ffffff', '#ffff00')).toBe(false);
    expect(stageColorsRead('#777777', '#888888')).toBe(false);
    expect(readableOn('#ffff00', '#ffffff')).toBe('#000000');
    expect(readableOn('#ffff00', '#000000')).toBe('#ffff00');
    expect(readableOn('#000000', '#1d4ed8')).toBe('#ffffff');
    expect(stageFlashColor('#ffffff')).toBe(STAGE_BOX_COLOR);
    expect(stageFlashColor('#fafafa')).toBe(STAGE_BOX_COLOR);
    expect(stageFlashColor('#1d4ed8')).toBe('#ffffff');
    expect(stageColorSchema.safeParse('#1D4ED8').success).toBe(true);
    for (const bad of ['amber', '#fff', '#1d4ed8ff', 'rgb(0,0,0)', ''])
      expect(stageColorSchema.safeParse(bad).success, bad).toBe(false);
  });

  it('a reader of the version before reads a call with colours whole, its colours left out: amber and black', () => {
    // The call as engine 31 read it (src/main/recovery/live-state.ts's schema then): its size, flash and time only.
    const before = z.object({ size: z.enum(STAGE_MESSAGE_SIZES), flash: z.boolean(), shownAt: z.number() });
    const call: StageCall = { ...flashing, boxColor: '#1d4ed8', textColor: '#ffffff' };
    const read = before.safeParse(JSON.parse(JSON.stringify(call)));
    expect(read.success).toBe(true);
    expect(read.data).toEqual({ size: 'standard', flash: true, shownAt: 10_250 });
    // What it draws: its own amber and black, as this version draws a call with none.
    expect(stageMessageLook(read.data, flashOff)).toEqual({ background: '#f5a524', color: '#000000' });
  });
});
