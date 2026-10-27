import { describe, expect, it } from 'vitest';
import type { EngineCommand } from '../../shared/engine/commands';
import type { MusicRun } from '../../shared/engine/state';
import type { AudioCue, BackgroundCue, SlideCue } from '../../shared/library';
import { MemoryPlaylistSource } from './playlist-source';
import { ShowEngine } from './show-engine';
import type { MemorySlideSource } from './slide-source';
import { makeSource, RecordingTransport, textSlide } from './testing';

/*
 * A slide's background cue whose file is missing (Session 52): not found at import, or deleted from the library,
 * as the library reads it (db/presentations.ts cueFromRow). It goes as a video input this computer has none of
 * does (Session 51): the background stays as it was, never black because of it, and the slide names the file for
 * LIVE to say why. A slide's sound cue whose file is missing goes the same way (Session 53): nothing goes on the
 * audio layer for it, so what is playing carries on, and the slide names the file. Placeholder names only.
 */

/** A slide's background cue: a video from the library, its file there unless it says otherwise. */
const videoCue = (
  mediaId: string,
  name: string,
  how: { missing?: boolean; unplayable?: string } = {},
): BackgroundCue => ({
  kind: 'background',
  label: '',
  name,
  missing: how.missing ?? false,
  unplayable: how.unplayable ?? null,
  background: { kind: 'media', mediaId, media: 'video', fit: 'fill', loop: true },
});

const LOOP = videoCue('loop', 'Placeholder loop.mp4');
const GONE = videoCue('gone', 'Placeholder gone.mov', { missing: true });
const PRORES = videoCue('prores', 'Placeholder ProRes.mov', { unplayable: 'ProRes video' });

/**
 * An engine over a presentation whose first slide's background is a video that is there, the second has none, the
 * third's file is missing and the fourth's cannot be played; and a playlist with an item whose file is missing.
 */
function show() {
  const source = makeSource();
  source.set(
    'files',
    [textSlide('f1', 'One'), textSlide('f2', 'Two'), textSlide('f3', 'Three'), textSlide('f4', 'Four')],
    [[LOOP], [], [GONE], [PRORES]],
  );
  const playlists = new MemoryPlaylistSource();
  playlists.set('sunday', [
    { id: 'i-p2', kind: 'presentation', presentationId: 'p2', arrangementId: undefined },
    // As the library reads a media item whose file is missing (db/playlists.ts playItems).
    { id: 'i-gone', kind: 'skip', why: 'The file for “Placeholder gone.mov” is missing' },
    { id: 'i-p1', kind: 'presentation', presentationId: 'p1', arrangementId: undefined },
  ]);
  let clock = 1000;
  const engine = new ShowEngine(source, new RecordingTransport(), () => ++clock, playlists);
  return { engine, source };
}

const goLive = (presentationId: string, slideIndex: number): EngineCommand => ({
  type: 'goLive',
  presentationId,
  slideIndex,
});

