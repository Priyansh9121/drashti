import { afterEach, expect, it } from 'vitest';
import { pageCopyUrl } from '../../../shared/media';
import { pageCopyFor, setPageCopyHeight, setReadyPageCopies } from './page-copy';

/*
 * A page's choice of a video's page copy (QA23-FADE-9 candidate 1): only on a page that draws smaller and says so, only
 * a copy that is ready, never below the page's height, never on a later try; else the original.
 */

afterEach(() => {
  setPageCopyHeight(null);
  setReadyPageCopies({});
});

it('a page that never says its height (the hall’s screens) always plays the original', () => {
  setReadyPageCopies({ red: [540, 720] });
  expect(pageCopyFor('red')).toBeNull();
});

it('the stream page at 720p takes the 720p copy; the operator window at 540p the 540p one', () => {
  setReadyPageCopies({ red: [540, 720] });
  setPageCopyHeight(720);
  expect(pageCopyFor('red')).toBe(pageCopyUrl('red', 720));
  setPageCopyHeight(540);
  expect(pageCopyFor('red')).toBe(pageCopyUrl('red', 540));
});

it('the smallest copy at or above the page’s height, never one below it, and none not ready', () => {
  setPageCopyHeight(540);
  setReadyPageCopies({ red: [720] });
  expect(pageCopyFor('red'), 'only the 720p copy: that one').toBe(pageCopyUrl('red', 720));
  setPageCopyHeight(720);
  setReadyPageCopies({ red: [540] });
  expect(pageCopyFor('red'), 'only a smaller one: the original').toBeNull();
  setReadyPageCopies({});
  expect(pageCopyFor('red'), 'none ready: the original').toBeNull();
  setReadyPageCopies({ blue: [720] });
  expect(pageCopyFor('red'), 'another video’s copy: the original').toBeNull();
});

it('a later try at a file (after one that failed) plays the original', () => {
  setPageCopyHeight(720);
  setReadyPageCopies({ red: [720] });
  expect(pageCopyFor('red', 1)).toBeNull();
});
