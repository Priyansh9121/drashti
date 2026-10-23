import { describe, expect, it } from 'vitest';
import type { EngineCommand } from '../../shared/engine/commands';
import type { BackgroundCue } from '../../shared/library';
import { MemoryPlaylistSource } from './playlist-source';
import { ShowEngine } from './show-engine';
import type { MemorySlideSource } from './slide-source';
import { makeSource, RecordingTransport, textSlide } from './testing';

/*
 * A slide's background cue whose file is missing (Session 52): not found at import, or deleted from the library,
 * as the library reads it (db/presentations.ts cueFromRow). It goes as a video input this computer has none of
 * does (Session 51): the background stays as it was, never black because of it, and the slide names the file for
 * LIVE to say why. Placeholder names only.
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
