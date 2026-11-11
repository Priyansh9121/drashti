import { describe, expect, it } from 'vitest';
import { swings } from './flash';
import {
  OPENING_DEFAULT,
  OPENING_DEFAULT_PHOTO_URL,
  OPENING_MS,
  OPENING_SOUND_MAX_BYTES,
  OPENING_SOUND_VOLUME,
  OPENING_TIMES,
  OPENING_ZOOM,
  openingChoiceSchema,
  openingPlanOf,
  openingSoundCurve,
  openingSoundGain,
  openingSoundUrl,
  packMissing,
  packPhotoOf,
  packSoundOf,
  packSoundProblem,
  readOpening,
} from './opening';

/*
 * The opening (alpha.16, the owner's words of 11 Nov 2026): two seconds, one photo, no words, with a smooth
 * transition; the mandir's own sound from its opening pack, played gently with the photo. What is kept (alpha.15's
 * several photos and lines read as its first photo), the two seconds, the sound's loudness through them, and the
 * pack's rules: photo 1 is enough, and its sound is one of three kinds, not too big, and a sound Drashti plays.
 * Placeholder names and made-up file facts only.
 */

const id = (n: number) => `placeholder-photo-${String(n)}`;
const SHA = 'ab'.repeat(32);

describe('what is kept', () => {
  it('is on with nothing chosen when nothing is kept, or what is kept cannot be read', () => {
    expect(OPENING_DEFAULT).toEqual({ on: true, photo: null, sound: null });
    expect(readOpening(undefined)).toEqual(OPENING_DEFAULT);
    expect(readOpening('on')).toEqual(OPENING_DEFAULT);
    expect(readOpening({ on: 'yes', photo: 'not a media id!', sound: { sha256: 'x' } })).toEqual(OPENING_DEFAULT);
  });

  it('keeps one photo and the pack’s sound', () => {
    const sound = { sha256: SHA, kind: 'm4a', name: 'sound.m4a' };
    expect(readOpening({ on: false, photo: id(1), sound })).toEqual({ on: false, photo: id(1), sound });
    // A sound it cannot read is left out, never the rest.
    for (const bad of [
      { sha256: 'AB'.repeat(32), kind: 'm4a', name: 'sound.m4a' },
      { sha256: SHA, kind: 'aiff', name: 'sound.aiff' },
      { sha256: SHA, kind: 'mp3', name: '' },
      { sha256: '../../x', kind: 'wav', name: 'sound.wav' },
    ])
      expect(readOpening({ photo: id(2), sound: bad })).toEqual({ on: true, photo: id(2), sound: null });
  });

  it('reads alpha.15’s several photos and lines forgivingly: its first photo, no words', () => {
    expect(
      readOpening({
        on: true,
        photos: ['not a media id!', id(1), id(2), id(3)],
        lines: ['Placeholder line one', 'Placeholder line two'],
      }),
    ).toEqual({ on: true, photo: id(1), sound: null });
    expect(readOpening({ on: false, photos: [], lines: ['Placeholder'] })).toEqual({
      on: false,
      photo: null,
      sound: null,
    });
    // Kept by alpha.16 (a photo taken out): no photo, whatever an older list says.
    expect(readOpening({ photo: null, photos: [id(4)] })).toEqual({ on: true, photo: null, sound: null });
  });

  it('a change from File › Opening… is one photo from Media, or none', () => {
    expect(openingChoiceSchema.safeParse({ photo: id(1) }).success).toBe(true);
    expect(openingChoiceSchema.safeParse({ photo: null }).success).toBe(true);
    for (const bad of [{ photo: 'not a media id!' }, { photos: [id(1)] }, { photo: [id(1)] }, null])
      expect(openingChoiceSchema.safeParse(bad).success).toBe(false);
  });
});

