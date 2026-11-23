import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CAPTION_TIMING } from '../../shared/captions';
import {
  readCaptionsSwitch,
  readCaptionsTuning,
  writeCaptionsSwitch,
  writeCaptionsTuning,
} from './captions-switch';

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

describe('a model per language and the live timing on this computer (alpha.22)', () => {
  it('start as before: no model of its own for any language, and the timing captions always had', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-captions-tuning-'));
    expect(readCaptionsTuning(dir)).toEqual({ languageModels: {}, timing: DEFAULT_CAPTION_TIMING });
    expect(DEFAULT_CAPTION_TIMING).toEqual({
      stepMs: 1_500,
      pauseMs: 700,
      longestMs: 12_000,
      speech: 'standard',
      threads: 4,
    });
  });

  it('are kept in their own file in the data folder (the switch’s file unchanged), and read back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-captions-tuning-'));
    writeCaptionsSwitch(dir, { on: true, model: 'small' });
    const tuning = {
      languageModels: { gu: 'placeholder-gu', hi: 'placeholder-hi' },
      timing: { stepMs: 1_000, pauseMs: 500, longestMs: 8_000, speech: 'noisy-hall', threads: 2 },
    } as const;
    writeCaptionsTuning(dir, tuning);
    expect(readCaptionsTuning(dir)).toEqual(tuning);
    expect(JSON.parse(readFileSync(join(dir, 'drashti-captions.json'), 'utf8'))).toEqual({
      on: true,
      model: 'small',
    });
  });

  it('read what they do not know as the default, field by field', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-captions-tuning-'));
    writeFileSync(
      join(dir, 'drashti-captions-tuning.json'),
      JSON.stringify({
        languageModels: { gu: 'placeholder-gu', sa: 'placeholder-sa', hi: '../escape', en: 7 },
        timing: { stepMs: 250, pauseMs: 500, longestMs: 60_000, speech: 'loud', threads: 64 },
      }),
    );
    expect(readCaptionsTuning(dir)).toEqual({
      languageModels: { gu: 'placeholder-gu' },
      timing: { ...DEFAULT_CAPTION_TIMING, pauseMs: 500 },
    });
    writeFileSync(join(dir, 'drashti-captions-tuning.json'), '{"timing": ');
    expect(readCaptionsTuning(dir)).toEqual({ languageModels: {}, timing: DEFAULT_CAPTION_TIMING });
  });
});
