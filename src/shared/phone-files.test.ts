import { describe, expect, it } from 'vitest';
import { addFilesWords, UPLOAD_MAX_BYTES } from './phone-files';

/*
 * Where a phone's files go, as the phone says it before they are sent (Session 54, D4: Added from Phones; Session 55,
 * Part 8: Add photos into the playlist open in Pro Mode; question 5, the owner's decision of 3 Nov 2026: in Simple Mode
 * a picture goes to the end of Simple Mode's playlist). Placeholder playlist names.
 */

describe('where a phone’s files go, in its words', () => {
  it('in Pro Mode with no playlist open: everything into Added from Phones', () => {
    expect(addFilesWords({ maxBytes: UPLOAD_MAX_BYTES, openPlaylist: null, simplePlaylist: null })).toEqual({
      files:
        'A picture, video, sound, PDF, PowerPoint or Keynote file, up to 2 GB, goes whole into Drashti’s playlist “Added from Phones”. It never goes on the screens by itself.',
      photos: 'No playlist is open on Drashti: Add photos puts pictures into “Added from Phones”.',
    });
  });

  it('in Pro Mode with a playlist open: Add photos puts pictures at its end', () => {
    expect(addFilesWords({ maxBytes: UPLOAD_MAX_BYTES, openPlaylist: 'Placeholder sabha' }).photos).toBe(
      'Add photos puts pictures at the end of the playlist open on Drashti, “Placeholder sabha”. They never go on the screens by themselves.',
    );
  });

  it('in Simple Mode: a picture, however it is sent, at the end of Simple Mode’s playlist; anything else into Added from Phones', () => {
    expect(
      addFilesWords({ maxBytes: UPLOAD_MAX_BYTES, openPlaylist: null, simplePlaylist: 'Sabha, 4 Nov 2026' }),
    ).toEqual({
      files:
        'A file goes whole, up to 2 GB: a picture to the end of Simple Mode’s playlist “Sabha, 4 Nov 2026”, and a video, sound, PDF, PowerPoint or Keynote file into Drashti’s playlist “Added from Phones”. Nothing goes on the screens by itself.',
      photos:
        'Add photos puts pictures at the end of Simple Mode’s playlist, “Sabha, 4 Nov 2026”. They never go on the screens by themselves.',
    });
  });
});
