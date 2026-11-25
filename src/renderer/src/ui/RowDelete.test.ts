import type { MouseEvent, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Pencil } from './icons';
import { RowAction, RowDelete, RowRename } from './RowDelete';

/*
 * A row's own buttons, its trash and its rename (Session 26a), and a double click (QA23-ROWDEL-1, alpha.22's fifth
 * gate): a double click's first click takes the row out, the row under it moves up under the pointer, and its trash,
 * shown as the pointer is over its row, takes the second click. Only the first click of a run counts: a second (and
 * a third) does nothing, and never reaches the row under it either. Enter and Space (a click with no count) count, as
 * the Delete key does. The buttons are not drawn here (unit tests run without a page): their click handler is called
 * as the button would call it. Placeholder names only.
 */

type Press = (e: MouseEvent<HTMLButtonElement>) => void;

/** The click handler a row's button gets: RowDelete and RowRename are each a RowAction. */
function pressOf(element: ReactElement): Press {
  const action =
    element.type === RowAction ? RowAction(element.props as Parameters<typeof RowAction>[0]) : element;
  const button = (action as ReactElement<{ children: ReactElement<{ onClick: Press }> }>).props.children;
  return button.props.onClick;
}

/** A click with this count (`detail`: 1, then 2 for a double click's second; 0 for Enter or Space). */
function click(detail: number) {
  const stopPropagation = vi.fn();
  return { event: { detail, stopPropagation } as unknown as MouseEvent<HTMLButtonElement>, stopPropagation };
}

/** A playlist's rows and their trash buttons: the trash of a row takes that row out, as the Delete key does. */
function rowsOf(names: string[]) {
  const rows = [...names];
  const trash = (name: string) =>
    pressOf(
      RowDelete({
        label: `Remove “${name}” from the playlist`,
        chosen: false,
        onDelete: () => {
          const at = rows.indexOf(name);
          if (at >= 0) rows.splice(at, 1);
        },
      }),
    );
  return { rows, trash };
}

describe('a row’s trash and rename, and a double click', () => {
  it('one click on a row’s trash takes that row out, and the row’s own click does not run too', () => {
    const { rows, trash } = rowsOf(['Placeholder clip', 'Placeholder backdrop', 'Placeholder tone']);
    const one = click(1);
    trash('Placeholder backdrop')(one.event);
    expect(rows).toEqual(['Placeholder clip', 'Placeholder tone']);
    expect(one.stopPropagation).toHaveBeenCalledOnce();
  });

  it('a double click’s second click takes out nothing: the row that moved up under the pointer stays', () => {
    const { rows, trash } = rowsOf(['Placeholder clip', 'Placeholder backdrop', 'Placeholder tone']);
    // The first click takes the picture out; the sound's row moves up into its place, its trash under the pointer.
    trash('Placeholder backdrop')(click(1).event);
    const second = click(2);
    trash('Placeholder tone')(second.event);
    trash('Placeholder tone')(click(3).event);
    expect(rows).toEqual(['Placeholder clip', 'Placeholder tone']);
    // Nor does it reach the sound's row under the trash (its click would choose it, or put it up).
    expect(second.stopPropagation).toHaveBeenCalledOnce();
  });

  it('Enter and Space on a trash (a click with no count) take the row out, as the Delete key does', () => {
    const { rows, trash } = rowsOf(['Placeholder clip', 'Placeholder backdrop']);
    const key = click(0);
    trash('Placeholder clip')(key.event);
    expect(rows).toEqual(['Placeholder backdrop']);
    expect(key.stopPropagation).toHaveBeenCalledOnce();
  });

  it('rename and a row’s other buttons (a video input’s Change) count only the first click of a run too', () => {
    const onRename = vi.fn();
    const rename = pressOf(RowRename({ label: 'Rename playlist “Placeholder Sunday”', chosen: false, onRename }));
    const onChange = vi.fn();
    const change = pressOf(
      RowAction({
        icon: Pencil,
        label: 'Change “Placeholder input”',
        chosen: true,
        onPress: onChange,
        testId: 'video-input-change',
      }),
    );
    for (const press of [rename, change]) {
      press(click(1).event);
      press(click(2).event);
      press(click(0).event);
    }
    expect(onRename).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
