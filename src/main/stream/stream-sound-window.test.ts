import { describe, expect, it, vi } from 'vitest';
import { createProgramWindow, STREAM_PARTITION } from './program-window';
import {
  createStreamSoundWindow,
  STREAM_SOUND_PARTITION,
  streamSoundPermissionAllowed,
} from './stream-sound-window';

const { made, load } = vi.hoisted(() => ({
  made: [] as {
    show: boolean;
    webPreferences: { partition: string; backgroundThrottling: boolean; offscreen?: unknown };
  }[],
  load: vi.fn(),
}));
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(function Window(options: (typeof made)[number]) {
    made.push(options);
    return {
      getContentSize: () => [1920, 1080],
      setContentSize: vi.fn(),
      webContents: { on: vi.fn(), stopPainting: vi.fn(), setFrameRate: vi.fn() },
    };
  }),
}));
vi.mock('../windows/renderer', () => ({ loadPage: load }));
vi.mock('../windows/web-preferences', () => ({ secureWebPreferences: () => ({}) }));

describe('the stream sound window', () => {
  it('keeps the existing stream device session so saved microphone ids are unchanged', () => {
    made.length = 0;
    createStreamSoundWindow();
    expect(made[0]?.webPreferences.partition, 'saved inputs stay in the original device-id namespace').toBe(
      STREAM_PARTITION,
    );
  });

  it('creates a separate BrowserWindow for sound, stays unthrottled and loads no pictures', () => {
    made.length = 0;
    const picture = createProgramWindow({ width: 1920, height: 1080 });
    const window = createStreamSoundWindow();
    expect(window).not.toBe(picture);
    expect(window.webContents).not.toBe(picture.webContents);
    expect(made).toHaveLength(2);
    expect(made[0]?.webPreferences.offscreen).toBeTruthy();
    expect(made[1]).toMatchObject({
      show: false,
      webPreferences: { partition: STREAM_SOUND_PARTITION, backgroundThrottling: false },
    });
    expect(made[1]?.webPreferences.offscreen).toBeUndefined();
    expect(load).toHaveBeenCalledWith(window, 'stream-sound');
  });
  it('grants only its own microphone, on Mac and Windows page addresses; never camera, output or display capture', () => {
    for (const url of [
      'file:///Applications/Drashti.app/out/renderer/stream-sound.html',
      'file:///C:/Drashti/out/renderer/stream-sound.html',
      'http://localhost:5173/stream-sound.html',
    ]) {
      expect(streamSoundPermissionAllowed('media', true, url, ['audio'])).toBe(true);
      expect(streamSoundPermissionAllowed('media', false, url, ['audio'])).toBe(false);
      expect(streamSoundPermissionAllowed('media', true, url, ['video'])).toBe(false);
      expect(streamSoundPermissionAllowed('media', true, url, ['audio', 'video'])).toBe(false);
      for (const other of ['speaker-selection', 'display-capture', 'clipboard-read'])
        expect(streamSoundPermissionAllowed(other, true, url)).toBe(false);
    }
    expect(streamSoundPermissionAllowed('media', true, 'file:///x/stream.html', ['audio'])).toBe(false);
    expect(
      streamSoundPermissionAllowed('media', true, 'https://example.invalid/stream-sound.html', ['audio']),
    ).toBe(false);
  });
});
