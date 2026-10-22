import { describe, expect, it } from 'vitest';
import { namedBackground } from './named-background';

/*
 * A phone names a live background it cannot draw (Session 48: another app's window; Session 50: a video input)
 * and can clear it, never choose one.
 */

describe('a phone’s line for a background it cannot draw', () => {
  it('names a video input as “Video input: <name>”', () => {
    const line = namedBackground({
      kind: 'input',
      inputId: 'i1',
      name: 'Placeholder input',
      device: 'fake_device_0',
      fit: 'fill',
      startedAt: 1,
    });
    expect(line).toEqual({ kind: 'input', label: 'Video input:', name: 'Placeholder input' });
    expect(line && `${line.label} ${line.name}`).toBe('Video input: Placeholder input');
  });

  it('names a window as before, and nothing else', () => {
    expect(
      namedBackground({ kind: 'window', sourceId: 'window:1:0', name: 'Placeholder meeting', startedAt: 1 }),
    ).toEqual({ kind: 'window', label: 'A window:', name: 'Placeholder meeting' });
    expect(namedBackground(null)).toBeNull();
    expect(namedBackground(undefined)).toBeNull();
    expect(namedBackground({ kind: 'color', color: '#000000' })).toBeNull();
    expect(
      namedBackground({ kind: 'media', mediaId: 'm', media: 'video', fit: 'fill', loop: true, startedAt: 1 }),
    ).toBeNull();
  });
});
