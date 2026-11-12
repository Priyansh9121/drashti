import { describe, expect, it } from 'vitest';
import type { FileTarget } from '../files/file-menu';
import { evenWords, soundMenuEntries, trimmedWords } from './sound-words';

/*
 * Session 55, Part 7: what the operator window says of a file's Even loudness and of Trim black and silence, and the
 * one menu's two items for a video or a sound. Placeholder names only.
 */

const noop = () => undefined;
const target = (kind: FileTarget['kind'], more: Partial<FileTarget> = {}): FileTarget => ({
  kind,
  name: 'Placeholder clip.mp4',
  place: 'media',
  mediaId: 'm1',
  trim: noop,
  ...more,
});

describe('Drashti’s own sound in words', () => {
  it('says what a file’s Even loudness does: the level, what it measured, and how much louder or quieter', () => {
    const name = 'Placeholder talk.mp4';
    expect(evenWords(name, { even: true, measured: true, lufs: -26.04, gainDb: 10 })).toBe(
      '“Placeholder talk.mp4” plays at the even loudness (−16.0 LUFS): it measured −26.0 LUFS, so it is played 10.0 dB louder.',
    );
    expect(evenWords(name, { even: true, measured: true, lufs: -9, gainDb: -7 })).toContain('7.0 dB quieter');
    expect(evenWords(name, { even: true, measured: true, lufs: -16, gainDb: 0 })).toContain(
      'already at the even level',
    );
    expect(evenWords(name, { even: true, measured: true, lufs: null, gainDb: 0 })).toBe(
      '“Placeholder talk.mp4” has no sound to even out.',
    );
    expect(evenWords(name, { even: true, measured: false, lufs: null, gainDb: 0 })).toContain(
      'once Drashti has measured it',
    );
    expect(evenWords(name, { even: false, measured: true, lufs: -26, gainDb: 0 })).toBe(
      '“Placeholder talk.mp4” plays as it is in its file, at its own loudness.',
    );
  });

  it('says where a trimmed video plays from and to, its file not cut', () => {
    expect(trimmedWords('Placeholder clip.mp4', { startMs: 1500, endMs: 4500 })).toBe(
      '“Placeholder clip.mp4” now plays from 0:01.5 to 0:04.5, past the black and silence. Choose Undo to restore the old playback points.',
    );
    expect(trimmedWords('Placeholder clip.mp4', { startMs: 0, endMs: null })).toContain(
      'from its start to its end',
    );
  });

  it('adds Trim black and silence to a video’s menu, and Even loudness (ticked while on) to a video’s and a sound’s', () => {
    const asked: string[] = [];
    const act = {
      trim: (id: string) => asked.push(`trim ${id}`),
      even: (id: string, _name: string, on: boolean) => asked.push(`even ${id} ${String(on)}`),
    };
    const video = soundMenuEntries(target('video'), [], act);
    expect(video.map((e) => [e.label, e.checked])).toEqual([
      ['Trim black and silence', undefined],
      ['Even loudness', true],
    ]);
    for (const e of video) e.onSelect();
    expect(asked).toEqual(['trim m1', 'even m1 false']);
    // A sound: Even loudness only; off, it turns it on.
    const sound = soundMenuEntries(target('sound'), ['m1'], act);
    expect(sound.map((e) => [e.label, e.checked])).toEqual([['Even loudness', false]]);
    sound[0]?.onSelect();
    expect(asked.at(-1)).toBe('even m1 true');
    // Nothing for a picture, a slide, or a file that cannot play (no Trim offered).
    expect(soundMenuEntries(target('picture'), [], act)).toEqual([]);
    expect(soundMenuEntries(target('slide'), [], act)).toEqual([]);
    expect(soundMenuEntries(target('video', { trim: undefined }), [], act)).toEqual([]);
  });
});