describe('a slide’s background cue whose file is missing', () => {
  it('leaves the background as it was, never black, and the slide names the file for LIVE to say why', () => {
    const { engine } = show();
    engine.dispatch(goLive('files', 0));
    const loop = engine.current.layers.background;
    expect(loop).toMatchObject({ kind: 'media', mediaId: 'loop' });
    // What Next shows names the missing file, and puts nothing up ahead of it.
    engine.dispatch({ type: 'next' });
    expect(engine.current.next).toMatchObject({
      kind: 'slide',
      slideIndex: 2,
      background: null,
      fileMissing: 'Placeholder gone.mov',
    });
    engine.dispatch({ type: 'next' });
    expect(engine.current.layers.slide).toMatchObject({ slideIndex: 2, fileMissing: 'Placeholder gone.mov' });
    expect(engine.current.layers.background).toBe(loop);
    // Next goes on; a file that cannot be played is not one that is missing: it goes up as before, and nothing
    // is said of it.
    engine.dispatch({ type: 'next' });
    expect(engine.current.layers.slide?.slideIndex).toBe(3);
    expect(engine.current.layers.slide).not.toHaveProperty('fileMissing');
    expect(engine.current.layers.background).toMatchObject({ kind: 'media', mediaId: 'prores' });
    // Back brings the slide back exactly, saying so again.
    engine.dispatch({ type: 'back' });
    expect(engine.current.layers.slide).toMatchObject({ slideIndex: 2, fileMissing: 'Placeholder gone.mov' });
    expect(engine.current.layers.background).toBe(loop);
    // So does Put it back, after Clear all.
    engine.dispatch({ type: 'clearAll' });
    engine.dispatch({ type: 'putBack' });
    expect(engine.current.layers.slide).toMatchObject({ slideIndex: 2, fileMissing: 'Placeholder gone.mov' });
    expect(engine.current.layers.background).toMatchObject({ kind: 'media', mediaId: 'loop' });
  });

  it('with no background up, none goes up for it, and the slide still says which file', () => {
    const { engine } = show();
    engine.dispatch(goLive('files', 2));
    expect(engine.current.layers.background).toBeNull();
    expect(engine.current.layers.slide).toMatchObject({ slideIndex: 2, fileMissing: 'Placeholder gone.mov' });
    // A slide naming none says nothing more.
    engine.dispatch(goLive('files', 1));
    expect(engine.current.layers.slide).not.toHaveProperty('fileMissing');
    // Next names none for a slide whose file is there.
    engine.dispatch(goLive('p1', 0));
    expect(engine.current.next).not.toHaveProperty('fileMissing');
  });

  it('keeps saying so while the slide stays up with new content, and goes up once found again', () => {
    const { engine, source } = show();
    engine.dispatch(goLive('files', 2));
    // Its words edited while it is up: its cues do not run again, and it still says which file.
    source.set(
      'files',
      [
        textSlide('f1', 'One'),
        textSlide('f2', 'Two'),
        textSlide('f3', 'Three, edited'),
        textSlide('f4', 'Four'),
      ],
      [[LOOP], [], [GONE], [PRORES]],
    );
    engine.refreshLive('files');
    expect(engine.current.layers.slide).toMatchObject({ slideIndex: 2, fileMissing: 'Placeholder gone.mov' });
    expect(engine.current.layers.background).toBeNull();
    // Found again (relinked): the slide shown again puts it up and says nothing is missing.
    source.set(
      'files',
      [
        textSlide('f1', 'One'),
        textSlide('f2', 'Two'),
        textSlide('f3', 'Three, edited'),
        textSlide('f4', 'Four'),
      ],
      [[LOOP], [], [{ ...GONE, missing: false }], [PRORES]],
    );
    engine.dispatch(goLive('files', 2));
    expect(engine.current.layers.slide).not.toHaveProperty('fileMissing');
    expect(engine.current.layers.background).toMatchObject({ kind: 'media', mediaId: 'gone' });
  });

  it('after an unexpected restart, the slide put back says so again, the background as it was', () => {
    const { engine } = show();
    engine.dispatch(goLive('files', 0));
    engine.dispatch(goLive('files', 2));
    const was = engine.current;
    const shown = was.layers.slide;
    if (!shown) throw new Error('no slide up');
    const again = show().engine;
    again.restore({
      slide: { presentationId: 'files', slideIndex: 2, shownAt: shown.shownAt },
      background: was.layers.background,
      blackout: false,
    });
    expect(again.current.layers.slide).toMatchObject({ slideIndex: 2, fileMissing: 'Placeholder gone.mov' });
    expect(again.current.layers.background).toMatchObject({ kind: 'media', mediaId: 'loop' });
    // With none up then, none comes up now.
    const bare = show().engine;
    bare.restore({ slide: { presentationId: 'files', slideIndex: 2 }, background: null, blackout: false });
    expect(bare.current.layers.slide).toMatchObject({ fileMissing: 'Placeholder gone.mov' });
    expect(bare.current.layers.background).toBeNull();
    // A slide whose file is there names none.
    const plain = show().engine;
    plain.restore({ slide: { presentationId: 'files', slideIndex: 0 }, background: null, blackout: false });
    expect(plain.current.layers.slide).not.toHaveProperty('fileMissing');
  });
});

