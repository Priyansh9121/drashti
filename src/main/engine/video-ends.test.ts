import { describe, expect, it } from 'vitest';
import type { EngineCommand } from '../../shared/engine/commands';
import { parseEngineCommand } from '../../shared/engine/commands';
import { ENGINE_STATE_VERSION, readsEngineVersion } from '../../shared/engine/state';
import type { WhenEnds } from '../../shared/wallpapers';
import { MemoryPlaylistSource } from './playlist-source';
import { ShowEngine } from './show-engine';
import { makeSource, RecordingTransport, textSlide } from './testing';

/*
 * Session 55, Part 6. The chosen wallpaper in the engine's state (18): set by the main process alone, from when it was
 * chosen, never a change to the show; its pictures carry their looks. And when a video ends (A), as its playlist row
 * says: the chosen wallpaper (the default: the video goes, so nothing is up; with none chosen its last picture stays,
 * as before), the next row, the video again (Loop), or its last picture (Freeze); a paused video waits, and one moved
 * by the time bar ends at its new time. Placeholder names and media ids only.
 */

const LENGTHS: Record<string, number> = { clip: 10_000, last: 6_000 };

function setup(whenEnds?: WhenEnds) {
  const source = makeSource();
  source.set('words', [textSlide('w1', 'Placeholder one')]);
  const playlists = new MemoryPlaylistSource();
  playlists.set('pl', [
    {
      id: 'i-clip',
      kind: 'media',
      mediaId: 'clip',
      media: 'video',
      label: 'Placeholder clip',
      ...(whenEnds ? { whenEnds } : {}),
    },
    { id: 'i-pic', kind: 'media', mediaId: 'pic', media: 'image', label: 'Placeholder picture' },
    { id: 'i-words', kind: 'presentation', presentationId: 'words', arrangementId: undefined },
    {
      id: 'i-last',
      kind: 'media',
      mediaId: 'last',
      media: 'video',
      label: 'Placeholder last',
      ...(whenEnds ? { whenEnds } : {}),
    },
  ]);
  let clock = 1_000_000;
  const jobs: { at: number; run: () => void; cancelled: boolean }[] = [];
  const engine = new ShowEngine(source, new RecordingTransport(), () => clock, playlists, {
    mediaLength: (id) => LENGTHS[id] ?? null,
    mediaKind: (id) => (id === 'pic' || id.startsWith('wall') ? 'image' : 'video'),
    pictureLook: (id) => (id === 'wall-a' ? { brightness: 10 } : null) as never,
    schedule: (delay, run) => {
      const job = { at: clock + delay, run, cancelled: false };
      jobs.push(job);
      return () => {
        job.cancelled = true;
      };
    },
  });
  const elapse = (ms: number) => {
    const end = clock + ms;
    for (;;) {
      const next = jobs.filter((j) => !j.cancelled && j.at <= end).sort((x, y) => x.at - y.at)[0];
      if (!next) break;
      jobs.splice(jobs.indexOf(next), 1);
      clock = Math.max(clock, next.at);
      next.run();
    }
    clock = end;
  };
  return { engine, elapse, now: () => clock, playlists };
}

/** The clip's row and a picture's, the clip's When it ends as given (changed while it plays). */
const rowsWith = (playlists: MemoryPlaylistSource, whenEnds: WhenEnds | undefined) => {
  playlists.set('pl', [
    {
      id: 'i-clip',
      kind: 'media',
      mediaId: 'clip',
      media: 'video',
      label: 'Placeholder clip',
      ...(whenEnds ? { whenEnds } : {}),
    },
    { id: 'i-pic', kind: 'media', mediaId: 'pic', media: 'image', label: 'Placeholder picture' },
  ]);
};

