import { describe, expect, it } from 'vitest';
import type { EngineCommand } from '../../shared/engine/commands';
import { parseEngineCommand } from '../../shared/engine/commands';
import { EngineMirror } from '../../shared/engine/mirror';
import type { EnginePatchMessage } from '../../shared/engine/protocol';
import type { MediaBackground } from '../../shared/engine/state';
import { ENGINE_STATE_VERSION, LAYER_NAMES } from '../../shared/engine/state';
import type { SlideCue } from '../../shared/library';
import { MemoryPlaylistSource } from './playlist-source';
import { ShowEngine } from './show-engine';
import { makeSource, RecordingTransport, textSlide } from './testing';

function setup() {
  const source = makeSource();
  const transport = new RecordingTransport();
  let clock = 1000;
  const engine = new ShowEngine(source, transport, () => ++clock);
  return { source, transport, engine };
}

const goLive = (presentationId: string, slideIndex: number): EngineCommand => ({
  type: 'goLive',
  presentationId,
  slideIndex,
});

describe('ShowEngine', () => {
  it('starts at revision 0 with an empty snapshot', () => {
    const { engine, transport } = setup();
    const snap = engine.snapshot();
    expect(snap).toMatchObject({ kind: 'snapshot', version: ENGINE_STATE_VERSION, rev: 0 });
    expect(snap.state.layers.slide).toBeNull();
    expect(transport.messages).toHaveLength(0);
  });

  describe('goLive', () => {
    it('shows the slide and broadcasts one patch', () => {
      const { engine, transport } = setup();
      expect(engine.dispatch(goLive('p1', 1))).toEqual({ ok: true, changed: true, rev: 1 });
      expect(engine.current.live).toEqual({
        presentationId: 'p1',
        slideIndex: 1,
        slideCount: 3,
        arrangementId: null,
        playlist: null,
      });
      expect(engine.current.layers.slide?.slide).toEqual(textSlide('p1s2', 'Two'));
      const patch = transport.last as EnginePatchMessage;
      expect(patch).toMatchObject({ kind: 'patch', version: ENGINE_STATE_VERSION, baseRev: 0, rev: 1 });
      // What Next shows comes in the same patch.
      expect(patch.ops.map((o) => o.path.join('.')).sort()).toEqual(['layers.slide', 'live', 'next']);
      expect(patch.ops.find((o) => o.path[0] === 'live')?.value).toEqual(engine.current.live);
      expect(engine.current.next).toMatchObject({ kind: 'slide', presentationId: 'p1', slideIndex: 2 });
    });

    it('rejects an unknown presentation without broadcasting', () => {
      const { engine, transport } = setup();
      expect(engine.dispatch(goLive('nope', 0))).toMatchObject({ ok: false, error: 'unknown-presentation' });
      expect(transport.messages).toHaveLength(0);
      expect(engine.rev).toBe(0);
    });

    it('rejects a slide index past the end', () => {
      const { engine } = setup();
      expect(engine.dispatch(goLive('p1', 3))).toMatchObject({ ok: false, error: 'slide-out-of-range' });
      expect(engine.dispatch(goLive('empty', 0))).toMatchObject({ ok: false, error: 'slide-out-of-range' });
    });

    it('does not broadcast when the same slide is already live', () => {
      const { engine, transport } = setup();
      engine.dispatch(goLive('p1', 0));
      expect(engine.dispatch(goLive('p1', 0))).toEqual({ ok: true, changed: false, rev: 1 });
      expect(transport.messages).toHaveLength(1);
    });

    it('switches presentations', () => {
      const { engine } = setup();
      engine.dispatch(goLive('p1', 2));
      engine.dispatch(goLive('p2', 0));
      expect(engine.current.live).toEqual({
        presentationId: 'p2',
        slideIndex: 0,
        slideCount: 1,
        arrangementId: null,
        playlist: null,
      });
    });
  });

  describe('next and previous', () => {
    it('need something live', () => {
      const { engine } = setup();
      expect(engine.dispatch({ type: 'next' })).toMatchObject({ ok: false, error: 'nothing-live' });
      expect(engine.dispatch({ type: 'previous' })).toMatchObject({ ok: false, error: 'nothing-live' });
    });

    it('move one slide at a time', () => {
      const { engine } = setup();
      engine.dispatch(goLive('p1', 0));
      engine.dispatch({ type: 'next' });
      expect(engine.current.live.slideIndex).toBe(1);
      engine.dispatch({ type: 'next' });
      expect(engine.current.layers.slide?.slide.id).toBe('p1s3');
      engine.dispatch({ type: 'previous' });
      expect(engine.current.live.slideIndex).toBe(1);
    });

    it('stay put at either end', () => {
      const { engine, transport } = setup();
      engine.dispatch(goLive('p1', 2));
      expect(engine.dispatch({ type: 'next' })).toEqual({ ok: true, changed: false, rev: 1 });
      engine.dispatch(goLive('p1', 0));
      expect(engine.dispatch({ type: 'previous' })).toEqual({ ok: true, changed: false, rev: 2 });
      expect(transport.messages).toHaveLength(2);
    });

    it('continue from the cursor after the slide was cleared', () => {
      const { engine } = setup();
      engine.dispatch(goLive('p1', 0));
      engine.dispatch({ type: 'clearLayer', layer: 'slide' });
      expect(engine.current.layers.slide).toBeNull();
      engine.dispatch({ type: 'next' });
      expect(engine.current.layers.slide?.slideIndex).toBe(1);
    });

    it('cope with a presentation that got shorter', () => {
      const { engine, source } = setup();
      engine.dispatch(goLive('p1', 2));
      source.set('p1', [textSlide('a', 'A')]);
      expect(engine.dispatch({ type: 'next' })).toMatchObject({ ok: true, changed: false });
      engine.dispatch({ type: 'previous' });
      expect(engine.current.live).toEqual({
        presentationId: 'p1',
        slideIndex: 0,
        slideCount: 1,
        arrangementId: null,
        playlist: null,
      });
    });

    it('report a presentation that was deleted', () => {
      const { engine, source, transport } = setup();
      engine.dispatch(goLive('p2', 0));
      source.delete('p2');
      expect(engine.dispatch({ type: 'next' })).toMatchObject({ ok: false, error: 'unknown-presentation' });
      expect(engine.dispatch({ type: 'previous' })).toMatchObject({
        ok: false,
        error: 'unknown-presentation',
      });
      expect(transport.messages).toHaveLength(1);
    });

    it('do nothing on an empty presentation', () => {
      const { engine, source } = setup();
      engine.dispatch(goLive('p2', 0));
      source.set('p2', []);
      expect(engine.dispatch({ type: 'next' })).toMatchObject({ ok: true, changed: false });
    });
  });

  describe('clear actions', () => {
    function populated() {
      const s = setup();
      const commands: EngineCommand[] = [
        goLive('p1', 0),
        { type: 'playAudio', audio: { id: 'a', title: 'Dhun', mediaId: null, volume: 1, loop: false } },
        { type: 'setBackground', background: { kind: 'color', color: '#202020' } },
        { type: 'showProp', prop: { id: 'logo', name: 'Logo', elements: [] } },
        { type: 'showMessage', message: { id: 'm', text: 'Welcome' } },
        { type: 'setMask', mask: { id: 'k', name: 'Mask', visible: { x: 0, y: 0, width: 10, height: 10 } } },
      ];
      for (const c of commands) s.engine.dispatch(c);
      return s;
    }

    it.each(LAYER_NAMES)('clearLayer %s empties that layer only, in one patch', (layer) => {
      const { engine, transport } = populated();
      const before = engine.current;
      const result = engine.dispatch({ type: 'clearLayer', layer });
      expect(result).toMatchObject({ ok: true, changed: true });
      const value = engine.current.layers[layer];
      expect(Array.isArray(value) ? value : value === null ? [] : ['not cleared']).toEqual([]);
      for (const other of LAYER_NAMES)
        if (other !== layer) expect(engine.current.layers[other]).toBe(before.layers[other]);
      const patch = transport.last as EnginePatchMessage;
      expect(patch.ops).toEqual([{ path: ['layers', layer], value: Array.isArray(value) ? [] : null }]);
    });

    it.each(LAYER_NAMES)('clearLayer %s on an empty layer changes nothing', (layer) => {
      const { engine, transport } = setup();
      expect(engine.dispatch({ type: 'clearLayer', layer })).toEqual({ ok: true, changed: false, rev: 0 });
      expect(transport.messages).toHaveLength(0);
    });

    it('clearAll empties every layer, keeps the cursor, and sends one patch', () => {
      const { engine, transport } = populated();
      const count = transport.messages.length;
      engine.dispatch({ type: 'clearAll' });
      expect(engine.current.layers).toEqual({
        audio: null,
        background: null,
        slide: null,
        props: [],
        messages: [],
        masks: null,
      });
      expect(engine.current.live.presentationId).toBe('p1');
      expect(transport.messages).toHaveLength(count + 1);
    });
  });

  describe('arrangements (the order slides play in)', () => {
    /** Slides: 0 verse, 1 chorus, 2 verse two. "usual" repeats the chorus; the presentation is set to "usual". */
    function arranged() {
      const s = setup();
      s.source.set(
        'song',
        [textSlide('v1', 'Verse'), textSlide('ch', 'Chorus'), textSlide('v2', 'Verse two')],
        [],
        { arrangements: { usual: [0, 1, 2, 1], short: [1] }, selected: 'usual' },
      );
      return s;
    }
    const texts = (engine: ShowEngine) => {
      const el = engine.current.layers.slide?.slide.elements[0];
      return el?.kind === 'text' ? el.text : '';
    };

    it("plays the presentation's own order, the repeated chorus included, when none is named", () => {
      const { engine } = arranged();
      engine.dispatch(goLive('song', 0));
      expect(engine.current.live).toMatchObject({ slideCount: 4, arrangementId: 'usual' });
      const seen = [texts(engine)];
      for (let i = 0; i < 4; i++) {
        engine.dispatch({ type: 'next' });
        seen.push(texts(engine));
      }
      // The last Next stays put.
      expect(seen).toEqual(['Verse', 'Chorus', 'Verse two', 'Chorus', 'Chorus']);
      engine.dispatch({ type: 'previous' });
      expect([texts(engine), engine.current.live.slideIndex]).toEqual(['Verse two', 2]);
    });

    it('plays the order it is given: another arrangement, or every slide', () => {
      const { engine } = arranged();
      engine.dispatch({ type: 'goLive', presentationId: 'song', slideIndex: 0, arrangementId: null });
      expect(engine.current.live).toMatchObject({ slideCount: 3, arrangementId: null });
      engine.dispatch({ type: 'goLive', presentationId: 'song', slideIndex: 0, arrangementId: 'short' });
      expect([texts(engine), engine.current.live.slideCount]).toEqual(['Chorus', 1]);
      // An arrangement it does not have: every slide.
      engine.dispatch({ type: 'goLive', presentationId: 'song', slideIndex: 2, arrangementId: 'gone' });
      expect(engine.current.live).toMatchObject({ slideIndex: 2, slideCount: 3, arrangementId: null });
    });

    it('keeps the slide on screen when the operator changes the order, and Next follows the new one', () => {
      const { engine, source, transport } = arranged();
      engine.dispatch(goLive('song', 3)); // the second chorus
      const shownAt = engine.current.layers.slide?.shownAt;
      source.set(
        'song',
        [textSlide('v1', 'Verse'), textSlide('ch', 'Chorus'), textSlide('v2', 'Verse two')],
        [],
        {
          arrangements: { usual: [0, 1, 2, 1], short: [1] },
          selected: null,
        },
      );
      const before = transport.messages.length;
      engine.reorderLive('song');
      expect(engine.current.live).toMatchObject({ slideIndex: 1, slideCount: 3, arrangementId: null });
      // Same slide, same playback: only the position moved.
      expect(engine.current.layers.slide?.shownAt).toBe(shownAt);
      expect(transport.messages).toHaveLength(before + 1);
      engine.dispatch({ type: 'next' });
      expect(texts(engine)).toBe('Verse two');
      // Another presentation's change does nothing.
      expect(engine.reorderLive('other')).toMatchObject({ changed: false });
    });

    it('comes back after a restart in the order it was played', () => {
      const { engine } = arranged();
      engine.restore({
        slide: { presentationId: 'song', slideIndex: 3, arrangementId: 'usual' },
        background: null,
        blackout: false,
      });
      expect([texts(engine), engine.current.live.arrangementId]).toEqual(['Chorus', 'usual']);
      engine.dispatch({ type: 'previous' });
      expect(texts(engine)).toBe('Verse two');
    });
  });

  describe('background cues (PLAN.md 4.3)', () => {
    const video = (mediaId: string, extra: Partial<MediaBackground> = {}): MediaBackground => ({
      kind: 'media',
      mediaId,
      media: 'video',
      fit: 'fill',
      loop: true,
      ...extra,
    });
    const cue = (background: MediaBackground): SlideCue => ({
      kind: 'background',
      label: '',
      name: `${background.mediaId}.mp4`,
      missing: false,
      unplayable: null,
      background,
    });

    /** bg: 0 video A, 1 text only, 2 video A again (drawn to fit), 3 image B, 4 text only. The clock moves on 1 s per command. */
    function withBackgrounds() {
      const source = makeSource();
      const transport = new RecordingTransport();
      const clock = { now: 1000 };
      const engine = new ShowEngine(source, transport, () => clock.now);
      const s = {
        source,
        transport,
        engine: {
          get current() {
            return engine.current;
          },
          dispatch(command: EngineCommand) {
            clock.now += 1000;
            return engine.dispatch(command);
          },
        },
      };
      s.source.set(
        'bg',
        ['a', 'b', 'c', 'd', 'e'].map((n) => textSlide(`bg-${n}`, n)),
        [
          [cue(video('A'))],
          [],
          [cue(video('A', { fit: 'fit' }))],
          [cue({ kind: 'media', mediaId: 'B', media: 'image', fit: 'fit', loop: false })],
          [],
        ],
      );
      return s;
    }

    it('puts a slide background on the background layer, with its start time, in the same patch as the slide', () => {
      const { engine, transport } = withBackgrounds();
      engine.dispatch(goLive('bg', 0));
      expect(engine.current.layers.background).toEqual({ ...video('A'), startedAt: 2000 });
      const patch = transport.last as EnginePatchMessage;
      expect(patch.ops.map((o) => o.path.join('.')).sort()).toEqual([
        'layers.background',
        'layers.slide',
        'live',
        'next',
      ]);
    });

    it('keeps the background (and its start time) through slides without one of their own', () => {
      const { engine, transport } = withBackgrounds();
      engine.dispatch(goLive('bg', 0));
      const background = engine.current.layers.background;
      engine.dispatch({ type: 'next' });
      expect(engine.current.layers.background).toBe(background);
      const patch = transport.last as EnginePatchMessage;
      expect(patch.ops.some((o) => o.path[1] === 'background')).toBe(false);
      // Another presentation's text slide keeps it too.
      engine.dispatch(goLive('p1', 2));
      expect(engine.current.layers.background).toBe(background);
    });

    it('lets the same file carry on instead of restarting, even when it is drawn differently', () => {
      const { engine } = withBackgrounds();
      engine.dispatch(goLive('bg', 0));
      engine.dispatch({ type: 'next' });
      engine.dispatch({ type: 'next' });
      expect(engine.current.layers.background).toEqual({ ...video('A', { fit: 'fit' }), startedAt: 2000 });
      // Going live on its first slide again changes nothing but the fit: still the same playback.
      engine.dispatch(goLive('bg', 0));
      expect(engine.current.layers.background).toEqual({ ...video('A'), startedAt: 2000 });
    });

    it('replaces the background when a slide brings a different file', () => {
      const { engine } = withBackgrounds();
      engine.dispatch(goLive('bg', 0));
      engine.dispatch(goLive('bg', 3));
      expect(engine.current.layers.background).toEqual({
        kind: 'media',
        mediaId: 'B',
        media: 'image',
        fit: 'fit',
        loop: false,
        startedAt: 3000,
      });
    });

    it('Clear background removes it and leaves the text; it comes back only from a slide that has it', () => {
      const { engine } = withBackgrounds();
      engine.dispatch(goLive('bg', 0));
      const slide = engine.current.layers.slide;
      engine.dispatch({ type: 'clearLayer', layer: 'background' });
      expect(engine.current.layers.background).toBeNull();
      expect(engine.current.layers.slide).toBe(slide);
      engine.dispatch({ type: 'next' });
      expect(engine.current.layers.background).toBeNull();
      // A slide with the background starts it again, from the beginning.
      engine.dispatch({ type: 'next' });
      expect(engine.current.layers.background).toMatchObject({ mediaId: 'A', startedAt: 5000 });
    });

    it('never changes the background when the slide cannot go live', () => {
      const { engine } = withBackgrounds();
      engine.dispatch(goLive('bg', 3));
      const background = engine.current.layers.background;
      expect(engine.dispatch(goLive('bg', 9))).toMatchObject({ ok: false });
      engine.dispatch(goLive('bg', 4));
      expect(engine.dispatch({ type: 'next' })).toMatchObject({ ok: true, changed: false });
      expect(engine.current.layers.background).toBe(background);
    });

    it('treats a background the operator sets the same way: the same file carries on, a colour replaces it', () => {
      const { engine } = withBackgrounds();
      engine.dispatch(goLive('bg', 0));
      engine.dispatch({ type: 'setBackground', background: video('A', { loop: false }) });
      expect(engine.current.layers.background).toEqual({ ...video('A', { loop: false }), startedAt: 2000 });
      engine.dispatch({ type: 'setBackground', background: { kind: 'color', color: '#101010' } });
      expect(engine.current.layers.background).toEqual({ kind: 'color', color: '#101010' });
      engine.dispatch({ type: 'setBackground', background: video('A') });
      expect(engine.current.layers.background).toMatchObject({ mediaId: 'A', startedAt: 5000 });
    });
  });

  describe('audio cues', () => {
    const tone = (mediaId: string, extra: Partial<Extract<SlideCue, { kind: 'audio' }>> = {}): SlideCue => ({
      kind: 'audio',
      label: `Placeholder ${mediaId}`,
      name: `${mediaId}.mp3`,
      missing: false,
      unplayable: null,
      mediaId,
      volume: 0.8,
      loop: true,
      ...extra,
    });

    /** au: 0 tone A, 1 no sound, 2 tone A again (quieter), 3 tone B once. The clock moves on 1 s per command. */
    function withAudio() {
      const source = makeSource();
      const clock = { now: 1000 };
      const engine = new ShowEngine(source, new RecordingTransport(), () => clock.now);
      source.set(
        'au',
        ['a', 'b', 'c', 'd'].map((n) => textSlide(`au-${n}`, n)),
        [[tone('A')], [], [tone('A', { volume: 0.3 })], [tone('B', { loop: false, label: '' })]],
      );
      const dispatch = (command: EngineCommand) => {
        clock.now += 1000;
        return engine.dispatch(command);
      };
      return { engine, dispatch };
    }

    it('plays on the audio layer with the cue volume and looping, and stays through slides without sound', () => {
      const { engine, dispatch } = withAudio();
      dispatch(goLive('au', 0));
      expect(engine.current.layers.audio).toEqual({
        id: 'A',
        title: 'Placeholder A',
        mediaId: 'A',
        volume: 0.8,
        loop: true,
        startedAt: 2000,
      });
      dispatch({ type: 'next' });
      expect(engine.current.layers.audio).toMatchObject({ mediaId: 'A', startedAt: 2000 });
    });

    it('lets the same file carry on (with the new volume), and a different file replace it', () => {
      const { engine, dispatch } = withAudio();
      dispatch(goLive('au', 0));
      dispatch(goLive('au', 2));
      expect(engine.current.layers.audio).toMatchObject({ mediaId: 'A', volume: 0.3, startedAt: 2000 });
      dispatch(goLive('au', 3));
      // No label: the file name is the title.
      expect(engine.current.layers.audio).toMatchObject({
        mediaId: 'B',
        title: 'B.mp3',
        loop: false,
        startedAt: 4000,
      });
    });

    it('Clear audio stops it and leaves everything else; the next cue starts it again', () => {
      const { engine, dispatch } = withAudio();
      dispatch(goLive('au', 0));
      const slide = engine.current.layers.slide;
      dispatch({ type: 'clearLayer', layer: 'audio' });
      expect(engine.current.layers.audio).toBeNull();
      expect(engine.current.layers.slide).toBe(slide);
      dispatch(goLive('au', 2));
      expect(engine.current.layers.audio).toMatchObject({ mediaId: 'A', startedAt: 4000 });
    });
  });

  describe('playlists (running a sabha)', () => {
    /**
     * "song" plays verse, chorus, verse two, chorus (its own arrangement);
     * the playlist steps over a header, a placeholder and a removed
     * presentation, and has a picture and a sound between the songs.
     */
    function sabha() {
      const source = makeSource();
      source.set(
        'song',
        [textSlide('v1', 'Verse'), textSlide('ch', 'Chorus'), textSlide('v2', 'Verse two')],
        [],
        { arrangements: { usual: [0, 1, 2, 1] }, selected: 'usual' },
      );
      const playlists = new MemoryPlaylistSource();
      playlists.set('sunday', [
        { id: 'h1', kind: 'skip', why: 'A header has nothing to show' },
        { id: 'i-song', kind: 'presentation', presentationId: 'song', arrangementId: undefined },
        { id: 'ph', kind: 'skip', why: '“Missing Song” was not found at import' },
        { id: 'i-pic', kind: 'media', mediaId: 'pic', media: 'image', label: 'Welcome.png' },
        { id: 'i-dhun', kind: 'media', mediaId: 'dhun', media: 'audio', label: 'Dhun.mp3' },
        { id: 'gone', kind: 'skip', why: '“Old Song” is no longer in the library' },
        { id: 'i-p1', kind: 'presentation', presentationId: 'p1', arrangementId: undefined },
        { id: 'i-song-all', kind: 'presentation', presentationId: 'song', arrangementId: null },
      ]);
      const transport = new RecordingTransport();
      let clock = 1000;
      const engine = new ShowEngine(source, transport, () => ++clock, playlists);
      return { engine, source, playlists, transport };
    }
    const text = (engine: ShowEngine) => {
      const el = engine.current.layers.slide?.slide.elements[0];
      return el?.kind === 'text' ? el.text : null;
    };
    const at = (engine: ShowEngine) => engine.current.live.playlist?.itemId ?? null;

    it('plays the items in order: the arrangement, then on past headers and placeholders, pictures and sounds', () => {
      const { engine } = sabha();
      expect(engine.dispatch({ type: 'playItem', playlistId: 'sunday', itemId: 'i-song' })).toMatchObject({
        ok: true,
      });
      const seen: string[] = [`${at(engine)}:${text(engine)}`];
      for (let i = 0; i < 9; i++) {
        engine.dispatch({ type: 'next' });
        const { slide, background, audio } = engine.current.layers;
        seen.push(
          `${at(engine)}:${slide ? text(engine) : '-'}${background?.kind === 'media' ? ` bg=${background.mediaId}` : ''}${audio ? ` ♪${audio.mediaId}` : ''}`,
        );
      }
      expect(seen).toEqual([
        'i-song:Verse',
        'i-song:Chorus',
        'i-song:Verse two',
        'i-song:Chorus',
        // A picture takes the slide off and goes on the background.
        'i-pic:- bg=pic',
        // A sound leaves the picture up.
        'i-dhun:- bg=pic ♪dhun',
        // The next presentation: its first slide (the removed one is stepped over).
        'i-p1:One bg=pic ♪dhun',
        'i-p1:Two bg=pic ♪dhun',
        'i-p1:Three bg=pic ♪dhun',
        // The same song again, as this item asks: every slide in order.
        'i-song-all:Verse bg=pic ♪dhun',
      ]);
      expect(engine.current.live).toMatchObject({
        presentationId: 'song',
        arrangementId: null,
        slideCount: 3,
      });
      engine.dispatch({ type: 'next' });
      engine.dispatch({ type: 'next' });
      // The end of the playlist: Next stays put.
      const last = engine.rev;
      engine.dispatch({ type: 'next' });
      expect([at(engine), text(engine), engine.rev]).toEqual(['i-song-all', 'Verse two', last]);
    });

    it("goes back to the previous item's last slide, stepping over what cannot play", () => {
      const { engine } = sabha();
      engine.dispatch({ type: 'playItem', playlistId: 'sunday', itemId: 'i-p1' });
      engine.dispatch({ type: 'previous' });
      expect(engine.current.live).toMatchObject({ presentationId: null, playlist: { itemId: 'i-dhun' } });
      engine.dispatch({ type: 'previous' });
      expect(at(engine)).toBe('i-pic');
      engine.dispatch({ type: 'previous' });
      // The song's last slide in its own order: the second chorus.
      expect(engine.current.live).toMatchObject({ playlist: { itemId: 'i-song' }, slideIndex: 3 });
      expect(text(engine)).toBe('Chorus');
      engine.dispatch({ type: 'previous' });
      expect(text(engine)).toBe('Verse two');
    });

    it('says what comes next, across items', () => {
      const { engine } = sabha();
      engine.dispatch({ type: 'playItem', playlistId: 'sunday', itemId: 'i-song' });
      expect(engine.current.next).toMatchObject({
        kind: 'slide',
        presentationId: 'song',
        slideIndex: 1,
        itemId: null,
      });
      engine.dispatch({
        type: 'goLive',
        presentationId: 'song',
        slideIndex: 3,
        playlist: { playlistId: 'sunday', itemId: 'i-song' },
      });
      expect(engine.current.next).toEqual({
        kind: 'media',
        itemId: 'i-pic',
        mediaId: 'pic',
        media: 'image',
        label: 'Welcome.png',
      });
      engine.dispatch({ type: 'next' });
      engine.dispatch({ type: 'next' });
      expect(engine.current.next).toMatchObject({
        kind: 'slide',
        presentationId: 'p1',
        slideIndex: 0,
        itemId: 'i-p1',
      });
      engine.dispatch({ type: 'playItem', playlistId: 'sunday', itemId: 'i-song-all' });
      engine.dispatch({
        type: 'goLive',
        presentationId: 'song',
        slideIndex: 2,
        arrangementId: null,
        playlist: { playlistId: 'sunday', itemId: 'i-song-all' },
      });
      expect(engine.current.next).toBeNull();
    });

    it('jumps a whole item with next item and previous item', () => {
      const { engine } = sabha();
      expect(engine.dispatch({ type: 'nextItem' })).toMatchObject({ ok: false, error: 'nothing-live' });
      engine.dispatch({ type: 'playItem', playlistId: 'sunday', itemId: 'i-song' });
      engine.dispatch({ type: 'next' });
      engine.dispatch({ type: 'nextItem' });
      expect(at(engine)).toBe('i-pic');
      engine.dispatch({ type: 'nextItem' });
      engine.dispatch({ type: 'nextItem' });
      expect([at(engine), text(engine)]).toEqual(['i-p1', 'One']);
      engine.dispatch({ type: 'previousItem' });
      expect(at(engine)).toBe('i-dhun');
      engine.dispatch({ type: 'previousItem' });
      engine.dispatch({ type: 'previousItem' });
      // Its first slide, not its last.
      expect([at(engine), text(engine)]).toEqual(['i-song', 'Verse']);
    });

    it('refuses items with nothing to play, saying why', () => {
      const { engine, transport } = sabha();
      expect(engine.dispatch({ type: 'playItem', playlistId: 'sunday', itemId: 'ph' })).toEqual({
        ok: false,
        error: 'not-playable',
        message: '“Missing Song” was not found at import',
      });
      expect(engine.dispatch({ type: 'playItem', playlistId: 'sunday', itemId: 'nope' })).toMatchObject({
        ok: false,
        error: 'unknown-item',
      });
      expect(engine.dispatch({ type: 'playItem', playlistId: 'other', itemId: 'i-song' })).toMatchObject({
        ok: false,
        error: 'unknown-item',
      });
      expect(transport.messages).toHaveLength(0);
    });

    it('plays a slide from the library when the item named is not that presentation', () => {
      const { engine } = sabha();
      engine.dispatch({
        type: 'goLive',
        presentationId: 'p2',
        slideIndex: 0,
        playlist: { playlistId: 'sunday', itemId: 'i-song' },
      });
      expect(engine.current.live).toMatchObject({ presentationId: 'p2', playlist: null });
      // At its end Next stays put, as in the library.
      expect(engine.dispatch({ type: 'next' })).toMatchObject({ ok: true, changed: false });
    });

    it("follows a change of the live item's order, and of the playlist", () => {
      const { engine, playlists } = sabha();
      engine.dispatch({ type: 'playItem', playlistId: 'sunday', itemId: 'i-song' });
      engine.dispatch({ type: 'next' });
      engine.dispatch({ type: 'next' });
      expect(engine.current.live).toMatchObject({ slideIndex: 2, slideCount: 4, arrangementId: 'usual' });
      // The operator sets the item to every slide in order: Verse two stays up, now slide 3 of 3.
      const items = playlists.items('sunday') ?? [];
      playlists.set(
        'sunday',
        items.map((i) => (i.id === 'i-song' ? { ...i, arrangementId: null } : i)),
      );
      engine.reorderLive();
      expect(engine.current.live).toMatchObject({ slideIndex: 2, slideCount: 3, arrangementId: null });
      expect(engine.current.next).toMatchObject({ kind: 'media', itemId: 'i-pic' });
      // The picture is taken out of the playlist: what comes next follows.
      playlists.set(
        'sunday',
        (playlists.items('sunday') ?? []).filter((i) => i.id !== 'i-pic'),
      );
      engine.refreshNext();
      expect(engine.current.next).toMatchObject({ kind: 'media', itemId: 'i-dhun' });
    });

    it('comes back after a restart at the same item, so Next carries on into the next one', () => {
      const { engine } = sabha();
      engine.restore({
        slide: { presentationId: 'song', slideIndex: 3, arrangementId: 'usual' },
        playlist: { playlistId: 'sunday', itemId: 'i-song' },
        background: null,
        blackout: false,
      });
      expect(engine.current.live).toMatchObject({ slideIndex: 3, playlist: { itemId: 'i-song' } });
      engine.dispatch({ type: 'next' });
      expect(at(engine)).toBe('i-pic');
      // On a picture or sound item there is no slide: the cursor alone comes back.
      const again = sabha().engine;
      again.restore({
        slide: null,
        playlist: { playlistId: 'sunday', itemId: 'i-dhun' },
        background: null,
        blackout: false,
      });
      expect(again.current.live).toMatchObject({ presentationId: null, playlist: { itemId: 'i-dhun' } });
      again.dispatch({ type: 'next' });
      expect([at(again), text(again)]).toEqual(['i-p1', 'One']);
    });
  });

  describe('timers', () => {
    const countdown = {
      id: 't1',
      name: 'Placeholder countdown',
      kind: 'countdown' as const,
      durationMs: 300_000,
      targetTime: null,
      allowsOverrun: false,
    };

    it('sends start, pause and reset only; the time is worked out from them', () => {
      const transport = new RecordingTransport();
      let clock = 10_000;
      const engine = new ShowEngine(makeSource(), transport, () => clock);
      engine.setTimers([countdown]);
      expect(engine.current.timers).toEqual([{ ...countdown, startedAt: null, elapsedMs: 0 }]);
      engine.dispatch({ type: 'startTimer', timerId: 't1' });
      expect(engine.current.timers[0]).toMatchObject({ startedAt: 10_000, elapsedMs: 0 });
      const sent = transport.messages.length;
      // Time passes: nothing is sent.
      clock = 70_000;
      expect(transport.messages).toHaveLength(sent);
      // Starting again changes nothing; a pause keeps what was counted.
      expect(engine.dispatch({ type: 'startTimer', timerId: 't1' })).toMatchObject({ changed: false });
      engine.dispatch({ type: 'pauseTimer', timerId: 't1' });
      expect(engine.current.timers[0]).toMatchObject({ startedAt: null, elapsedMs: 60_000 });
      clock = 100_000;
      engine.dispatch({ type: 'startTimer', timerId: 't1' });
      expect(engine.current.timers[0]).toMatchObject({ startedAt: 100_000, elapsedMs: 60_000 });
      engine.dispatch({ type: 'resetTimer', timerId: 't1' });
      expect(engine.current.timers[0]).toMatchObject({ startedAt: null, elapsedMs: 0 });
      expect(engine.dispatch({ type: 'startTimer', timerId: 'gone' })).toMatchObject({
        ok: false,
        error: 'unknown-timer',
      });
    });

    it('keeps a running timer running when timers are edited, and drops removed ones', () => {
      const clock = 5_000;
      const engine = new ShowEngine(makeSource(), new RecordingTransport(), () => clock);
      engine.setTimers([countdown, { ...countdown, id: 't2', name: 'Other' }]);
      engine.dispatch({ type: 'startTimer', timerId: 't1' });
      engine.setTimers([{ ...countdown, name: 'Renamed', durationMs: 600_000 }]);
      expect(engine.current.timers).toEqual([
        { ...countdown, name: 'Renamed', durationMs: 600_000, startedAt: 5_000, elapsedMs: 0 },
      ]);
    });
  });

  describe('restart recovery', () => {
    const background = {
      kind: 'media',
      mediaId: 'clouds',
      media: 'video',
      fit: 'fill',
      loop: true,
      startedAt: 42,
    } as const;

    it('puts back the slide (without its cues), the background as it was, and black-out, in one patch', () => {
      const { engine, source, transport } = setup();
      source.set(
        'cued',
        [textSlide('c1', 'One')],
        [
          [
            {
              kind: 'background',
              label: '',
              name: 'x',
              missing: false,
              unplayable: null,
              background: { ...background, mediaId: 'other' },
            },
          ],
        ],
      );
      const seen: number[] = [];
      engine.onChange((state) => seen.push(state.layers.slide?.slideIndex ?? -1));
      const put = engine.restore({
        slide: { presentationId: 'cued', slideIndex: 0 },
        background,
        blackout: true,
      });
      expect(put).toEqual({ slide: true, background: true, blackout: true });
      expect(engine.current.layers.slide?.slide).toEqual(textSlide('c1', 'One'));
      // The saved background, with its start time; not the slide's own cue.
      expect(engine.current.layers.background).toEqual(background);
      expect(engine.current.blackout).toBe(true);
      expect(transport.messages).toHaveLength(1);
      expect(seen).toEqual([0]);
    });

    it('leaves out a slide that is no longer there', () => {
      const { engine } = setup();
      expect(
        engine.restore({
          slide: { presentationId: 'gone', slideIndex: 0 },
          background: null,
          blackout: false,
        }),
      ).toEqual({ slide: false, background: false, blackout: false });
      expect(
        engine.restore({ slide: { presentationId: 'p2', slideIndex: 5 }, background, blackout: false }).slide,
      ).toBe(false);
      expect(engine.current.layers.slide).toBeNull();
      expect(engine.current.layers.background).toEqual(background);
    });
  });

  describe('black-out', () => {
    it('toggles and sets without touching layers', () => {
      const { engine } = setup();
      engine.dispatch(goLive('p1', 0));
      const slide = engine.current.layers.slide;
      engine.dispatch({ type: 'toggleBlackout' });
      expect(engine.current.blackout).toBe(true);
      expect(engine.current.layers.slide).toBe(slide);
      expect(engine.dispatch({ type: 'setBlackout', on: true })).toMatchObject({ changed: false });
      engine.dispatch({ type: 'toggleBlackout' });
      expect(engine.current.blackout).toBe(false);
    });
  });

  describe('other layers', () => {
    it('shows and hides props and messages', () => {
      const { engine } = setup();
      engine.dispatch({ type: 'showProp', prop: { id: 'logo', name: 'Logo', elements: [] } });
      engine.dispatch({ type: 'showMessage', message: { id: 'm', text: 'Hello' } });
      expect(engine.current.layers.props).toHaveLength(1);
      engine.dispatch({ type: 'hideProp', propId: 'logo' });
      engine.dispatch({ type: 'hideMessage', messageId: 'm' });
      expect(engine.current.layers.props).toEqual([]);
      expect(engine.current.layers.messages).toEqual([]);
    });

    it('keeps a stage message apart from the layers: Clear all leaves it', () => {
      const { engine } = setup();
      engine.dispatch({ type: 'setStageMessage', text: 'Placeholder: two minutes left' });
      expect(engine.current.stageMessage).toBe('Placeholder: two minutes left');
      engine.dispatch({ type: 'clearAll' });
      expect(engine.current.stageMessage).toBe('Placeholder: two minutes left');
      engine.dispatch({ type: 'clearStageMessage' });
      expect(engine.current.stageMessage).toBeNull();
      expect(parseEngineCommand({ type: 'setStageMessage', text: '   ' }).ok).toBe(false);
    });
  });

  it('keeps a mirror identical through snapshots and patches', () => {
    const { engine, transport } = setup();
    const mirror = new EngineMirror();
    expect(mirror.apply(engine.snapshot())).toBe('applied');
    const commands: EngineCommand[] = [
      goLive('p1', 0),
      { type: 'next' },
      { type: 'toggleBlackout' },
      { type: 'showMessage', message: { id: 'm', text: 'Hi' } },
      { type: 'clearLayer', layer: 'slide' },
      { type: 'next' },
      { type: 'clearAll' },
    ];
    for (const c of commands) {
      engine.dispatch(c);
      const m = transport.last;
      if (m) mirror.apply(m);
      expect(mirror.state).toEqual(engine.current);
      expect(mirror.rev).toBe(engine.rev);
    }
  });

  it('stays in sync over a long random sequence, with every message JSON round-tripped', () => {
    const { engine, transport } = setup();
    const mirror = new EngineMirror();
    mirror.apply(JSON.parse(JSON.stringify(engine.snapshot())) as ReturnType<typeof engine.snapshot>);
    let seed = 42;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const pick = (): EngineCommand => {
      const layers = LAYER_NAMES;
      const options: EngineCommand[] = [
        goLive(rand(2) ? 'p1' : 'p2', rand(3)),
        { type: 'next' },
        { type: 'previous' },
        { type: 'clearLayer', layer: layers[rand(layers.length)] ?? 'slide' },
        { type: 'clearAll' },
        { type: 'toggleBlackout' },
        { type: 'setBackground', background: { kind: 'color', color: rand(2) ? '#111111' : '#222222' } },
        { type: 'showMessage', message: { id: `m${rand(3)}`, text: `Text ${rand(5)}` } },
        { type: 'hideMessage', messageId: `m${rand(3)}` },
        { type: 'showProp', prop: { id: `p${rand(2)}`, name: 'P', elements: [] } },
        { type: 'hideProp', propId: `p${rand(2)}` },
        {
          type: 'playAudio',
          audio: { id: 'a', title: `T${rand(2)}`, mediaId: null, volume: 1, loop: false },
        },
        {
          type: 'setMask',
          mask: { id: 'k', name: 'k', visible: { x: rand(5), y: 0, width: 10, height: 10 } },
        },
      ];
      return options[rand(options.length)] ?? { type: 'next' };
    };
    let seen = 0;
    for (let i = 0; i < 500; i++) {
      engine.dispatch(pick());
      for (; seen < transport.messages.length; seen++) {
        const wire = JSON.parse(JSON.stringify(transport.messages[seen])) as EnginePatchMessage;
        expect(mirror.apply(wire)).toBe('applied');
      }
      expect(mirror.state).toEqual(engine.current);
    }
    expect(engine.rev).toBeGreaterThan(100);
  });

  it('stamps each message with the send time', () => {
    const { engine, transport } = setup();
    engine.dispatch(goLive('p1', 0));
    engine.dispatch({ type: 'next' });
    const times = transport.messages.map((m) => m.sentAt);
    expect(times[1]).toBeGreaterThan(times[0] ?? Infinity);
  });
});