describe('a slide’s missing background file, as the library and the show move on (Session 52 review)', () => {
  /** 'files' as the library reads it now: its four slides, with these cues. */
  const setFiles = (source: MemorySlideSource, cues: BackgroundCue[][]) => {
    source.set(
      'files',
      [textSlide('f1', 'One'), textSlide('f2', 'Two'), textSlide('f3', 'Three'), textSlide('f4', 'Four')],
      cues,
    );
  };
  const FOUND = { ...GONE, missing: false };

  it('found again while its slide is up, says so no more, the background as it was until the slide goes up again; Back still undoes the Next', () => {
    const { engine, source } = show();
    source.set('swap', [textSlide('s1', 'One'), textSlide('s2', 'Two')], [[LOOP], [GONE]]);
    engine.dispatch(goLive('swap', 0));
    // Cleared, so that Back (the Next undone) and Previous (the first slide's cue run again) differ.
    engine.dispatch({ type: 'clearLayer', layer: 'background' });
    engine.dispatch({ type: 'next' });
    expect(engine.current.layers.slide).toMatchObject({ slideIndex: 1, fileMissing: 'Placeholder gone.mov' });
    // Find missing media…, Undo of a delete, the same file imported again: the library reads it there now.
    expect(engine.refreshFiles()).toMatchObject({ ok: true, changed: false });
    source.set('swap', [textSlide('s1', 'One'), textSlide('s2', 'Two')], [[LOOP], [FOUND]]);
    expect(engine.refreshFiles()).toMatchObject({ ok: true, changed: true });
    expect(engine.current.layers.slide?.slideIndex).toBe(1);
    expect(engine.current.layers.slide).not.toHaveProperty('fileMissing');
    expect(engine.current.layers.background).toBeNull();
    // Not a change to the show: Back undoes the Next exactly (the first slide, the background still cleared).
    engine.dispatch({ type: 'back' });
    expect(engine.current.layers.slide?.slideIndex).toBe(0);
    expect(engine.current.layers.background).toBeNull();
  });

  it('found again while it was off, a slide Back or Put it back brings again says so no more, and Back after Back still undoes each Next exactly', () => {
    const { engine, source } = show();
    const slides = [textSlide('s1', 'One'), textSlide('s2', 'Two'), textSlide('s3', 'Three')];
    source.set('swap', slides, [[LOOP], [GONE], [PRORES]]);
    engine.dispatch(goLive('swap', 0));
    // Cleared, so that Back (the Next undone) and Previous (the first slide's cue run again) differ.
    engine.dispatch({ type: 'clearLayer', layer: 'background' });
    engine.dispatch({ type: 'next' });
    engine.dispatch({ type: 'next' });
    expect(engine.current.layers.background).toMatchObject({ mediaId: 'prores' });
    source.set('swap', slides, [[LOOP], [FOUND], [PRORES]]);
    engine.dispatch({ type: 'back' });
    expect(engine.current.layers.slide?.slideIndex).toBe(1);
    expect(engine.current.layers.slide).not.toHaveProperty('fileMissing');
    // Its background as it was then: nothing.
    expect(engine.current.layers.background).toBeNull();
    // Back again undoes the first Next exactly: the first slide, the background still cleared.
    engine.dispatch({ type: 'back' });
    expect(engine.current.layers.slide?.slideIndex).toBe(0);
    expect(engine.current.layers.background).toBeNull();
    // Put it back, the same.
    const again = show();
    again.engine.dispatch(goLive('files', 2));
    again.engine.dispatch({ type: 'clearAll' });
    setFiles(again.source, [[LOOP], [], [FOUND], [PRORES]]);
    again.engine.dispatch({ type: 'putBack' });
    expect(again.engine.current.layers.slide?.slideIndex).toBe(2);
    expect(again.engine.current.layers.slide).not.toHaveProperty('fileMissing');
  });

  it('an edit that moves the slide up (a slide added before it) keeps what it said: a file missing, an input not here', () => {
    const { engine, source } = show();
    const input: BackgroundCue = {
      kind: 'background',
      label: '',
      name: 'Placeholder input',
      missing: false,
      unplayable: null,
      background: { kind: 'input', name: 'Placeholder input' },
    };
    const m1 = textSlide('m1', 'One');
    const m2 = textSlide('m2', 'Two');
    source.set('moving', [m1, m2], [[GONE], [input]]);
    engine.dispatch(goLive('moving', 0));
    expect(engine.current.layers.slide).toMatchObject({ slideIndex: 0, fileMissing: 'Placeholder gone.mov' });
    source.set('moving', [textSlide('m0', 'New'), m1, m2], [[], [GONE], [input]]);
    engine.refreshLive('moving');
    expect(engine.current.layers.slide).toMatchObject({ slideIndex: 1, fileMissing: 'Placeholder gone.mov' });
    // This engine has no video inputs: the input the third slide names is not on this computer.
    engine.dispatch(goLive('moving', 2));
    expect(engine.current.layers.slide).toMatchObject({ slideIndex: 2, inputMissing: 'Placeholder input' });
    source.set(
      'moving',
      [textSlide('mx', 'Newer'), textSlide('m0', 'New'), m1, m2],
      [[], [], [GONE], [input]],
    );
    engine.refreshLive('moving');
    expect(engine.current.layers.slide).toMatchObject({ slideIndex: 3, inputMissing: 'Placeholder input' });
  });

  it('names no file that is the background up: deleted while up, it stays up, and a slide naming it carries it on', () => {
    const { engine, source } = show();
    engine.dispatch(goLive('files', 0));
    const loop = engine.current.layers.background;
    if (loop?.kind !== 'media') throw new Error('no video up');
    // Deleted from the library while it is up (it stays up until it is changed): every cue naming it reads missing.
    const deleted = { ...LOOP, missing: true };
    setFiles(source, [[deleted], [], [deleted], [PRORES]]);
    engine.dispatch({ type: 'next' });
    // What Next shows names it not, nor does the slide once up: it carries on, from when it started.
    expect(engine.current.next).toMatchObject({ kind: 'slide', slideIndex: 2 });
    expect(engine.current.next).not.toHaveProperty('fileMissing');
    engine.dispatch({ type: 'next' });
    expect(engine.current.layers.slide?.slideIndex).toBe(2);
    expect(engine.current.layers.slide).not.toHaveProperty('fileMissing');
    expect(engine.current.layers.background).toMatchObject({
      kind: 'media',
      mediaId: 'loop',
      startedAt: loop.startedAt,
    });
    // After an unexpected restart, the same: it comes back up, and the slide names nothing.
    const again = show();
    setFiles(again.source, [[deleted], [], [deleted], [PRORES]]);
    again.engine.restore({
      slide: { presentationId: 'files', slideIndex: 2 },
      background: engine.current.layers.background,
      blackout: false,
    });
    expect(again.engine.current.layers.slide).not.toHaveProperty('fileMissing');
    expect(again.engine.current.layers.background).toMatchObject({ kind: 'media', mediaId: 'loop' });
  });

  it('a slide with two background cues (an import can give it two) is read by the last, the one that goes up', () => {
    const { engine, source } = show();
    source.set(
      'twice',
      [textSlide('t1', 'One'), textSlide('t2', 'Two'), textSlide('t3', 'Three')],
      [[], [GONE, LOOP], [LOOP, GONE]],
    );
    // The last is there: it goes up, nothing is said, and Next loads it ahead.
    engine.dispatch(goLive('twice', 0));
    expect(engine.current.next).toMatchObject({ slideIndex: 1, background: { mediaId: 'loop' } });
    expect(engine.current.next).not.toHaveProperty('fileMissing');
    engine.dispatch({ type: 'next' });
    expect(engine.current.layers.slide).not.toHaveProperty('fileMissing');
    expect(engine.current.layers.background).toMatchObject({ kind: 'media', mediaId: 'loop' });
    // The last is missing: the background stays as it was (the first never goes up instead), and it is named.
    engine.dispatch({ type: 'clearLayer', layer: 'background' });
    expect(engine.current.next).toMatchObject({
      slideIndex: 2,
      background: null,
      fileMissing: 'Placeholder gone.mov',
    });
    engine.dispatch({ type: 'next' });
    expect(engine.current.layers.slide).toMatchObject({ slideIndex: 2, fileMissing: 'Placeholder gone.mov' });
    expect(engine.current.layers.background).toBeNull();
  });
});