const WALL = {
  id: 'w1',
  name: 'Placeholder wall',
  pictures: ['wall-a', 'wall-b'],
  secondsEach: 8,
  fadeMs: 1000,
};
const playItem = (itemId: string): EngineCommand => ({ type: 'playItem', playlistId: 'pl', itemId });
const background = (e: ShowEngine) => {
  const bg = e.current.layers.background;
  return bg?.kind === 'media' ? bg : null;
};

describe('the chosen wallpaper in the engine’s state (engine state 18)', () => {
  it('is set by the main process alone, from when it was chosen; the same again is no change, and none is null', () => {
    const { engine, now, elapse } = setup();
    // 18 then (Part 6); 23 now (Part 17a), which still reads 22, 20, 18 and 17 whole (each only adds to 16).
    // 26 now (Part 10, live captions), only adding to 23.
    expect(ENGINE_STATE_VERSION).toBe(26);
    expect([26, 25, 24, 23, 22, 20, 18, 17, 16, 15, 14, 13, 12].every((v) => readsEngineVersion(v))).toBe(
      true,
    );
    expect(engine.current.chosenWallpaper ?? null).toBeNull();
    expect(engine.setChosenWallpaper(WALL)).toMatchObject({ ok: true, changed: true });
    expect(engine.current.chosenWallpaper).toEqual({ ...WALL, since: now() });
    // Its pictures carry their looks, as a picture up does.
    expect(engine.current.pictures['wall-a']).toEqual({ brightness: 10 });
    elapse(5_000);
    expect(engine.setChosenWallpaper(WALL)).toMatchObject({ ok: true, changed: false });
    // Changed (another picture, other seconds): from now.
    engine.setChosenWallpaper({ ...WALL, secondsEach: 4 });
    expect(engine.current.chosenWallpaper).toMatchObject({ secondsEach: 4, since: now() });
    engine.setChosenWallpaper(null);
    expect(engine.current.chosenWallpaper).toBeNull();
  });

  it('is no change to the show: Oops, Back and Put it back are as they were', () => {
    const { engine } = setup();
    engine.dispatch(playItem('i-words'));
    const oops = engine.current.canOops;
    engine.dispatch({ type: 'clearAll' });
    expect(engine.current.canPutBack).toBe(true);
    engine.setChosenWallpaper(WALL);
    expect(engine.current.canPutBack).toBe(true);
    expect(engine.current.canOops).toBe(true);
    expect(oops).toBe(true);
  });

  it('is never a command a page or a phone can send', () => {
    expect(parseEngineCommand({ type: 'setChosenWallpaper', wallpaper: WALL }).ok).toBe(false);
  });
});

