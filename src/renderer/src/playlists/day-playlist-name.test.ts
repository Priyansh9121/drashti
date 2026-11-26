import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaylistNode } from '../../../shared/playlists';
import { PlaylistPanel } from './PlaylistPanel';
import { usePlaylists } from './playlist-store';
import type * as PlaylistStore from './playlist-store';

// Read the store's current state in server rendering, where Zustand normally uses its initial snapshot.
vi.mock('./playlist-store', async (importOriginal) => {
  const actual = await importOriginal<typeof PlaylistStore>();
  return {
    ...actual,
    usePlaylists: Object.assign(
      (selector: (state: ReturnType<typeof actual.usePlaylists.getState>) => unknown) =>
        selector(actual.usePlaylists.getState()),
      actual.usePlaylists,
    ),
  };
});

/*
 * Simple Mode's day playlist ("Sabha, <date>", main/simple-playlist.ts) in the left column at 1024 × 645 (the owner's
 * answer to QA23-STAGE8-5, 25 Nov 2026, word for word: "End it in '…' (Recommended)"): its name may end in "…" there,
 * cut by CSS on one line, and is whole on hover (its title) and to a screen reader (the row's name begins with it).
 * The fit check (tests/e2e/operator-fit.spec.ts) lets that one element end so, found by its own test id, and checks
 * there that it is whole in the middle's header. Placeholder ids only; the day's name is as Drashti makes it.
 */

const DAY = 'Sabha, 25 Nov 2026';

const day: PlaylistNode = {
  id: 'placeholder-day',
  name: DAY,
  isFolder: false,
  kind: 'normal',
  parentId: null,
  itemCount: 0,
  placeholders: 0,
  imported: false,
  template: false,
};

beforeEach(() => {
  usePlaylists.setState({
    view: 'playlists',
    tree: [day],
    templates: [],
    closed: [],
    openId: day.id,
    selectedNodeId: day.id,
    markedNodes: [],
    renaming: null,
    unread: { playlists: false, itemsOf: null },
  });
});

/** Simple Mode's left column's playlists, as drawn. */
const leftColumn = () =>
  renderToStaticMarkup(createElement(PlaylistPanel, { platform: 'win32', simple: true }));

/** The day playlist's row (its button) in the markup. */
function rowOf(html: string): string {
  const row = /<button\b[^>]*data-node-id="placeholder-day"[^>]*>[\s\S]*?<\/button>/u.exec(html)?.[0];
  expect(row, 'the day playlist’s row').toBeDefined();
  return row ?? '';
}

/** The element of the row's name, found by its own test id (the one the fit check may let end in "…"). */
function nameOf(row: string): string {
  const name = /<span\b[^>]*data-testid="playlist-node-name"[^>]*>[^<]*<\/span>/u.exec(row)?.[0];
  expect(name, 'the row’s name, by its test id playlist-node-name').toBeDefined();
  return name ?? '';
}

const classes = (element: string) => (/\bclass="([^"]*)"/u.exec(element)?.[1] ?? '').split(/\s+/u);

describe('Simple Mode’s day playlist in the left column (QA23-STAGE8-5)', () => {
  it('has its name in an element of its own, found by the test id playlist-node-name, whole in its words', () => {
    const name = nameOf(rowOf(leftColumn()));
    expect(name).toMatch(new RegExp(`>${DAY}</span>$`, 'u'));
  });

  it('ends in “…” where it does not fit: cut by CSS (text-overflow: ellipsis), on one line, never wrapped', () => {
    // Tailwind's truncate: overflow hidden, text-overflow ellipsis, white-space nowrap; a block that may shrink.
    const name = nameOf(rowOf(leftColumn()));
    expect(classes(name)).toEqual(expect.arrayContaining(['block', 'min-w-0', 'truncate', 'flex-1']));
  });

  it('is whole on hover: its own title is the full name', () => {
    expect(nameOf(rowOf(leftColumn()))).toContain(`title="${DAY}"`);
  });

  it('is whole to a screen reader: the row’s name, from its words, begins with the full name', () => {
    const row = rowOf(leftColumn());
    // Named by its words (no label of its own to take their place).
    const open = /^<button\b[^>]*>/u.exec(row)?.[0] ?? '';
    expect(open).not.toMatch(/\saria-label(?:ledby)?=/u);
    // What a screen reader reads: the words, without what is hidden from it.
    const read = row
      .replace(/<span aria-hidden="true"[^>]*>[\s\S]*?<\/span>/gu, ' ')
      .replace(/<[^>]+>/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    expect(read.startsWith(`${DAY} `) || read === DAY).toBe(true);
  });
});
