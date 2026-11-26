import { describe, expect, it } from 'vitest';
import {
  cannotPlayNotice,
  cannotStartInTimeNotice,
  NO_FIRST_FRAME,
  NO_START_IN_TIME,
} from '../../shared/no-picture';
import {
  CANNOT_PLAY_SETTLE_MS,
  type CannotPlayWhere,
  whereWords,
  CannotPlay,
  errorKindWords,
  GPU_GONE_GRACE_MS,
  type Heard,
  heardOutcome,
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

describe('a screen’s word on a video up but not playing (alpha.23, a22-halldrop: never dropped without a word)', () => {
  const HALL = { screen: 'Placeholder Hall' };
  const heard = (over: Partial<Heard>): Heard => ({
    name: 'Placeholder waiting video',
    mediaId: 'media-1',
    wheres: [HALL],
    code: 3,
    words: '',
    took: null,
    stillUp: true,
    ...over,
  });

  it('a video waiting on the slide (paused, or for its click) that the hall could not play: nothing comes off, the operator is told what happened and what to try, the log has it, and LIVE names the screen', () => {
    const o = heardOutcome(heard({}));
    expect(o.notice).toBe(
      '“Placeholder waiting video” could not play on the screen “Placeholder Hall”. It is still up but not playing: if it is played, Drashti stops it again, as it cannot be shown there. Put something else up, and after the sabha tell whoever looks after Drashti which file it was.',
    );
    expect(o.log).toEqual({
      level: 'warn',
      line: 'A video could not play on the screen “Placeholder Hall” (a decoding error): media-1; left up, not playing (paused, waiting for its click or at its end), so nothing came off',
    });
    expect(o.live).toBe('cannot');
  });

  it('with no first frame on two screens and LIVE: the screens named, LIVE not, and what the watch saw in the log', () => {
    const o = heardOutcome(
      heard({
        wheres: ['live', HALL, { screen: 'Placeholder Side' }],
        code: NO_FIRST_FRAME,
        words: 'Placeholder looks',
      }),
    );
    expect(o.notice).toContain('could not play on the screens “Placeholder Hall” and “Placeholder Side”.');
    expect(o.log?.line).toBe(
      'A video could not play on the screens “Placeholder Hall” and “Placeholder Side” (no picture within 10 s: Placeholder looks): media-1; left up, not playing (paused, waiting for its click or at its end), so nothing came off',
    );
    expect(o.live).toBe('cannot');
  });

  it('MUST-1 (Q60-51, the owner’s “Yes, A”): a waiting video only slow to start is said not to have started in time, still loading, never damaged, and LIVE says it is still loading there', () => {
    const o = heardOutcome(heard({ code: NO_START_IN_TIME }));
    expect(o.notice).toBe(
      '“Placeholder waiting video” could not start in time on the screen “Placeholder Hall”: this computer was too busy to start it in 30 seconds, and it is still loading there. The file is not damaged: wait until the line under LIVE goes before you play it.',
    );
    expect(o.live).toBe('slow');
    // A playing one paused on the slide by the take-off: the notice as before, and LIVE's still-loading line.
    const took = { background: false, slide: true, box: false };
    const paused = heardOutcome(heard({ code: NO_START_IN_TIME, took }));
    expect(paused.notice).toBe(
      cannotStartInTimeNotice('Placeholder waiting video', 'the screen “Placeholder Hall”', took),
    );
    expect(paused.live).toBe('slow');
  });

  it('MUST-3: a screen told already on this showing is not told again (only the log); a new screen is told, by itself', () => {
    const again = heardOutcome(heard({ told: ['Placeholder Hall'] }));
    expect(again.notice).toBeNull();
    expect(again.log?.line).toBe(
      'A video could not play on the screen “Placeholder Hall” (a decoding error): media-1; left up, not playing (paused, waiting for its click or at its end), so nothing came off; told already',
    );
    expect(again.live).toBe('cannot');
    const side = { screen: 'Placeholder Side', id: 'screen-side' };
    const more = heardOutcome(heard({ wheres: [HALL, side], told: ['Placeholder Hall'] }));
    expect(more.notice).toContain('could not play on the screen “Placeholder Side”.');
    expect(more.notice).not.toContain('Placeholder Hall');
    // Told by its id where it has one.
    expect(heardOutcome(heard({ wheres: [side], told: ['screen-side'] })).notice).toBeNull();
  });

  it('a showing not up by the end of the wait: only logged, nobody told, nothing under LIVE', () => {
    expect(heardOutcome(heard({ stillUp: false }))).toEqual({
      log: {
        level: 'info',
        line: 'A video could not play on the screen “Placeholder Hall” (a decoding error): media-1; not up as the show’s background, slide or box video now',
      },
      notice: null,
      live: null,
    });
  });

  it('a video waiting that only LIVE or the stream could not play: logged, no notice, nothing under LIVE (the screens show it)', () => {
    expect(heardOutcome(heard({ wheres: ['live', 'stream'] }))).toEqual({
      log: {
        level: 'warn',
        line: 'A video could not play on LIVE (a decoding error): media-1; left up, not playing (paused, waiting for its click or at its end), so nothing came off',
      },
      notice: null,
      live: null,
    });
  });

  it('a video playing on the slide is paused there as before, with the same notice, and LIVE names the screen while it stays up', () => {
    const took = { background: false, slide: true, box: false };
    const o = heardOutcome(heard({ took }));
    expect(o.notice).toBe(
      cannotPlayNotice('Placeholder waiting video', 'the screen “Placeholder Hall”', took),
    );
    expect(o.log).toEqual({
      level: 'warn',
      line: 'A video could not play on the screen “Placeholder Hall” (a decoding error): media-1; taken off (paused on the slide)',
    });
    expect(o.live).toBe('cannot');
    // Taken off, it is told even where told already (the show changed: paused there).
    expect(heardOutcome(heard({ took, told: ['Placeholder Hall'] })).notice).toBe(o.notice);
  });

  it('a background or the box taken off: the notice and the log as before, and nothing under LIVE (it is off everywhere)', () => {
    const bg = { background: true, slide: false, box: false };
    expect(heardOutcome(heard({ took: bg, stillUp: false }))).toEqual({
      log: {
        level: 'warn',
        line: 'A video could not play on the screen “Placeholder Hall” (a decoding error): media-1; taken off (the background)',
      },
      notice: cannotPlayNotice('Placeholder waiting video', 'the screen “Placeholder Hall”', bg),
      live: null,
    });
    const box = { background: false, slide: false, box: true };
    const slow = heardOutcome(heard({ took: box, stillUp: false, code: NO_START_IN_TIME }));
    expect(slow.notice).toBe(
      cannotStartInTimeNotice('Placeholder waiting video', 'the screen “Placeholder Hall”', box),
    );
    expect(slow.live).toBeNull();
  });

  it('the take-off hears every page that said so during the wait, not only their words', () => {
    let now = 0;
    const waiting: (() => void)[] = [];
    const c = new CannotPlay({
      now: () => now,
      later: (_ms, run) => {
        waiting.push(run);
      },
    });
    const got: (readonly CannotPlayWhere[])[] = [];
    const off = (_named: string, wheres: readonly CannotPlayWhere[]) => {
      got.push(wheres);
    };
    c.heard('clip@1', 'live', off, () => undefined);
    c.heard('clip@1', HALL, off, () => undefined);
    now = CANNOT_PLAY_SETTLE_MS;
    for (const run of waiting.splice(0)) run();
    expect(got).toEqual([['live', HALL]]);
  });
});
