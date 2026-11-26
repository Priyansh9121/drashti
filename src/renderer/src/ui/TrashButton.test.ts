import type { MouseEvent, ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { TrashButton } from './TrashButton';

/*
 * A trash that is always shown and a double click (QA24-ROWDEL-2: an audio playlist's Delete in the Music panel, a
 * lower third's in its panel, a caption word's Remove; as a row's trash, RowDelete.test.ts, and a track's,
 * music/TrackDelete.test.ts): a double click's first click takes the row out, the row under it moves up under the
 * pointer, and its trash takes the second click. Only the first click of a run counts; Enter and Space (a click with
 * no count) count, as the Delete key does. The button is not drawn here (unit tests run without a page): its click
 * handler is called as the button would call it. Placeholder names only.
 */

type Press = (e: MouseEvent<HTMLButtonElement>) => void;

/** A click with this count (`detail`: 1, then 2 for a double click's second; 0 for Enter or Space). */
const click = (detail: number) => ({ detail }) as unknown as MouseEvent<HTMLButtonElement>;

/** A list's rows and their trash buttons: a row's trash takes that row out. */
function rowsOf(names: string[]) {
  const rows = [...names];
  const button = (name: string) =>
    TrashButton({
      label: `Delete “${name}”`,
      testId: 'placeholder-delete',
      onPress: () => {
        const at = rows.indexOf(name);
        if (at >= 0) rows.splice(at, 1);
      },
    }) as ReactElement<{ onClick: Press; label: string; 'data-testid'?: string }>;
  const trash = (name: string) => button(name).props.onClick;
  return { rows, button, trash };
}

const ONE = 'Placeholder one';
const TWO = 'Placeholder two';
const THREE = 'Placeholder three';

describe('a trash that is always shown, and a double click', () => {
  it('one click on a row’s trash takes that row out', () => {
    const { rows, trash } = rowsOf([ONE, TWO, THREE]);
    trash(ONE)(click(1));
    expect(rows).toEqual([TWO, THREE]);
  });

  it('a double click’s second click takes out nothing: the row that moved up under the pointer stays', () => {
    const { rows, trash } = rowsOf([ONE, TWO, THREE]);
    // The first click takes the first row out; the second moves up into its place, its trash under the pointer.
    trash(ONE)(click(1));
    trash(TWO)(click(2));
    trash(TWO)(click(3));
    expect(rows).toEqual([TWO, THREE]);
  });

  it('Enter and Space on a trash (a click with no count) take the row out, as the Delete key does', () => {
    const { rows, trash } = rowsOf([ONE, TWO]);
    trash(TWO)(click(0));
    expect(rows).toEqual([ONE]);
  });

  it('says what it takes out, and keeps the test id it is given', () => {
    const { button } = rowsOf([ONE]);
    expect(button(ONE).props.label).toBe(`Delete “${ONE}”`);
    expect(button(ONE).props['data-testid']).toBe('placeholder-delete');
  });
});
