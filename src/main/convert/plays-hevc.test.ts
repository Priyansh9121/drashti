import { describe, expect, it } from 'vitest';
import { HEVC_TYPE } from '../../shared/convert';
import { askPlaysHevc, PLAYS_HEVC_SCRIPT } from './plays-hevc';

/*
 * Whether this computer plays HEVC video (Session 51), as the operator window's Chromium says: the import converts
 * by itself what it cannot play. No test can rely on a real HEVC decoder, so the window's answer is given here.
 */

describe('whether this computer plays HEVC', () => {
  it('asks the window the question the media list asks (convert-store.ts playsHevc)', () => {
    expect(PLAYS_HEVC_SCRIPT).toBe(
      `document.createElement('video').canPlayType(${JSON.stringify(HEVC_TYPE)})`,
    );
  });

  it('plays it when Chromium says "probably" or "maybe", cannot when it says nothing', async () => {
    const asked: string[] = [];
    const answer = (said: unknown) => (script: string) => {
      asked.push(script);
      return Promise.resolve(said);
    };
    expect(await askPlaysHevc(answer('probably'))).toBe(true);
    expect(await askPlaysHevc(answer('maybe'))).toBe(true);
    expect(await askPlaysHevc(answer(''))).toBe(false);
    expect(asked).toEqual([PLAYS_HEVC_SCRIPT, PLAYS_HEVC_SCRIPT, PLAYS_HEVC_SCRIPT]);
  });

  it('is not known when the window cannot answer (gone, or something else came back)', async () => {
    expect(
      await askPlaysHevc(() => Promise.reject(new Error('Placeholder: the window went away'))),
    ).toBeNull();
    expect(await askPlaysHevc(() => Promise.resolve(undefined))).toBeNull();
    expect(await askPlaysHevc(() => Promise.resolve(1))).toBeNull();
  });
});