/** A slide's sound cue: a sound from the library, looping, its file there unless it says otherwise. */
const soundCue = (mediaId: string, name: string, how: { missing?: boolean } = {}): AudioCue => ({
  kind: 'audio',
  label: '',
  name,
  missing: how.missing ?? false,
  unplayable: null,
  mediaId,
  volume: 0.8,
  loop: true,
});

const TUNE = soundCue('tune', 'Placeholder tune.wav');
const HYMN = soundCue('hymn', 'Placeholder hymn.wav', { missing: true });
const BELL = soundCue('bell', 'Placeholder bell.wav');
const HYMN_FOUND = { ...HYMN, missing: false };

/** An audio playlist of one track (its length not known: it never ends by itself here). */
const MUSIC: Omit<MusicRun, 'index'> = {
  playlistId: 'before-sabha',
  name: 'Placeholder music',
  tracks: [{ mediaId: 'track', title: 'Placeholder track' }],
  loop: false,
  shuffle: false,
};

/**
 * An engine over 'sounds': its first slide's sound is there, the second has none, the third's file is missing and
 * the fourth's is another that is there. No wait comes by itself (a track's end): the tests move the show on.
 */
function sounds() {
  const source = makeSource();
  const setSounds = (cues: SlideCue[][]) => {
    source.set(
      'sounds',
      [textSlide('n1', 'One'), textSlide('n2', 'Two'), textSlide('n3', 'Three'), textSlide('n4', 'Four')],
      cues,
    );
  };
  setSounds([[TUNE], [], [HYMN], [BELL]]);
  let clock = 1000;
  const engine = new ShowEngine(source, new RecordingTransport(), () => ++clock, undefined, {
    schedule: () => () => undefined,
  });
  return { engine, source, setSounds };
}

