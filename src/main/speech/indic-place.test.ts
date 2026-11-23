import { describe, expect, it } from 'vitest';
import { indicCandidates } from './indic-place';
describe('native Route C runtime location', () => {
  it('uses each system’s own paths for packaged and development copies', () => {
    expect(indicCandidates({ packaged: true, resourcesPath: 'C:\\Program Files\\Drashti\\resources', appPath: 'C:\\work', platform: 'win32', arch: 'x64' })).toEqual(['C:\\Program Files\\Drashti\\resources\\indic\\ic-ctc.exe']);
    expect(indicCandidates({ packaged: false, resourcesPath: '/resources', appPath: '/app', platform: 'darwin', arch: 'arm64' })).toEqual(['/app/vendor/indic/darwin-arm64/ic-ctc']);
    expect(indicCandidates({ packaged: false, resourcesPath: '/resources', appPath: '/app', platform: 'linux', arch: 'x64' })).toEqual([]);
  });
});
