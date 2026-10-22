import { describe, expect, it } from 'vitest';
import type { InputBackground } from '../../../shared/engine/state';
import { backgroundWords } from './StageView';

/* What a stage screen says is up when no slide is: the background's kind, never its picture. */

const input: InputBackground = {
  kind: 'input',
  inputId: 'i1',
  name: 'Placeholder input',
  device: 'fake_device_0',
  fit: 'fit',
  startedAt: 1,
};

describe('a stage screen’s words for the background', () => {
  it('says a video input is on the screens (Session 50), as it says a window is', () => {
    expect(backgroundWords(input)).toBe('Video input on the screens');
    expect(
      backgroundWords({ kind: 'window', sourceId: 'window:1:0', name: 'Placeholder meeting', startedAt: 1 }),
    ).toBe('Window on the screens');
  });

  it('keeps its words for pictures, videos and nothing', () => {
    const media = { kind: 'media', mediaId: 'm', fit: 'fill', loop: true, startedAt: 1 } as const;
    expect(backgroundWords({ ...media, media: 'image' })).toBe('Picture on the screens');
    expect(backgroundWords({ ...media, media: 'video' })).toBe('Video on the screens');
    expect(backgroundWords(null)).toBe('Nothing on the screens');
    expect(backgroundWords({ kind: 'color', color: '#000000' })).toBe('Nothing on the screens');
  });
});
