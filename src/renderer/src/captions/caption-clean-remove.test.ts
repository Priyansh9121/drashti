import type { MouseEvent, ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { CleanWordRemove } from './CaptionCleanDialog';

/*
 * Words Left Out…'s Remove and a double click (the review of QA24-ROWDEL-2, SHOULD-1; as Caption Words' Remove,
 * ui/TrashButton.test.ts): a word goes at once and is kept at once, with no Undo, so a double click's first click took
 * the word out, the next word moved up under the pointer, and the second click took it out too. Only the first click
 * of a run counts; Enter and Space (a click with no count) count. The button is not drawn here (unit tests run without
 * a page): the click handler of the button it draws is called as the button would call it. Invented words only.
 */

type Press = (e: MouseEvent<HTMLButtonElement>) => void;
type Drawn = ReactElement<{ onClick?: Press } & Record<string, unknown>>;

/** A click with this count (`detail`: 1, then 2 for a double click's second; 0 for Enter or Space). */
const click = (detail: number) => ({ detail }) as unknown as MouseEvent<HTMLButtonElement>;

/** The click handler of the button a component draws, through the components it is made of. */
function pressOf(drawn: Drawn): Press {
  let at = drawn;
  for (let depth = 0; depth < 5; depth += 1) {
    if (at.props.onClick) return at.props.onClick;
    if (typeof at.type !== 'function') break;
    at = (at.type as (props: unknown) => Drawn)(at.props);
  }
  throw new Error('no click handler drawn');
}

/** The admin's words, and each one's Remove (named as the list names it, hidden: "Hidden word 1"). */
function wordsOf(words: string[]) {
  const kept = [...words];
  const remove = (word: string) =>
    pressOf(
      CleanWordRemove({
        shown: `Hidden word ${String(kept.indexOf(word) + 1)}`,
        onRemove: () => {
          const at = kept.indexOf(word);
          if (at >= 0) kept.splice(at, 1);
        },
      }) as Drawn,
    );
  return { kept, remove };
}

const ONE = 'Zorvek';
const TWO = 'Plindar';
const THREE = 'Quosmet';

describe('a word’s Remove in Words Left Out…, and a double click', () => {
  it('one click takes that word out', () => {
    const { kept, remove } = wordsOf([ONE, TWO, THREE]);
    remove(ONE)(click(1));
    expect(kept).toEqual([TWO, THREE]);
  });

  it('a double click’s second click takes out nothing: the word that moved up under the pointer stays', () => {
    const { kept, remove } = wordsOf([ONE, TWO, THREE]);
    // The first click takes the first word out; the second moves up into its place, its Remove under the pointer.
    remove(ONE)(click(1));
    remove(TWO)(click(2));
    remove(TWO)(click(3));
    expect(kept).toEqual([TWO, THREE]);
  });

  it('Enter and Space on a Remove (a click with no count) take the word out', () => {
    const { kept, remove } = wordsOf([ONE, TWO]);
    remove(TWO)(click(0));
    expect(kept).toEqual([ONE]);
  });
});