describe('when a video ends', () => {
  it('Wallpaper (the default): at its end it goes, so the chosen wallpaper shows; its row stays where the show is', () => {
    const { engine, elapse } = setup();
    engine.setChosenWallpaper(WALL);
    engine.dispatch(playItem('i-clip'));
    expect(background(engine)).toMatchObject({ mediaId: 'clip', loop: false });
    elapse(9_900);
    expect(background(engine)?.mediaId).toBe('clip');
    elapse(200);
    expect(engine.current.layers.background).toBeNull();
    expect(engine.current.live.playlist).toEqual({ playlistId: 'pl', itemId: 'i-clip' });
    // Next goes on from it.
    engine.dispatch({ type: 'next' });
    expect(engine.current.live.playlist?.itemId).toBe('i-pic');
  });

  it('Wallpaper with none chosen: its last picture stays, as before', () => {
    const { engine, elapse } = setup();
    engine.dispatch(playItem('i-clip'));
    elapse(30_000);
    expect(background(engine)?.mediaId).toBe('clip');
    // Chosen while it is held there: the wallpaper, then.
    engine.setChosenWallpaper(WALL);
    elapse(10);
    expect(engine.current.layers.background).toBeNull();
  });

  it('Next item: at its end the next row goes up; at the playlist’s end, the wallpaper', () => {
    const { engine, elapse } = setup('next');
    engine.setChosenWallpaper(WALL);
    engine.dispatch(playItem('i-clip'));
    elapse(10_100);
    expect(engine.current.live.playlist?.itemId).toBe('i-pic');
    expect(background(engine)?.mediaId).toBe('pic');
    // The last row: nothing after it, so the wallpaper.
    engine.dispatch(playItem('i-last'));
    elapse(6_100);
    expect(engine.current.layers.background).toBeNull();
    expect(engine.current.live.playlist?.itemId).toBe('i-last');
  });

  it('Loop: it goes round between its points, never ending', () => {
    const { engine, elapse } = setup('loop');
    engine.setChosenWallpaper(WALL);
    engine.dispatch(playItem('i-clip'));
    expect(background(engine)).toMatchObject({ mediaId: 'clip', loop: true });
    elapse(45_000);
    expect(background(engine)?.mediaId).toBe('clip');
  });

  it('Freeze: its last picture stays, even with a wallpaper chosen', () => {
    const { engine, elapse } = setup('freeze');
    engine.setChosenWallpaper(WALL);
    engine.dispatch(playItem('i-clip'));
    expect(background(engine)).toMatchObject({ mediaId: 'clip', loop: false });
    elapse(30_000);
    expect(background(engine)?.mediaId).toBe('clip');
  });

  it('a paused video waits; played on, it ends when its time is up; moved by the time bar, at its new time', () => {
    const { engine, elapse } = setup();
    engine.setChosenWallpaper(WALL);
    engine.dispatch(playItem('i-clip'));
    elapse(3_000);
    engine.dispatch({ type: 'pausePlaying', playing: { layer: 'background' } });
    elapse(60_000);
    expect(background(engine)?.mediaId).toBe('clip');
    engine.dispatch({ type: 'resumePlaying', playing: { layer: 'background' } });
    elapse(6_900);
    expect(background(engine)?.mediaId).toBe('clip');
    elapse(200);
    expect(engine.current.layers.background).toBeNull();
    // Moved near its end: it ends that much sooner.
    engine.dispatch(playItem('i-clip'));
    engine.dispatch({ type: 'moveTo', playing: { layer: 'background' }, toMs: 9_000 });
    elapse(900);
    expect(background(engine)?.mediaId).toBe('clip');
    elapse(200);
    expect(engine.current.layers.background).toBeNull();
  });

  it('its row changed while it plays: Loop goes round from where it is; back to Wallpaper, it ends at its end', () => {
    const { engine, elapse, now, playlists } = setup();
    const setRows = (whenEnds: WhenEnds | undefined) => {
      rowsWith(playlists, whenEnds);
    };
    engine.setChosenWallpaper(WALL);
    engine.dispatch(playItem('i-clip'));
    elapse(4_000);
    setRows('loop');
    engine.refreshEnds();
    expect(background(engine)).toMatchObject({ loop: true, seek: { at: now(), toMs: 4_000 } });
    elapse(30_000);
    expect(background(engine)?.mediaId).toBe('clip');
    // Back to the default: from where it is (4 s into a round, 34 s on), to its end.
    setRows(undefined);
    engine.refreshEnds();
    expect(background(engine)).toMatchObject({ loop: false, seek: { at: now(), toMs: 4_000 } });
    elapse(5_900);
    expect(background(engine)?.mediaId).toBe('clip');
    elapse(200);
    expect(engine.current.layers.background).toBeNull();
  });

  it('a slide up over the video keeps it: something is up', () => {
    const { engine, elapse } = setup();
    engine.setChosenWallpaper(WALL);
    engine.dispatch({
      type: 'setBackground',
      background: { kind: 'media', mediaId: 'clip', media: 'video', fit: 'fit', loop: false },
    });
    engine.dispatch({ type: 'goLive', presentationId: 'words', slideIndex: 0 });
    expect(engine.current.layers.slide).not.toBeNull();
    elapse(30_000);
    expect(background(engine)?.mediaId).toBe('clip');
  });
});
