import { describe, expect, it } from 'vitest';
import { openDatabase } from './db/database';
import { PresentationRepo } from './db/presentations';
import { libraryNames } from './diagnostics';
import { blankQuoted, CommandLog, requestLogged } from './log-commands';

/*
 * A line in the log for every show command and every operator request (alpha.21, logs for 100+ installs (a), the
 * owner's "for all users there should be a log of everythiing"): its name, its ids, numbers and choices, and what came
 * of it; never content (no words, titles or names). A burst of the same one (a slider, a drag) is one line, then one
 * line counting the rest. Lines are written after the command has been answered (a turn later), never in its way.
 * Placeholder ids only; the clock and the timers are the test's own.
 */

function harness(names: () => readonly string[] = () => []) {
  const lines: string[] = [];
  let now = 1_000_000;
  const timers: { at: number; run: () => void }[] = [];
  const log = new CommandLog({
    libraryNames: names,
    write: (line) => lines.push(line),
    now: () => now,
    setTimer: (ms, run) => {
      const t = { at: now + ms, run };
      timers.push(t);
      return () => {
        timers.splice(timers.indexOf(t), 1);
      };
    },
  });
  /** The clock moved on by `ms`, every timer due by then run. */
  const pass = (ms: number) => {
    now += ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers.splice(timers.indexOf(due), 1);
      due.run();
    }
  };
  return { log, lines, pass };
}

describe('the log of every show command (alpha.21, logs (a))', () => {
  it('names each command with its ids, numbers and choices and what came of it, a turn later', () => {
    const { log, lines, pass } = harness();
    log.show(
      {
        type: 'goLive',
        presentationId: 'p-0001',
        slideIndex: 3,
        arrangementId: null,
        playlist: { playlistId: 'pl-0002', itemId: 'it-0003' },
      },
      { ok: true, changed: true, rev: 41 },
    );
    expect(lines).toEqual([]);
    pass(0);
    expect(lines).toEqual([
      'Show: goLive presentationId=p-0001 slideIndex=3 playlist.playlistId=pl-0002 playlist.itemId=it-0003: done (revision 41)',
    ]);
    log.show(
      { type: 'next', rev: 41, session: 'placeholder-session' },
      { ok: true, changed: false, rev: 41 },
    );
    log.show(
      { type: 'clearLayer', layer: 'background' },
      { ok: false, error: 'forbidden', message: 'Placeholder' },
    );
    pass(0);
    expect(lines.slice(1)).toEqual([
      'Show: next rev=41: nothing changed (revision 41)',
      'Show: clearLayer layer=background: not done (forbidden)',
    ]);
  });

  it('never writes words, titles or names: only ids, numbers, true or false, and a choice’s own word', () => {
    const { log, lines, pass } = harness();
    log.show(
      {
        type: 'showMessage',
        message: { id: 'm-0001', text: 'Placeholder secret words', look: { size: 'large' } },
      },
      { ok: true, changed: true, rev: 2 },
    );
    log.show(
      {
        type: 'playAudio',
        audio: {
          id: 'a-0001',
          title: 'Placeholder Secret Title',
          mediaId: 'md-0009',
          volume: 0.5,
          loop: true,
        },
      },
      { ok: true, changed: true, rev: 3 },
    );
    log.show(
      { type: 'setStageMessage', text: 'Placeholder stage words', size: 'large' },
      { ok: true, changed: true, rev: 4 },
    );
    log.show(
      {
        type: 'showLowerThird',
        lowerThird: { id: 'lt-0001', name: 'Placeholder Name', lines: ['Placeholder line'] },
      },
      { ok: true, changed: true, rev: 5 },
    );
    log.show(
      {
        type: 'playMusic',
        music: {
          playlistId: 'pl-9',
          name: 'Placeholder List',
          tracks: [
            { mediaId: 'x', title: 'y' },
            { mediaId: 'z', title: 'w' },
          ],
        },
      },
      { ok: true, changed: true, rev: 6 },
    );
    pass(0);
    const all = lines.join('\n');
    for (const secret of [
      'Placeholder secret words',
      'Placeholder Secret Title',
      'Placeholder stage words',
      'Placeholder Name',
      'Placeholder line',
      'Placeholder List',
    ])
      expect(all, secret).not.toContain(secret);
    expect(lines[0]).toBe('Show: showMessage message.id=m-0001: done (revision 2)');
    expect(lines[1]).toBe(
      'Show: playAudio audio.id=a-0001 audio.mediaId=md-0009 audio.volume=0.5 audio.loop=true: done (revision 3)',
    );
    expect(lines[2]).toBe('Show: setStageMessage size=large: done (revision 4)');
    expect(lines[4]).toBe('Show: playMusic music.playlistId=pl-9 music.tracks=2 items: done (revision 6)');
  });

  it('a burst of the same command is one line, then one counting the rest; another command is its own line', () => {
    const { log, lines, pass } = harness();
    for (let i = 0; i < 40; i++) {
      log.show({ type: 'zoomLive', zoom: 1 + i / 40, x: 0, y: 0 }, { ok: true, changed: true, rev: 10 + i });
      pass(20);
    }
    log.show({ type: 'next' }, { ok: true, changed: true, rev: 60 });
    pass(2000);
    expect(lines[0]).toBe('Show: zoomLive zoom=1 x=0 y=0: done (revision 10)');
    expect(lines.filter((l) => l.startsWith('Show: zoomLive')).length).toBeLessThanOrEqual(3);
    const counted = lines.filter((l) => l.includes(' more in '));
    expect(counted.length).toBeGreaterThan(0);
    expect(counted.reduce((n, l) => n + Number(/×(\d+) more/u.exec(l)?.[1] ?? 0), 0)).toBe(39);
    expect(counted.at(-1)).toMatch(
      /^Show: zoomLive ×\d+ more in [\d.]+ s \(the last: zoom=1\.975 x=0 y=0: done \(revision 49\)\)$/u,
    );
    expect(lines).toContain('Show: next: done (revision 60)');
  });
});

