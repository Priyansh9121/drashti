import { describe, expect, it } from 'vitest';
import { describeAppInfo } from './app-info';

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
});
