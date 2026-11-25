import { describe, expect, it } from 'vitest';
import { appInfoParts, describeAppInfo } from './app-info';

describe('describeAppInfo', () => {
  const base = {
    name: 'Drashti',
    version: '1.0.0',
    electron: '44.4.5',
    chrome: '152',
    node: '24',
    arch: 'arm64',
  };

  it('names macOS and Windows in words', () => {
    expect(describeAppInfo({ ...base, platform: 'darwin' })).toBe(
      'Drashti 1.0.0 · Electron 44.4.5 · macOS arm64',
    );
    expect(describeAppInfo({ ...base, platform: 'win32', arch: 'x64' })).toBe(
      'Drashti 1.0.0 · Electron 44.4.5 · Windows x64',
    );
  });

  it('passes other platforms through', () => {
    expect(describeAppInfo({ ...base, platform: 'linux' })).toContain('· linux arm64');
  });

  // QA23-STAGE8-4 (lead 2): the status bar shows the name and version; the rest of the line stays in the item's
  // tooltip and for screen readers, so nothing is hidden and the row fits CI's 1024 × 645 with Audience and Stage off.
  it('splits the line into the status bar’s short words and the rest, which together are the whole line', () => {
    const info = { ...base, platform: 'win32', arch: 'x64' };
    expect(appInfoParts(info)).toEqual({ short: 'Drashti 1.0.0', rest: ' · Electron 44.4.5 · Windows x64' });
    const parts = appInfoParts({ ...base, platform: 'darwin' });
    expect(parts.short + parts.rest).toBe(describeAppInfo({ ...base, platform: 'darwin' }));
  });
});
