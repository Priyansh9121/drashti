import { describe, expect, it } from 'vitest';
import { HEVC_TYPE } from '../../shared/convert';
import { askPlaysHevc, HevcAnswer, PLAYS_HEVC_SCRIPT } from './plays-hevc';

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

describe('the answer, as imports wait for it (Session 51 review)', () => {
  it('given from the start (a test’s): no import waits', async () => {
    const given = new HevcAnswer(false);
    expect(given.now).toBe(false);
    expect(await given.wait()).toBe(false);
  });

  it('an import starting before the window has said waits for its answer', async () => {
    const answer = new HevcAnswer(null, 10_000);
    expect(answer.now).toBeNull();
    const waiting = answer.wait();
    answer.tell(false);
    expect(await waiting).toBe(false);
    expect(answer.now).toBe(false);
    expect(await answer.wait()).toBe(false);
  });

  it('not told within the wait: the import goes on without it', async () => {
    const answer = new HevcAnswer(null, 50);
    const started = Date.now();
    expect(await answer.wait()).toBeNull();
    expect(Date.now() - started).toBeGreaterThanOrEqual(40);
  });

  it('the window could not say: imports go on at once from then on, and a later answer still counts', async () => {
    const answer = new HevcAnswer(null, 10_000);
    const waiting = answer.wait();
    answer.tell(null);
    expect(await waiting).toBeNull();
    expect(await answer.wait()).toBeNull();
    answer.tell(true);
    expect(answer.now).toBe(true);
    expect(await answer.wait()).toBe(true);
  });
});