describe('the log of what the show did by itself (alpha.21, logs (a))', () => {
  it('names what changed (the parts of the show, never what they hold) and the revision; a burst of the same is one line, then a count', () => {
    const { log, lines, pass } = harness();
    log.changedByItself(12, ['slide', 'background']);
    pass(0);
    expect(lines).toEqual(['Show: changed by itself: slide, background (revision 12)']);
    log.changedByItself(13, ['messages']);
    log.changedByItself(14, ['messages']);
    pass(2000);
    expect(lines.slice(1)).toEqual([
      'Show: changed by itself: messages (revision 13)',
      'Show: changed by itself: messages ×1 more in 0.0 s (the last: revision 14)',
    ]);
  });
});

describe('the log of every operator request (alpha.21, logs (a))', () => {
  it('names each request that changes something, and how it went; reads and the window’s own bookkeeping are left out', () => {
    for (const c of [
      'playlists:rename',
      'stream:go-live',
      'stream:end',
      'screens:update-screen',
      'library:import-paths',
      'updates:download',
      'media:convert',
    ])
      expect(requestLogged(c), c).toBe(true);
    for (const c of [
      'library:list-presentations',
      'playlists:items',
      'screens:get',
      'stream:status',
      'media:details',
      'engine:command',
      'engine:subscribe',
      'output:report',
      'app:render-error',
      'media:clip-clips',
      'accesslist:refresh',
      'pictures:page',
      'nodes:thumbs',
    ])
      expect(requestLogged(c), c).toBe(false);
    const { log, lines, pass } = harness();
    log.request('playlists:rename', 'done');
    log.request('library:list-presentations', 'done');
    log.request('stream:go-live', 'not done');
    log.request('backups:run-now', 'refused (Simple Mode)');
    log.request(
      'media:convert',
      'failed',
      new Error('Placeholder failure at /Users/someone/Placeholder.mov'),
    );
    pass(0);
    expect(lines).toEqual([
      'Request: playlists:rename: done',
      'Request: stream:go-live: not done',
      'Request: backups:run-now: refused (Simple Mode)',
      'Request: media:convert: failed (Error)',
    ]);
  });
});

describe('the log of every notice (alpha.21, logs (a))', () => {
  it('writes the notice’s words with any name in quotes blanked', () => {
    const { log, lines, pass } = harness();
    log.notice('“Placeholder Secret.mov”: this computer can’t show its picture, so it came off the screens.');
    log.notice('Could not save diagnostics: see the log in the data folder.');
    pass(0);
    expect(lines).toEqual([
      'Notice: “…”: this computer can’t show its picture, so it came off the screens.',
      'Notice: Could not save diagnostics: see the log in the data folder.',
    ]);
    expect(blankQuoted('the playlist "Placeholder Sabha" and “Placeholder Kirtan”, can’t')).toBe(
      'the playlist "…" and “…”, can’t',
    );
  });
});

describe('notice names in the computer’s own log', () => {
  it('blanks unquoted library names before the log receives a line, using the current library', () => {
    const db = openDatabase(':memory:');
    try {
      const repo = new PresentationRepo(db);
      const { log, lines, pass } = harness(() => libraryNames(db));
      log.notice('Could not save diagnostics: see the log in the data folder.');
      repo.insert({
        libraryId: repo.ensureLibrary('Placeholder library'),
        name: 'Placeholder Private Presentation',
        groups: [{ name: 'Placeholder private group', slides: [{ elements: [] }] }],
      });
      log.notice('Could not open placeholder private presentation, slide 3.');
      log.notice('Placeholder private group could not be opened.');
      pass(0);
      expect(lines).toEqual([
        'Notice: Could not save diagnostics: see the log in the data folder.',
        'Notice: Could not open [library name], slide 3.',
        'Notice: [library name] could not be opened.',
      ]);
    } finally {
      db.close();
    }
  });

  it('blanks a library name only where it is the name, never inside other words (QA24-DIAG-1)', () => {
    const { log, lines, pass } = harness(() => ['New', 'Main']);
    log.notice('The newest copy is kept: the main window renewed it.');
    log.notice('New could not be opened in the domain.');
    pass(0);
    expect(lines).toEqual([
      'Notice: The newest copy is kept: the [library name] window renewed it.',
      'Notice: [library name] could not be opened in the domain.',
    ]);
  });

  it('never logs a notice’s words if its library names cannot be read', () => {
    const { log, lines, pass } = harness(() => {
      throw new Error('Placeholder private database failure');
    });
    expect(() => log.notice('Could not open Placeholder private presentation.')).not.toThrow();
    pass(0);
    expect(lines).toEqual(['Notice: [words unavailable]']);
  });
});