describe('what plays', () => {
  const photo = 'drashti-media://opening/placeholder-photo-1';
  const sound = openingSoundUrl(SHA);

  it('the mandir’s photo, with its sound when it has one', () => {
    expect(openingPlanOf(photo, sound, true)).toEqual({ photo, sound });
    expect(openingPlanOf(photo, null, true)).toEqual({ photo });
    expect(openingPlanOf(photo, null, false)).toEqual({ photo });
    expect(sound).toBe(`drashti-media://opening-sound/${SHA}`);
  });

  it('with no photo, Drashti’s default photo, never with a sound; its file missing, the lamp alone', () => {
    expect(openingPlanOf(null, sound, true)).toEqual({ photo: OPENING_DEFAULT_PHOTO_URL, defaultPhoto: true });
    expect(openingPlanOf(null, null, true)).toEqual({ photo: OPENING_DEFAULT_PHOTO_URL, defaultPhoto: true });
    expect(OPENING_DEFAULT_PHOTO_URL).toMatch(/^drashti-media:\/\/opening-default\//u);
    expect(openingPlanOf(null, sound, false)).toEqual({ photo: null });
  });
});

describe('the two seconds', () => {
  it('lasts two seconds', () => {
    expect(OPENING_MS).toBe(2000);
    expect(OPENING_TIMES.end).toBe(OPENING_MS);
  });

  it('the photo comes in from the dark, and the whole goes smoothly into the window at the end', () => {
    const t = OPENING_TIMES;
    expect(t.fadeIn).toBeGreaterThanOrEqual(300);
    expect(t.fadeOut.start + t.fadeOut.length).toBe(OPENING_MS);
    expect(t.fadeOut.length).toBeGreaterThanOrEqual(300);
    // Seen whole, still, for a while between the two.
    expect(t.fadeOut.start - t.fadeIn).toBeGreaterThanOrEqual(800);
  });

  it('zooms gently, as before, settling on the whole photo', () => {
    expect(OPENING_ZOOM).toBeGreaterThan(1);
    expect(OPENING_ZOOM).toBeLessThanOrEqual(1.08);
  });

  it('one rise and one fall of light in two seconds: well under three swings a second', () => {
    const t = OPENING_TIMES;
    const at = (ms: number) =>
      Math.min(1, ms / t.fadeIn) * (ms <= t.fadeOut.start ? 1 : 1 - (ms - t.fadeOut.start) / t.fadeOut.length);
    const series = Array.from({ length: 121 }, (_, i) => at((i * 1000) / 60));
    expect(swings(series, 60).worst).toBeLessThanOrEqual(2);
  });
});

describe('the pack’s sound, played gently', () => {
  it('in from silence, never louder than OPENING_SOUND_VOLUME, out to silence as the two seconds end', () => {
    expect(OPENING_SOUND_VOLUME).toBeGreaterThan(0.1);
    expect(OPENING_SOUND_VOLUME).toBeLessThanOrEqual(0.3);
    expect(openingSoundGain(0)).toBe(0);
    expect(openingSoundGain(OPENING_MS)).toBe(0);
    expect(openingSoundGain(OPENING_MS + 500)).toBe(0);
    expect(openingSoundGain(-10)).toBe(0);
    expect(openingSoundGain(OPENING_MS / 2)).toBeCloseTo(OPENING_SOUND_VOLUME, 5);
    // Rising, then held, then falling: never a jump.
    const steps = Array.from({ length: 401 }, (_, i) => openingSoundGain((i * OPENING_MS) / 400));
    const peak = steps.indexOf(Math.max(...steps));
    for (let i = 1; i < steps.length; i++) {
      const [now = 0, before = 0] = [steps[i], steps[i - 1]];
      if (i <= peak) expect(now).toBeGreaterThanOrEqual(before);
      else expect(now).toBeLessThanOrEqual(before);
      expect(Math.abs(now - before)).toBeLessThan(0.02);
    }
    for (const g of steps) expect(g).toBeLessThanOrEqual(OPENING_SOUND_VOLUME);
    // Faded in gently: still quiet a tenth of a second in.
    expect(openingSoundGain(100)).toBeLessThan(OPENING_SOUND_VOLUME / 4);
    expect(openingSoundGain(OPENING_MS - 100)).toBeLessThan(OPENING_SOUND_VOLUME / 4);
  });

  it('a file shorter than the two seconds is faded out by its own end', () => {
    expect(openingSoundGain(800, 800)).toBe(0);
    expect(openingSoundGain(400, 800)).toBeGreaterThan(0);
    expect(openingSoundGain(1200, 800)).toBe(0);
    // Very short: in and out, never louder than the most.
    for (let t = 0; t <= 200; t += 10) expect(openingSoundGain(t, 200)).toBeLessThanOrEqual(OPENING_SOUND_VOLUME);
  });

  it('as Web Audio’s curve: the same loudness at even steps from its start to its end', () => {
    const curve = openingSoundCurve(OPENING_MS, 101);
    expect(curve).toHaveLength(101);
    expect(curve[0]).toBe(0);
    expect(curve.at(-1)).toBe(0);
    expect(curve[50]).toBeCloseTo(openingSoundGain(OPENING_MS / 2), 5);
    for (const [i, g] of curve.entries()) expect(g).toBeCloseTo(openingSoundGain((i * OPENING_MS) / 100), 5);
    const short = openingSoundCurve(600, 31);
    expect(short.at(-1)).toBe(0);
    expect(Math.max(...short)).toBeLessThanOrEqual(OPENING_SOUND_VOLUME);
  });
});

describe('the opening pack', () => {
  it('needs only photos/1 (a .jpg, .jpeg or .png, in any case); photos 2 to 8 are left alone', () => {
    expect(packPhotoOf(['2.jpg', '1.JPG', '3.png'])).toBe('1.JPG');
    expect(packPhotoOf(['1.jpeg'])).toBe('1.jpeg');
    expect(packPhotoOf(['1.png', '1.jpg'])).toBe('1.jpg');
    expect(packPhotoOf(['2.jpg', '8.jpg', '1.gif', '11.jpg', 'notes.jpg'])).toBeNull();
    expect(packMissing({ photo: true })).toBeNull();
    expect(packMissing({ photo: false })).toBe(
      'The opening pack has no photo 1 (photos/1.jpg). Nothing was changed.',
    );
  });

  it('finds its sound at its top: sound.mp3, sound.m4a or sound.wav, in any case; one at most', () => {
    expect(packSoundOf(['photos', 'words.txt'])).toBeNull();
    expect(packSoundOf(['photos', 'sound.mp3'])).toEqual({ name: 'sound.mp3', kind: 'mp3' });
    expect(packSoundOf(['Sound.M4A'])).toEqual({ name: 'Sound.M4A', kind: 'm4a' });
    expect(packSoundOf(['SOUND.WAV', 'readme.txt'])).toEqual({ name: 'SOUND.WAV', kind: 'wav' });
    // Not its sound: another name, or a kind it does not take.
    expect(packSoundOf(['sounds.mp3', 'sound.aiff', 'sound.mp3.txt', 'my sound.wav'])).toBeNull();
    expect(packSoundOf(['sound.wav', 'sound.mp3'])).toEqual({ several: ['sound.mp3', 'sound.wav'] });
  });

  it('takes a sound Drashti plays, at most 10 MB; says in plain words why not', () => {
    expect(OPENING_SOUND_MAX_BYTES).toBe(10 * 1024 * 1024);
    const ok = { name: 'sound.m4a', bytes: 200_000, kind: 'audio', playable: true, format: 'AAC sound file (M4A)' } as const;
    expect(packSoundProblem(ok)).toBeNull();
    expect(packSoundProblem({ ...ok, bytes: OPENING_SOUND_MAX_BYTES })).toBeNull();
    expect(packSoundProblem({ ...ok, bytes: OPENING_SOUND_MAX_BYTES + 1 })).toBe(
      'The opening pack’s sound.m4a is too big: the opening’s sound can be at most 10 MB, and only its first two seconds play. Nothing was changed.',
    );
    expect(
      packSoundProblem({ ...ok, name: 'sound.mp3', kind: 'image', playable: true, format: 'PNG picture' }),
    ).toBe(
      'Drashti cannot play the opening pack’s sound.mp3 as it is: PNG picture. Its sound must be an MP3, an M4A (AAC) or a WAV. Nothing was changed.',
    );
    expect(
      packSoundProblem({ ...ok, playable: false, format: 'Apple Lossless sound file (M4A)' }),
    ).toBe(
      'Drashti cannot play the opening pack’s sound.m4a as it is: Apple Lossless sound file (M4A). Its sound must be an MP3, an M4A (AAC) or a WAV. Nothing was changed.',
    );
    // Not sure it plays is not a sound it plays.
    expect(packSoundProblem({ ...ok, name: 'sound.wav', playable: null, format: 'WAV sound file' })).toMatch(
      /^Drashti cannot play the opening pack’s sound\.wav as it is: WAV sound file\./u,
    );
    expect(packSoundProblem({ ...ok, bytes: 0 })).toBe(
      'Drashti cannot play the opening pack’s sound.m4a as it is: empty file. Its sound must be an MP3, an M4A (AAC) or a WAV. Nothing was changed.',
    );
    expect(
      packSoundProblem({ ...ok, kind: 'video', playable: true, format: 'H.264 video (MP4)' }),
    ).toMatch(/as it is: H\.264 video \(MP4\)\./u);
  });
});
