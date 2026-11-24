import { describe, expect, it } from 'vitest';
import { MIN_FIT } from '../../../shared/readable';
import { fitTogether } from './shrink-to-fit';
import {
  atMessageFit,
  MESSAGE_ALIGN,
  MESSAGE_FIT,
  MESSAGE_JUSTIFY,
  type MessagePlace,
  messageAlign,
  messageFitBox,
  messageJustify,
  runsPast,
  wordsPast,
} from './stage-message-fit';

/*
 * A stage message fitted to its place (the owner, 24 Nov 2026). The unit tests run with no window to lay out: a
 * stand-in place keeps what is set on it, and its words run past it above a given fit (as a message of many lines
 * does). tests/e2e/stage-message-fit.spec.ts measures the real stage screens.
 */

/** A stand-in place: its custom properties and attributes, as set. */
function place(): MessagePlace & { props: Map<string, string>; attrs: Map<string, string> } {
  const props = new Map<string, string>();
  const attrs = new Map<string, string>();
  return {
    props,
    attrs,
    style: {
      setProperty: (name, value) => {
        props.set(name, value);
      },
      removeProperty: (name) => {
        const was = props.get(name) ?? '';
        props.delete(name);
        return was;
      },
    },
    setAttribute: (name, value) => {
      attrs.set(name, value);
    },
    removeAttribute: (name) => {
      attrs.delete(name);
    },
  };
}

/** The fit the place's words are drawn at now (unset: 1, its chosen size). */
const drawnAt = (p: ReturnType<typeof place>) => Number(p.props.get(MESSAGE_FIT) ?? '1');

describe('a stage message fitted to its place', () => {
  it('keeps a message that fits exactly as it was: its chosen size, nothing set, nothing centred', () => {
    const p = place();
    const box = messageFitBox(p, () => false);
    fitTogether([box]);
    expect(p.props.size).toBe(0);
    expect(p.attrs.size).toBe(0);
  });

  it('draws one that runs past its place as large as still fits, never above its chosen size, and centres it', () => {
    for (const largest of [0.97, 0.62, 0.31, 0.12]) {
      const p = place();
      // Its words run past the place drawn larger than `largest` of their chosen size.
      fitTogether([messageFitBox(p, () => drawnAt(p) > largest)]);
      const fit = drawnAt(p);
      expect(fit).toBeLessThanOrEqual(largest);
      // The largest that fits, to within the search's step (0.9 / 4096 of the chosen size).
      expect(largest - fit).toBeLessThan(0.9 / 4096 + 1e-9);
      expect(p.attrs.get('data-message-fit')).toBe(fit.toFixed(3));
      expect(p.props.get(MESSAGE_ALIGN)).toBe('center');
      expect(p.props.get(MESSAGE_JUSTIFY)).toBe('safe center');
    }
  });

  it('goes no smaller than shrink-to-fit’s floor, a tenth of its chosen size', () => {
    const p = place();
    fitTogether([messageFitBox(p, () => true)]);
    expect(drawnAt(p)).toBeCloseTo(MIN_FIT, 6);
  });

  it('fitted again, a message that now fits is put back as it was', () => {
    const p = place();
    const words = { long: true };
    fitTogether([messageFitBox(p, () => words.long && drawnAt(p) > 0.5)]);
    expect(drawnAt(p)).toBeLessThan(1);
    words.long = false;
    fitTogether([messageFitBox(p, () => words.long && drawnAt(p) > 0.5)]);
    expect(p.props.size).toBe(0);
    expect(p.attrs.size).toBe(0);
  });

  it('writes its sizes, alignment and place up and down so that, unset, they are exactly as before', () => {
    expect(atMessageFit('64px')).toBe('calc(64px * var(--stage-message-fit, 1))');
    expect(atMessageFit('1.4em')).toBe('calc(1.4em * var(--stage-message-fit, 1))');
    expect(messageAlign('start')).toBe('var(--stage-message-align, start)');
    expect(messageJustify('flex-end')).toBe('var(--stage-message-justify, flex-end)');
  });

  it('measures a place that grows with its words by its scroll size, and a set place by its words’ block', () => {
    const fits = { scrollHeight: 300, clientHeight: 300, scrollWidth: 800, clientWidth: 800 };
    expect(runsPast(fits)).toBe(false);
    expect(runsPast({ ...fits, scrollHeight: 302 })).toBe(true);
    expect(runsPast({ ...fits, scrollWidth: 801 })).toBe(true);
    expect(wordsPast({ clientHeight: 245, clientWidth: 600 }, { offsetHeight: 245, scrollWidth: 600 })).toBe(
      false,
    );
    expect(wordsPast({ clientHeight: 245, clientWidth: 600 }, { offsetHeight: 520, scrollWidth: 600 })).toBe(
      true,
    );
  });
});