describe('a slide’s sound cue whose file is missing (Session 53)', () => {
  it('puts nothing on the audio layer for it, the sound playing carrying on, and the slide names the file for LIVE to say why', () => {
    const { engine } = sounds();
    engine.dispatch(goLive('sounds', 0));
    const tune = engine.current.layers.audio;
    expect(tune).toMatchObject({ mediaId: 'tune' });
    engine.dispatch({ type: 'next' });
    engine.dispatch({ type: 'next' });
    expect(engine.current.layers.slide).toMatchObject({
      slideIndex: 2,
      soundMissing: 'Placeholder hymn.wav',
    });
    expect(engine.current.layers.audio).toBe(tune);
    // Next goes on: a slide whose sound is there plays it, and names none.
    engine.dispatch({ type: 'next' });
    expect(engine.current.layers.slide?.slideIndex).toBe(3);
    expect(engine.current.layers.slide).not.toHaveProperty('soundMissing');
    expect(engine.current.layers.audio).toMatchObject({ mediaId: 'bell' });
    // Back brings the slide back exactly, saying so again, the tune as it was.
    engine.dispatch({ type: 'back' });
    expect(engine.current.layers.slide).toMatchObject({
      slideIndex: 2,
      soundMissing: 'Placeholder hymn.wav',
    });
    expect(engine.current.layers.audio).toBe(tune);
    // So does Put it back, after Clear all.
    engine.dispatch({ type: 'clearAll' });
    engine.dispatch({ type: 'putBack' });
    expect(engine.current.layers.slide).toMatchObject({
      slideIndex: 2,
      soundMissing: 'Placeholder hymn.wav',
    });
    expect(engine.current.layers.audio).toEqual(tune);
  });

  it('with nothing playing, nothing plays, and the slide still names the file; an audio playlist’s music plays on under it', () => {
    const { engine } = sounds();
    engine.dispatch(goLive('sounds', 2));
    expect(engine.current.layers.audio).toBeNull();
    expect(engine.current.layers.slide).toMatchObject({
      slideIndex: 2,
      soundMissing: 'Placeholder hymn.wav',
    });
    // A slide naming none says nothing more.
    engine.dispatch(goLive('sounds', 1));
    expect(engine.current.layers.slide).not.toHaveProperty('soundMissing');
    // The music, as it was: never stopped for it.
    engine.dispatch({ type: 'playMusic', music: MUSIC, index: 0 });
    const music = engine.current.layers.audio;
    expect(music).toMatchObject({ mediaId: 'track', music: { playlistId: 'before-sabha' } });
    engine.dispatch({ type: 'next' });
    expect(engine.current.layers.slide).toMatchObject({
      slideIndex: 2,
      soundMissing: 'Placeholder hymn.wav',
    });
    expect(engine.current.layers.audio).toBe(music);
    // A slide whose sound is there takes the audio layer from the music, as it always has.
    engine.dispatch({ type: 'next' });
    expect(engine.current.layers.audio).toMatchObject({ mediaId: 'bell' });
    expect(engine.current.layers.audio).not.toHaveProperty('music');
  });

  it('after an unexpected restart, the slide put back says so again, the sound as it was', () => {
    const { engine } = sounds();
    engine.dispatch(goLive('sounds', 0));
    engine.dispatch(goLive('sounds', 2));
    const was = engine.current;
    const again = sounds().engine;
    again.restore({
      slide: { presentationId: 'sounds', slideIndex: 2, shownAt: was.layers.slide?.shownAt },
      background: null,
      blackout: false,
      audio: was.layers.audio,
    });
    expect(again.current.layers.slide).toMatchObject({ slideIndex: 2, soundMissing: 'Placeholder hymn.wav' });
    expect(again.current.layers.audio).toMatchObject({
      mediaId: 'tune',
      startedAt: was.layers.audio?.startedAt,
    });
    // With none playing then, none plays now.
    const bare = sounds().engine;
    bare.restore({ slide: { presentationId: 'sounds', slideIndex: 2 }, background: null, blackout: false });
    expect(bare.current.layers.slide).toMatchObject({ soundMissing: 'Placeholder hymn.wav' });
    expect(bare.current.layers.audio).toBeNull();
    // A slide whose sound is there names none.
    const plain = sounds().engine;
    plain.restore({ slide: { presentationId: 'sounds', slideIndex: 3 }, background: null, blackout: false });
    expect(plain.current.layers.slide).not.toHaveProperty('soundMissing');
  });

  it('found again while its slide is up, says so no more, the sound as it was until the slide goes up again; Back still undoes the Next', () => {
    const { engine, setSounds } = sounds();
    engine.dispatch(goLive('sounds', 0));
    const tune = engine.current.layers.audio;
    engine.dispatch({ type: 'next' });
    engine.dispatch({ type: 'next' });
    expect(engine.current.layers.slide).toMatchObject({
      slideIndex: 2,
      soundMissing: 'Placeholder hymn.wav',
    });
    // Find missing media…, Undo of a delete, the same file imported again: the library reads it there now.
    expect(engine.refreshFiles()).toMatchObject({ ok: true, changed: false });
    setSounds([[TUNE], [], [HYMN_FOUND], [BELL]]);
    expect(engine.refreshFiles()).toMatchObject({ ok: true, changed: true });
    expect(engine.current.layers.slide?.slideIndex).toBe(2);
    expect(engine.current.layers.slide).not.toHaveProperty('soundMissing');
    expect(engine.current.layers.audio).toBe(tune);
    // Not a change to the show: Back undoes the Next exactly.
    engine.dispatch({ type: 'back' });
    expect(engine.current.layers.slide?.slideIndex).toBe(1);
    expect(engine.current.layers.audio).toBe(tune);
    // The slide shown again plays it.
    engine.dispatch(goLive('sounds', 2));
    expect(engine.current.layers.audio).toMatchObject({ mediaId: 'hymn' });
  });

  it('names its background’s file and its sound’s apart, each said no more once found; an edit that moves the slide keeps them', () => {
    const { engine, source } = sounds();
    const one = textSlide('b1', 'One');
    source.set('both', [one], [[GONE, HYMN]]);
    engine.dispatch(goLive('both', 0));
    expect(engine.current.layers.slide).toMatchObject({
      fileMissing: 'Placeholder gone.mov',
      soundMissing: 'Placeholder hymn.wav',
    });
    expect(engine.current.layers.background).toBeNull();
    expect(engine.current.layers.audio).toBeNull();
    // A slide added before it: it still says both, at its new place.
    source.set('both', [textSlide('b0', 'New'), one], [[], [GONE, HYMN]]);
    engine.refreshLive('both');
    expect(engine.current.layers.slide).toMatchObject({
      slideIndex: 1,
      fileMissing: 'Placeholder gone.mov',
      soundMissing: 'Placeholder hymn.wav',
    });
    // The sound found: only the background's file is said.
    source.set('both', [textSlide('b0', 'New'), one], [[], [GONE, HYMN_FOUND]]);
    engine.refreshFiles();
    expect(engine.current.layers.slide).toMatchObject({ fileMissing: 'Placeholder gone.mov' });
    expect(engine.current.layers.slide).not.toHaveProperty('soundMissing');
    // Then the background's: nothing is.
    source.set('both', [textSlide('b0', 'New'), one], [[], [{ ...GONE, missing: false }, HYMN_FOUND]]);
    engine.refreshFiles();
    expect(engine.current.layers.slide).not.toHaveProperty('fileMissing');
    expect(engine.current.layers.slide?.slideIndex).toBe(1);
  });

  it('names no sound that is the one playing: deleted while it plays, it plays on, and a slide naming it carries it on', () => {
    const { engine, setSounds } = sounds();
    engine.dispatch(goLive('sounds', 0));
    const tune = engine.current.layers.audio;
    if (!tune) throw new Error('no sound playing');
    // Deleted from the library while it plays (it plays on until it is changed): every cue naming it reads missing.
    const deleted = { ...TUNE, missing: true };
    setSounds([[deleted], [], [deleted], [BELL]]);
    engine.dispatch(goLive('sounds', 2));
    expect(engine.current.layers.slide).not.toHaveProperty('soundMissing');
    expect(engine.current.layers.audio).toMatchObject({ mediaId: 'tune', startedAt: tune.startedAt });
    // After an unexpected restart, the same: it plays on, and the slide names nothing.
    const again = sounds();
    again.setSounds([[deleted], [], [deleted], [BELL]]);
    again.engine.restore({
      slide: { presentationId: 'sounds', slideIndex: 2 },
      background: null,
      blackout: false,
      audio: engine.current.layers.audio,
    });
    expect(again.engine.current.layers.slide).not.toHaveProperty('soundMissing');
    expect(again.engine.current.layers.audio).toMatchObject({ mediaId: 'tune' });
  });

  it('a slide with two sound cues (an import can give it two) is read by the last, the one that always played', () => {
    const { engine, source } = sounds();
    source.set(
      'twice',
      [textSlide('w1', 'One'), textSlide('w2', 'Two'), textSlide('w3', 'Three')],
      [[], [HYMN, TUNE], [TUNE, HYMN]],
    );
    // The last is there: it plays, and nothing is said.
    engine.dispatch(goLive('twice', 1));
    expect(engine.current.layers.audio).toMatchObject({ mediaId: 'tune' });
    expect(engine.current.layers.slide).not.toHaveProperty('soundMissing');
    // The last is missing: the sound stays as it was (the first never plays instead), and it is named.
    engine.dispatch({ type: 'clearLayer', layer: 'audio' });
    engine.dispatch({ type: 'next' });
    expect(engine.current.layers.slide).toMatchObject({
      slideIndex: 2,
      soundMissing: 'Placeholder hymn.wav',
    });
    expect(engine.current.layers.audio).toBeNull();
  });
});

