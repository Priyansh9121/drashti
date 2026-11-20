import { describe, expect, it } from 'vitest';
import { NO_FIRST_FRAME } from '../../shared/no-picture';
import {
  CANNOT_PLAY_SETTLE_MS,
  type CannotPlayWhere,
  whereWords,
  CannotPlay,
  errorKindWords,
  GPU_GONE_GRACE_MS,
  NodeCannotPlay,
} from './cannot-play';

/** A CannotPlay on a hand-turned clock: what ran, and the clock to move. */
function rig() {
  let now = 100_000;
  const waiting: { at: number; run: () => void }[] = [];
  const ran: string[] = [];
  const c = new CannotPlay({
    now: () => now,
    later: (ms, run) => {
      waiting.push({ at: now + ms, run });
    },
  });
  const to = (t: number) => {
    now = t;
    for (const w of waiting.splice(0).sort((a, b) => a.at - b.at))
      if (w.at <= now) w.run();
      else waiting.push(w);
  };
  const heard = (showing = 'clip@1', where: CannotPlayWhere = { screen: 'Placeholder Hall' }) => {
    c.heard(
      showing,
      where,
      (named) => ran.push(`off ${named}`),
      (named) => ran.push(`gpu ${named}`),
    );
  };
  return { c, heard, ran, to, at: () => now };
}

describe('a video that could not play (Q60-31)', () => {
  it('is taken off after the short wait', () => {
    const r = rig();
    r.heard();
    r.to(r.at() + CANNOT_PLAY_SETTLE_MS - 1);
    expect(r.ran).toEqual([]);
    r.to(r.at() + 1);
    expect(r.ran).toEqual(['off the screen “Placeholder Hall”']);
  });

  it('is left to load again when a GPU process stopped just before the word, or within the wait after it', () => {
    const before = rig();
    before.c.gpuGone();
    before.to(before.at() + GPU_GONE_GRACE_MS - 1);
    before.heard();
    before.to(before.at() + CANNOT_PLAY_SETTLE_MS);
    expect(before.ran).toEqual(['gpu the screen “Placeholder Hall”']);
    const after = rig();
    after.heard();
    after.to(after.at() + CANNOT_PLAY_SETTLE_MS - 10);
    after.c.gpuGone();
    after.to(after.at() + 10);
    expect(after.ran).toEqual(['gpu the screen “Placeholder Hall”']);
  });

  it('is taken off when the GPU process stopped long before the word', () => {
    const r = rig();
    r.c.gpuGone();
    r.to(r.at() + GPU_GONE_GRACE_MS + 1);
    r.heard();
    r.to(r.at() + CANNOT_PLAY_SETTLE_MS);
    expect(r.ran).toEqual(['off the screen “Placeholder Hall”']);
  });
});

describe('every page that said a showing could not play, named (Q60-31)', () => {
  it('gathers the words heard during the wait, takes it off once, and names the screens first', () => {
    const r = rig();
    r.heard('clip@1', 'live');
    r.heard('clip@1', { screen: 'Placeholder Hall' });
    r.heard('clip@1', 'stream');
    r.heard('clip@1', { screen: 'Placeholder Hall' });
    r.to(r.at() + CANNOT_PLAY_SETTLE_MS);
    expect(r.ran).toEqual(['off the screen “Placeholder Hall”']);
  });

  it('keeps each showing to itself: another file, or the same file put up again, waits on its own', () => {
    const r = rig();
    r.heard('clip@1', 'live');
    r.heard('clip@2', { screen: 'Placeholder Hall' });
    r.to(r.at() + CANNOT_PLAY_SETTLE_MS);
    expect(r.ran).toEqual(['off LIVE', 'off the screen “Placeholder Hall”']);
  });

  it('in words: one screen, two, three; LIVE without a screen; the stream alone', () => {
    expect(whereWords([{ screen: 'A' }])).toBe('the screen “A”');
    expect(whereWords([{ screen: 'A' }, 'live', { screen: 'B' }])).toBe('the screens “A” and “B”');
    expect(whereWords([{ screen: 'A' }, { screen: 'B' }, { screen: 'C' }])).toBe(
      'the screens “A”, “B” and “C”',
    );
    expect(whereWords(['stream', 'live'])).toBe('LIVE');
    expect(whereWords(['stream'])).toBe('the stream');
  });
});

describe('a media element’s error in words for the log', () => {
  it('says MediaError’s four codes plainly, and none for anything else', () => {
    expect([1, 2, 3, 4, 0, 9].map(errorKindWords)).toEqual([
      'stopped',
      'a network or file error',
      'a decoding error',
      'not playable here',
      'an error with no code',
      'an error with no code',
    ]);
  });
});

describe('a video with no first frame within 10 s (Q60-44, the owner’s answer A)', () => {
  it('is said in the log as no picture within 10 s', () => {
    expect(errorKindWords(NO_FIRST_FRAME)).toBe('no picture within 10 s');
  });
});

describe('a paired computer’s screen that could not play a video (Q60-44, the owner’s answer A)', () => {
  const node = { id: 'node-1', name: 'Placeholder Node' };
  const file = { name: 'Placeholder clip.mp4' };
  const report = {
    screenId: 'screen-1',
    mediaId: 'media-1',
    startedAt: 5000,
    code: 3,
    words: 'Placeholder words',
  };

  it('tells the operator by the node’s and the file’s names that it plays on everywhere else, and logs the error’s kind and the screen', () => {
    expect(new NodeCannotPlay().heard(node, 'Placeholder Hall', file, report)).toEqual({
      notice:
        '“Placeholder clip.mp4” could not play on the paired computer “Placeholder Node”: its screen keeps what it showed, and the video plays on everywhere else. If it happens again, that computer may not play this kind of video: tell whoever looks after Drashti.',
      log: 'A video could not play on the paired computer “Placeholder Node”, its screen “Placeholder Hall” (a decoding error: Placeholder words): media-1; it plays on everywhere else',
    });
  });

  it('tells it once for each showing: the same showing again is not told; another showing, or another node, is', () => {
    const c = new NodeCannotPlay();
    expect(c.heard(node, 'Placeholder Hall', file, report)).not.toBeNull();
    expect(c.heard(node, 'Placeholder Hall', file, report)).toBeNull();
    expect(c.heard(node, 'Placeholder Hall', file, { ...report, startedAt: 9000 })).not.toBeNull();
    expect(
      c.heard({ id: 'node-2', name: 'Placeholder Node 2' }, 'Placeholder Hall', file, report),
    ).not.toBeNull();
  });

  it('says a node’s first frame that never came as no picture within 10 s', () => {
    expect(
      new NodeCannotPlay().heard(node, 'Placeholder Hall', file, {
        ...report,
        code: NO_FIRST_FRAME,
        words: '',
      })?.log,
    ).toBe(
      'A video could not play on the paired computer “Placeholder Node”, its screen “Placeholder Hall” (no picture within 10 s): media-1; it plays on everywhere else',
    );
  });
});
