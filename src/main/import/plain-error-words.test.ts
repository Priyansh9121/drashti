import { expect, it } from 'vitest';
import { appErrorWords } from './deck-converters';
import { cutFailure } from './deck/bake';
import { whyPictures } from './deck/deck-import';

/*
 * An operator reads plain words: what failed and what to do. A tool's own words (AppleScript's error, FFmpeg's last
 * line) go to the log only (C15, Session 58: DEV-1, DEV-2).
 */

it('says PowerPoint or Keynote could not do it, and how to do it by hand, never AppleScript’s own words (DEV-1)', () => {
  const said = 'execution error: Microsoft PowerPoint got an error: Parameter error. (-50)';
  expect(appErrorWords('powerpoint', 'save it as PDF', said)).toBe(
    'PowerPoint could not save it as PDF. Open it in PowerPoint and choose File > Save As, PDF, then import the PDF.',
  );
  expect(
    appErrorWords(
      'keynote',
      'open it',
      'execution error: Keynote got an error: AppleEvent timed out. (-1712)',
    ),
  ).toBe(
    'Keynote could not open it. Open it in Keynote and choose File > Export To > PDF…, then import the PDF.',
  );
});

it('says a deck’s movie could not be cut into its steps, never FFmpeg’s last line (DEV-2)', () => {
  const thrown = new Error(
    'FFmpeg could not cut the movie: [h264 @ 0x7f9c] Invalid NAL unit size (1234 > 567).',
  );
  expect(whyPictures(cutFailure(thrown), 'powerpoint').message).toBe(
    'PowerPoint made the deck’s movie, but it could not be cut into its steps: its slides came in as pictures, without their animations.',
  );
});
