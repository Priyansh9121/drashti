import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCaptionsSwitch, writeCaptionsSwitch } from './captions-switch';

/* Whether live captions are on belongs to this computer (Part 10): its model and its work. */

describe('the captions switch on this computer (Part 10)', () => {
  it('is off until an admin turns it on, with the model this computer starts with', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-captions-switch-'));
    expect(readCaptionsSwitch(dir, 'win32', 'x64')).toEqual({ on: false, model: 'small' });
    expect(readCaptionsSwitch(dir, 'darwin', 'arm64')).toEqual({ on: false, model: 'turbo' });
  });

  it('is kept in the data folder, beside the priority, and read back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-captions-switch-'));
    writeCaptionsSwitch(dir, { on: true, model: 'turbo' });
    expect(JSON.parse(readFileSync(join(dir, 'drashti-captions.json'), 'utf8'))).toEqual({
      on: true,
      model: 'turbo',
    });
    expect(readCaptionsSwitch(dir, 'win32', 'x64')).toEqual({ on: true, model: 'turbo' });
  });

  it('reads a damaged file, or one with what it does not know, as off with the default model', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-captions-switch-'));
    writeFileSync(join(dir, 'drashti-captions.json'), '{"on": tru');
    expect(readCaptionsSwitch(dir, 'win32', 'x64')).toEqual({ on: false, model: 'small' });
    writeFileSync(join(dir, 'drashti-captions.json'), '{"on": "yes", "model": "huge"}');
    expect(readCaptionsSwitch(dir, 'win32', 'x64')).toEqual({ on: false, model: 'small' });
  });
});
