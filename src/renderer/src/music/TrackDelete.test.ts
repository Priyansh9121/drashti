import type { MouseEvent, ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { TrackDelete } from './TrackDelete';

/*
 * A track's trash in an audio playlist and a double click (QA23-ROWDEL-1, as a row's trash: ui/RowDelete.test.ts): the
 * trash is always shown, so a double click's first click takes the track out, the track under it moves up under the
 * pointer, and its trash takes the second click. Only the first click of a run counts; Enter and Space (a click with
 * no count) count, as the Delete key does. The button is not drawn here (unit tests run without a page): its click
 * handler is called as the button would call it. Placeholder names only.
 */

type Press = (e: MouseEvent<HTMLButtonElement>) => void;

/** A click with this count (`detail`: 1, then 2 for a double click's second; 0 for Enter or Space). */
const click = (detail: number) => ({ detail }) as unknown as MouseEvent<HTMLButtonElement>;

/** An audio playlist's tracks and their trash buttons: a track's trash takes that track out. */
function tracksOf(names: string[]) {
  const tracks = [...names];
  const trash = (name: string) =>
    (
      TrackDelete({
        name,
        onTakeOut: () => {
          const at = tracks.indexOf(name);
          if (at >= 0) tracks.splice(at, 1);
        },
      }) as ReactElement<{ onClick: Press }>
    ).props.onClick;
  return { tracks, trash };
}

const ONE = 'Placeholder tone one.wav';
const TWO = 'Placeholder tone two.wav';
const THREE = 'Placeholder tone three.wav';

describe('a track’s trash and a double click', () => {
  it('one click on a track’s trash takes that track out', () => {
    const { tracks, trash } = tracksOf([ONE, TWO, THREE]);
    trash(ONE)(click(1));
    expect(tracks).toEqual([TWO, THREE]);
  });

  it('a double click’s second click takes out nothing: the track that moved up under the pointer stays', () => {
    const { tracks, trash } = tracksOf([ONE, TWO, THREE]);
    // The first click takes the first track out; the second moves up into its place, its trash under the pointer.
    trash(ONE)(click(1));
    trash(TWO)(click(2));
    trash(TWO)(click(3));
    expect(tracks).toEqual([TWO, THREE]);
  });

  it('Enter and Space on a track’s trash (a click with no count) take the track out, as the Delete key does', () => {
    const { tracks, trash } = tracksOf([ONE, TWO]);
    trash(TWO)(click(0));
    expect(tracks).toEqual([ONE]);
  });
});
