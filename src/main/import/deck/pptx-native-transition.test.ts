import { describe, expect, it } from 'vitest';
import { parseXml } from '../xml';
import { nativePptxTransition } from './pptx-native-transition';

/*
 * Which of a deck's PowerPoint transitions Drashti draws as PowerPoint does (exact), and which only come close
 * (approximate: a slide using one keeps PowerPoint's own video wherever one can be made). Measured against PowerPoint's
 * own movie of a generated deck, frame by frame (13 Nov 2026).
 */

const read = (xml: string, durationMs = 700) => nativePptxTransition(parseXml(xml), durationMs);
const DIRECTIONS = [
  ['l', 'left'],
  ['r', 'right'],
  ['u', 'up'],
  ['d', 'down'],
] as const;

describe('a deck’s PowerPoint transition, drawn by Drashti', () => {
  it('Wipe, Cover and Uncover only come close to PowerPoint’s, in every direction: approximate, the effect kept', () => {
    for (const [dir, direction] of DIRECTIONS) {
      expect(read(`<p:wipe dir="${dir}"/>`), `wipe ${dir}`).toEqual({
        transition: { kind: 'wipe', deckEffect: 'wipe', durationMs: 700, direction },
        approximate: true,
      });
      expect(read(`<p:cover dir="${dir}"/>`), `cover ${dir}`).toEqual({
        transition: { kind: 'slide', deckEffect: 'cover', durationMs: 700, direction },
        approximate: true,
      });
      expect(read(`<p:pull dir="${dir}"/>`), `uncover ${dir}`).toEqual({
        transition: { kind: 'slide', deckEffect: 'uncover', durationMs: 700, direction },
        approximate: true,
      });
    }
    // No direction written: PowerPoint's own, from the left.
    expect(read('<p:wipe/>')).toMatchObject({ transition: { direction: 'left' }, approximate: true });
  });

  it('Push, Fade, Fade Through Black and Zoom are drawn as PowerPoint draws them: exact', () => {
    for (const [dir, direction] of DIRECTIONS)
      expect(read(`<p:push dir="${dir}"/>`), `push ${dir}`).toEqual({
        transition: { kind: 'slide', deckEffect: 'push', durationMs: 700, direction },
        approximate: false,
      });
    expect(read('<p:fade/>')).toEqual({
      transition: { kind: 'dissolve', deckEffect: 'dissolve', durationMs: 700 },
      approximate: false,
    });
    expect(read('<p:fade thruBlk="1"/>')).toEqual({
      transition: { kind: 'fade-black', deckEffect: 'fade-black', durationMs: 700 },
      approximate: false,
    });
    expect(read('<p:zoom/>')).toEqual({
      transition: { kind: 'zoom-dissolve', deckEffect: 'zoom', durationMs: 700 },
      approximate: false,
    });
  });

  it('anything else, or a direction Drashti cannot draw, is the closest it can: a dissolve; a cut is none', () => {
    const dissolve = {
      transition: { kind: 'dissolve', deckEffect: 'dissolve', durationMs: 700 },
      approximate: true,
    };
    expect(read('<p:checker dir="horz"/>')).toEqual(dissolve);
    expect(read('<p:cover dir="lu"/>')).toEqual(dissolve);
    expect(read('<p:zoom dir="out"/>')).toEqual(dissolve);
    expect(read('<p:cut/>')).toBeUndefined();
    expect(read('<p:wipe dir="u"/>', 0)).toBeUndefined();
  });
});
