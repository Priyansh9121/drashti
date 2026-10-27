import { describe, expect, it } from 'vitest';
import {
  type AudioCue,
  type BackgroundCue,
  fileNameIn,
  type PresentationDoc,
  type SlideCue,
} from './library';

/*
 * A file's name as a presentation's slides have it (Session 54 review), for the slide editor: Media's list leaves out
 * a file deleted from the library, but the slides' cues still have its name, as the thumbnails and LIVE say it.
 * Placeholder names only.
 */

const sound = (mediaId: string, name: string, missing = false): AudioCue => ({
  kind: 'audio',
  label: 'Placeholder audio',
  name,
  missing,
  unplayable: null,
  mediaId,
  volume: 1,
  loop: false,
});

const backdrop = (mediaId: string, name: string): BackgroundCue => ({
  kind: 'background',
  label: '',
  name,
  missing: true,
  unplayable: null,
  background: { kind: 'media', mediaId, media: 'image', fit: 'fill', loop: false },
});

const input: BackgroundCue = {
  kind: 'background',
  label: '',
  name: 'Placeholder input',
  missing: false,
  unplayable: null,
  background: { kind: 'input', name: 'Placeholder input' },
};

function doc(cues: SlideCue[][]): PresentationDoc {
  return {
    id: 'placeholder-presentation',
    name: 'Placeholder Presentation',
    width: 1920,
    height: 1080,
    groups: [
      {
        id: 'verse',
        name: 'Verse',
        color: null,
        slides: cues.map((c, index) => ({
          id: `s${String(index)}`,
          index,
          label: '',
          notes: '',
          slide: { id: `s${String(index)}`, width: 1920, height: 1080, background: null, elements: [] },
          cues: c,
          transition: null,
          autoAdvanceMs: null,
          macroId: null,
        })),
      },
    ],
    arrangements: [],
    selectedArrangementId: null,
    transition: null,
    loop: false,
    kirtan: null,
    source: null,
  };
}

describe('a file’s name in a presentation (Session 54 review)', () => {
  it('names a sound’s or a background’s file by its media id, as the library has it, deleted or not', () => {
    const shown = doc([
      [sound('tune', 'Placeholder tune.wav', true)],
      [backdrop('pic', 'Placeholder backdrop.png'), input],
    ]);
    expect(fileNameIn(shown, 'tune')).toBe('Placeholder tune.wav');
    expect(fileNameIn(shown, 'pic')).toBe('Placeholder backdrop.png');
  });

  it('names nothing for a file no slide’s cue plays', () => {
    expect(fileNameIn(doc([[input], []]), 'tune')).toBeNull();
  });
});
