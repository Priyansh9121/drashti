import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { HEVC_TYPE } from '../../shared/convert';
import {
  askHevcKinds,
  askPlaysHevc,
  HEVC_KIND_TYPES,
  HEVC_KINDS_SCRIPT,
  HevcAnswer,
  hevcKindsScript,
  PLAYS_HEVC_SCRIPT,
  playsHevcScript,
} from './plays-hevc';

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

  it('a test’s question holds the page asking it first, then says the answer given, or Chromium’s (question 36)', () => {
    // A page whose Chromium says `canPlay`.
    const run = (script: string, canPlay: string): unknown =>
      runInNewContext(script, {
        document: { createElement: () => ({ canPlayType: () => canPlay }) },
      }) as unknown;
    expect(playsHevcScript()).toBe(PLAYS_HEVC_SCRIPT);
    expect(run(playsHevcScript(), 'maybe')).toBe('maybe');
    const started = Date.now();
    expect(run(playsHevcScript({ holdMs: 80, given: null }), 'maybe')).toBe('maybe');
    expect(Date.now() - started).toBeGreaterThanOrEqual(80);
    expect(run(playsHevcScript({ holdMs: 0, given: false }), 'probably')).toBe('');
    expect(run(playsHevcScript({ holdMs: 0, given: true }), '')).toBe('probably');
  });

  it('asks the script it is given (a test’s), or the plain question', async () => {
    const asked: string[] = [];
    const run = (script: string) => {
      asked.push(script);
      return Promise.resolve('');
    };
    expect(await askPlaysHevc(run, 'a test’s question')).toBe(false);
    expect(await askPlaysHevc(run)).toBe(false);
    expect(asked).toEqual(['a test’s question', PLAYS_HEVC_SCRIPT]);
  });

  it('is not known when the window cannot answer (gone, or something else came back)', async () => {
    expect(
      await askPlaysHevc(() => Promise.reject(new Error('Placeholder: the window went away'))),
    ).toBeNull();
    expect(await askPlaysHevc(() => Promise.resolve(undefined))).toBeNull();
    expect(await askPlaysHevc(() => Promise.resolve(1))).toBeNull();
  });
});

describe('HEVC’s other kinds (Session 60, x36; the owner’s "Yes, A")', () => {
  it('asks Chromium about Main 10 and the Range Extensions (4:2:2, 4:4:4, 12-bit) by their profiles, in that order', () => {
    // Profile 2 is Main 10 and profile 4 the Range Extensions (ISO/IEC 14496-15's codec strings, as Chromium reads them).
    expect(HEVC_KIND_TYPES).toEqual({
      main10: 'video/mp4; codecs="hvc1.2.4.L93.B0"',
      rext: 'video/mp4; codecs="hvc1.4.10.L93.B0"',
    });
    const asked: string[] = [];
    const said = runInNewContext(HEVC_KINDS_SCRIPT, {
      document: {
        createElement: () => ({
          canPlayType: (type: string) => {
            asked.push(type);
            return type === HEVC_KIND_TYPES.main10 ? 'probably' : '';
          },
        }),
      },
    }) as unknown;
    expect(asked).toEqual([HEVC_KIND_TYPES.main10, HEVC_KIND_TYPES.rext]);
    expect(Array.from(said as string[])).toEqual(['probably', '']);
  });

  it('reads each kind as Chromium said it ("probably" or "maybe": it plays; nothing: it cannot); anything else is not known', async () => {
    const answer = (said: unknown) => () => Promise.resolve(said);
    expect(await askHevcKinds(answer(['probably', '']))).toEqual({ main10: true, rext: false });
    expect(await askHevcKinds(answer(['maybe', 'probably']))).toEqual({ main10: true, rext: true });
    expect(await askHevcKinds(answer(['', '']))).toEqual({ main10: false, rext: false });
    for (const said of [undefined, 'probably', ['probably'], ['probably', '', ''], ['probably', 1]])
      expect(await askHevcKinds(answer(said))).toBeNull();
    expect(await askHevcKinds(() => Promise.reject(new Error('Placeholder: the page went away')))).toBeNull();
  });

  it('a test’s question gives its answer for every kind; with none given, Chromium’s own', () => {
    const run = (script: string): unknown =>
      runInNewContext(script, {
        document: { createElement: () => ({ canPlayType: () => 'maybe' }) },
      }) as unknown;
    expect(hevcKindsScript()).toBe(HEVC_KINDS_SCRIPT);
    expect(hevcKindsScript({ holdMs: 0, given: null })).toBe(HEVC_KINDS_SCRIPT);
    expect(Array.from(run(hevcKindsScript({ holdMs: 0, given: true })) as string[])).toEqual([
      'probably',
      'probably',
    ]);
    expect(Array.from(run(hevcKindsScript({ holdMs: 0, given: false })) as string[])).toEqual(['', '']);
  });

  it('not known until the window has said them', () => {
    expect(new HevcAnswer(null).kinds).toBeNull();
    expect(new HevcAnswer(true).kinds).toBeNull();
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
