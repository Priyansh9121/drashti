import { describe, expect, it } from 'vitest';
import { withoutCaptions } from '../../shared/engine/captions-filter';
import { DEFAULT_CAPTION_SETTINGS } from '../../shared/captions';
import type { VideoCaptionTrack } from '../../shared/video-captions';
import { ShowEngine } from './show-engine';
import { makeSource, RecordingTransport } from './testing';

const TRACK: VideoCaptionTrack = {
  id: 'en-file',
  language: 'en',
  automatic: false,
  name: 'Sample.en.srt',
  cues: [{ startMs: 1000, endMs: 3000, text: 'Placeholder video words' }],
};

describe('library video caption choices in the engine', () => {
  it('ships the chosen track with a playing video to each screen and node; live words remain private', () => {
    const engine = new ShowEngine(makeSource(), new RecordingTransport(), () => 1000, undefined, {
      videoCaptionsOf: (id) => (id === 'video' ? { track: TRACK, size: 'large', place: 'top' } : null),
    });
    expect(
      engine.dispatch({
        type: 'setBackground',
        background: { kind: 'media', mediaId: 'video', media: 'video', fit: 'fit', loop: false },
      }),
    ).toMatchObject({
      ok: true,
    });
    expect(engine.current.videoCaptions?.['video']?.track).toEqual(TRACK);
    engine.setCaptions({ ...DEFAULT_CAPTION_SETTINGS, language: 'en', lines: ['Private live placeholder'] });
    const node = withoutCaptions(engine.snapshot());
    expect(node.state.videoCaptions?.['video']?.track.cues[0]?.text).toBe('Placeholder video words');
    expect(node.state.captions).toBeNull();
  });
  it('changes language immediately without a playback command, and sends no repeated track for a pause', () => {
    let track: VideoCaptionTrack | null = TRACK;
    const transport = new RecordingTransport();
    const engine = new ShowEngine(makeSource(), transport, () => 1000, undefined, {
      videoCaptionsOf: () => (track ? { track, size: 'medium', place: 'bottom' } : null),
      mediaLength: () => 10000,
    });
    engine.dispatch({
      type: 'setBackground',
      background: { kind: 'media', mediaId: 'video', media: 'video', fit: 'fit', loop: false },
    });
    const before = engine.current.layers.background;
    track = { ...TRACK, id: 'gu-file', language: 'gu' };
    engine.refreshVideoCaptions();
    expect(engine.current.videoCaptions?.['video']?.track.language).toBe('gu');
    expect(engine.current.layers.background).toBe(before);
    engine.dispatch({ type: 'pausePlaying', playing: { layer: 'background' } });
    const last = transport.last;
    if (last?.kind !== 'patch') throw new Error('Expected pause patch');
    expect(last.ops.some((op) => op.path[0] === 'videoCaptions')).toBe(false);
    track = null;
    engine.refreshVideoCaptions();
    expect(engine.current.videoCaptions).toEqual({});
  });
  it('takes chosen tracks out of the state under Black-out, Wallpaper and Clear all', () => {
    const engine = new ShowEngine(makeSource(), new RecordingTransport(), () => 1000, undefined, {
      videoCaptionsOf: () => ({ track: TRACK, size: 'medium', place: 'bottom' }),
    });
    for (const type of ['toggleBlackout', 'toggleWallpaper', 'clearAll'] as const) {
      engine.dispatch({
        type: 'setBackground',
        background: { kind: 'media', mediaId: 'video', media: 'video', fit: 'fit', loop: false },
      });
      engine.dispatch({ type });
      expect(engine.current.videoCaptions).toEqual({});
    }
  });
});