// Session 54 (Session 53's question 3): Simple Mode's Next named a missing background file, never a missing sound.
describe('what Next shows of a slide’s sound file that is missing (Session 54)', () => {
  it('names it, as it names a missing background file; never a sound that is there, nor for a slide with none', () => {
    const { engine } = sounds();
    // The slide after this one names the missing hymn.
    engine.dispatch(goLive('sounds', 1));
    expect(engine.current.next).toMatchObject({
      kind: 'slide',
      slideIndex: 2,
      soundMissing: 'Placeholder hymn.wav',
    });
    // Up, it says so (LIVE); and Next goes on to a slide whose sound is there, naming none.
    engine.dispatch({ type: 'next' });
    expect(engine.current.layers.slide).toMatchObject({
      slideIndex: 2,
      soundMissing: 'Placeholder hymn.wav',
    });
    expect(engine.current.next).toMatchObject({ kind: 'slide', slideIndex: 3 });
    expect(engine.current.next).not.toHaveProperty('soundMissing');
    // Nor for a slide with no sound.
    engine.dispatch(goLive('sounds', 0));
    expect(engine.current.next).toMatchObject({ kind: 'slide', slideIndex: 1 });
    expect(engine.current.next).not.toHaveProperty('soundMissing');
  });

  it('names it no more once it is found, as the library reads it there', () => {
    const { engine, setSounds } = sounds();
    engine.dispatch(goLive('sounds', 1));
    expect(engine.current.next).toMatchObject({ slideIndex: 2, soundMissing: 'Placeholder hymn.wav' });
    // Find missing media…: the library reads it there, and what comes next is read again.
    setSounds([[TUNE], [], [HYMN_FOUND], [BELL]]);
    engine.refreshNext();
    expect(engine.current.next).toMatchObject({ kind: 'slide', slideIndex: 2 });
    expect(engine.current.next).not.toHaveProperty('soundMissing');
  });

  it('names no sound that is the one playing, and reads a slide with two sound cues by the last, the one that plays', () => {
    const { engine, source, setSounds } = sounds();
    engine.dispatch(goLive('sounds', 0));
    // Deleted from the library while it plays (it plays on): the slide after, naming it, carries it on.
    const deleted = { ...TUNE, missing: true };
    setSounds([[deleted], [deleted], [HYMN], [BELL]]);
    engine.refreshNext();
    expect(engine.current.next).toMatchObject({ kind: 'slide', slideIndex: 1 });
    expect(engine.current.next).not.toHaveProperty('soundMissing');
    // Two sound cues (an import can give a slide two): the last is there, so nothing is named...
    source.set(
      'twice',
      [textSlide('w1', 'One'), textSlide('w2', 'Two'), textSlide('w3', 'Three')],
      [[], [HYMN, BELL], [BELL, HYMN]],
    );
    engine.dispatch(goLive('twice', 0));
    expect(engine.current.next).toMatchObject({ kind: 'slide', slideIndex: 1 });
    expect(engine.current.next).not.toHaveProperty('soundMissing');
    // ...and the last is missing: it is named, the first never playing instead.
    engine.dispatch({ type: 'next' });
    expect(engine.current.layers.audio).toMatchObject({ mediaId: 'bell' });
    expect(engine.current.next).toMatchObject({
      kind: 'slide',
      slideIndex: 2,
      soundMissing: 'Placeholder hymn.wav',
    });
  });
});

