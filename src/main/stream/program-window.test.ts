import { describe, expect, it } from 'vitest';
import { isStreamPage, streamPermissionAllowed } from './program-window';

describe('the stream session’s permissions', () => {
  const page = 'file:///Applications/Drashti.app/Contents/Resources/app.asar/out/renderer/stream.html';

  it('give the camera and a sound input to the stream’s page in the Program window, and nothing else', () => {
    expect(isStreamPage(page)).toBe(true);
    expect(isStreamPage('http://localhost:5173/stream.html')).toBe(true);
    expect(isStreamPage('file:///x/out/renderer/index.html')).toBe(false);
    expect(streamPermissionAllowed('media', true, page, ['video', 'audio'])).toBe(true);
    expect(streamPermissionAllowed('media', true, page)).toBe(true);
    expect(streamPermissionAllowed('media', false, page, ['video'])).toBe(false);
    expect(streamPermissionAllowed('media', true, 'file:///x/out/renderer/index.html', ['video'])).toBe(
      false,
    );
    for (const other of [
      'notifications',
      'geolocation',
      'display-capture',
      'speaker-selection',
      'clipboard-read',
    ])
      expect(streamPermissionAllowed(other, true, page), other).toBe(false);
  });
});
