import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VideoInput } from '../../shared/video-inputs';
import { readVideoInputs, VIDEO_INPUTS_FILE, writeVideoInputs } from './video-inputs-file';

/* This computer's video inputs (Session 50), kept in its data folder: placeholder names only. */

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-video-inputs-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const INPUT_1: VideoInput = {
  id: 'in-1',
  name: 'Placeholder input',
  device: 'Placeholder camera',
  fit: 'fit',
};
const INPUT_2: VideoInput = {
  id: 'in-2',
  name: 'Placeholder mixer',
  device: 'Placeholder capture',
  fit: 'fill',
};

describe('the video inputs file', () => {
  it('is none at first, and keeps what is written, in order', () => {
    const said: string[] = [];
    expect(readVideoInputs(dir, (l) => said.push(l))).toEqual([]);
    writeVideoInputs(dir, [INPUT_1, INPUT_2]);
    expect(readVideoInputs(dir, (l) => said.push(l))).toEqual([INPUT_1, INPUT_2]);
    expect(JSON.parse(readFileSync(join(dir, VIDEO_INPUTS_FILE), 'utf8'))).toEqual({
      version: 1,
      inputs: [INPUT_1, INPUT_2],
    });
    // Written whole, then put in place: nothing half-written is left beside it.
    expect(readdirSync(dir)).toEqual([VIDEO_INPUTS_FILE]);
    expect(said).toEqual([]);
  });

  it('one that cannot be read is set aside with the date, never written over, and said', () => {
    for (const damaged of [
      '{"version": 1, "inputs": [',
      JSON.stringify({ version: 1, inputs: [{ ...INPUT_1, fit: 'stretch' }] }),
      JSON.stringify({ version: 1, inputs: [{ ...INPUT_1, name: '' }] }),
      JSON.stringify({ version: 2, inputs: [] }),
    ]) {
      rmSync(dir, { recursive: true, force: true });
      dir = mkdtempSync(join(tmpdir(), 'drashti-video-inputs-'));
      writeFileSync(join(dir, VIDEO_INPUTS_FILE), damaged);
      const said: string[] = [];
      expect(
        readVideoInputs(dir, (l) => said.push(l), { retryMs: 5, now: new Date(2026, 9, 22, 21, 40) }),
      ).toEqual([]);
      expect(readdirSync(dir)).toEqual(['drashti-video-inputs.unreadable-2026-10-22 21-40.json']);
      expect(readFileSync(join(dir, 'drashti-video-inputs.unreadable-2026-10-22 21-40.json'), 'utf8')).toBe(
        damaged,
      );
      expect(said).toHaveLength(1);
      expect(said[0]).toContain('drashti-video-inputs.json could not be read');
      expect(said[0]).toContain('set aside');
    }
  });
});