// Session 54 review: what Next said of a file deleted while it played stayed as it was when the show last moved, so a
// sound or background cleared since (or music in the sound's place) left the next slide's missing file unsaid.
describe('what Next says of a missing file follows what is up (Session 54 review)', () => {
  it('names the next slide’s sound once the sound that carried it on goes: cleared, or music in its place', () => {
    const deleted = { ...TUNE, missing: true };
    for (const takeOff of [
      { type: 'clearLayer', layer: 'audio' },
      { type: 'playMusic', music: MUSIC, index: 0 },
    ] as const satisfies readonly EngineCommand[]) {
      const { engine, setSounds } = sounds();
      engine.dispatch(goLive('sounds', 0));
      // Deleted while it plays: the slide after, naming it, carries it on, so nothing is said of it.
      setSounds([[deleted], [deleted], [HYMN], [BELL]]);
      engine.refreshNext();
      expect(engine.current.next).toMatchObject({ kind: 'slide', slideIndex: 1 });
      expect(engine.current.next).not.toHaveProperty('soundMissing');
      // It goes: the slide after would put nothing up for it, and says so.
      engine.dispatch(takeOff);
      expect(engine.current.layers.audio?.mediaId ?? null).not.toBe('tune');
      expect(engine.current.next).toMatchObject({
        kind: 'slide',
        slideIndex: 1,
        soundMissing: 'Placeholder tune.wav',
      });
    }
  });

  it('names the next slide’s background file once the background that carried it on goes: cleared, or another in its place', () => {
    const deleted = { ...LOOP, missing: true };
    for (const takeOff of [
      { type: 'clearLayer', layer: 'background' },
      { type: 'setBackground', background: { kind: 'color', color: '#203040' } },
    ] as const satisfies readonly EngineCommand[]) {
      const { engine, source } = show();
      source.set('loops', [textSlide('l1', 'One'), textSlide('l2', 'Two')], [[LOOP], [deleted]]);
      engine.dispatch(goLive('loops', 0));
      expect(engine.current.next).toMatchObject({ kind: 'slide', slideIndex: 1 });
      expect(engine.current.next).not.toHaveProperty('fileMissing');
      engine.dispatch(takeOff);
      expect(engine.current.next).toMatchObject({
        kind: 'slide',
        slideIndex: 1,
        fileMissing: 'Placeholder loop.mp4',
      });
    }
  });
});

describe('a playlist item whose file is missing (unchanged)', () => {
  it('says so, and Next goes past it', () => {
    const { engine } = show();
    expect(engine.dispatch({ type: 'playItem', playlistId: 'sunday', itemId: 'i-gone' })).toEqual({
      ok: false,
      error: 'not-playable',
      message: 'The file for “Placeholder gone.mov” is missing',
    });
    engine.dispatch({ type: 'playItem', playlistId: 'sunday', itemId: 'i-p2' });
    expect(engine.current.next).toMatchObject({ kind: 'slide', presentationId: 'p1', itemId: 'i-p1' });
    engine.dispatch({ type: 'next' });
    expect(engine.current.live).toMatchObject({
      presentationId: 'p1',
      playlist: { playlistId: 'sunday', itemId: 'i-p1' },
    });
  });
});
