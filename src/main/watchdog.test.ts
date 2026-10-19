import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WatchdogEvent, WatchTarget } from './watchdog';
import {
  quitDetail,
  RendererWatchdog,
  RETRY_AGAIN_MS,
  RETRY_FIRST_MS,
  shouldConfirmQuit,
  STACK_WAIT_MS,
  stackLine,
  watchdogLine,
} from './watchdog';

class FakeContents extends EventEmitter implements WatchTarget {
  reloads = 0;
  crashes = 0;
  destroyed = false;
  reload(): void {
    this.reloads++;
  }
  forcefullyCrashRenderer(): void {
    this.crashes++;
    this.emit('render-process-gone', {}, { reason: 'crashed' });
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
}

/** Manual clock and timers. */
class Clock {
  t = 0;
  private queue: { at: number; fn: () => void; id: number }[] = [];
  private next = 1;
  setTimeout = (fn: () => void, ms: number) => {
    const id = this.next++;
    this.queue.push({ at: this.t + ms, fn, id });
    return id;
  };
  clearTimeout = (id: unknown) => {
    this.queue = this.queue.filter((q) => q.id !== id);
  };
  now = () => this.t;
  advance(ms: number) {
    this.t += ms;
    const due = this.queue.filter((q) => q.at <= this.t).sort((a, b) => a.at - b.at);
    this.queue = this.queue.filter((q) => q.at > this.t);
    for (const q of due) q.fn();
  }
}

let clock: Clock;
let events: WatchdogEvent[];
let dog: RendererWatchdog;
let contents: FakeContents;

const kinds = () => events.map((e) => e.kind);
/** An event's log line, or that there was none. */
const lineOf = (e: WatchdogEvent | undefined) => (e ? watchdogLine(e) : 'no event');

beforeEach(() => {
  clock = new Clock();
  events = [];
  dog = new RendererWatchdog((e) => events.push(e), clock);
  contents = new FakeContents();
  dog.watch(contents, 'operator', { hangMs: 5000, maxCrashesPerMinute: 3, backoffMs: [100, 1000] });
});

describe('RendererWatchdog', () => {
  it('says how a crashed window’s process ended: in hex on Windows, by its signal on a Mac (Session 39)', () => {
    const win: WatchdogEvent[] = [];
    const mac: WatchdogEvent[] = [];
    const onWindows = new FakeContents();
    const onMac = new FakeContents();
    new RendererWatchdog((e) => win.push(e), clock, true, 'win32').watch(onWindows, 'operator');
    new RendererWatchdog((e) => mac.push(e), clock, true, 'darwin').watch(onMac, 'output "Main Hall"');
    onWindows.emit('render-process-gone', {}, { reason: 'crashed', exitCode: -1073741819 });
    onMac.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 11 });
    expect(win[0]).toMatchObject({ kind: 'crashed', reason: 'crashed', exit: 'exit code 0xC0000005' });
    expect(lineOf(win[0])).toBe('Watchdog: operator crashed (crashed, exit code 0xC0000005)');
    expect(lineOf(mac[0])).toBe('Watchdog: output "Main Hall" crashed (crashed, signal 11: SIGSEGV)');
    // Without a code, as before.
    contents.emit('render-process-gone', {}, { reason: 'crashed' });
    expect(lineOf(events[0])).toBe('Watchdog: operator crashed (crashed)');
  });

  it('reloads a crashed renderer after a short wait', () => {
    contents.emit('render-process-gone', {}, { reason: 'crashed' });
    expect(contents.reloads).toBe(0);
    clock.advance(100);
    expect(contents.reloads).toBe(1);
    expect(kinds()).toEqual(['crashed', 'reloaded']);
    expect(events[0]).toMatchObject({ window: 'operator', reason: 'crashed' });
  });

  it('backs off on repeated crashes and gives up in a crash loop', () => {
    for (let i = 0; i < 3; i++) {
      contents.emit('render-process-gone', {}, { reason: 'crashed' });
      clock.advance(1000);
    }
    expect(contents.reloads).toBe(3);
    contents.emit('render-process-gone', {}, { reason: 'oom' });
    clock.advance(5000);
    expect(contents.reloads).toBe(3);
    expect(kinds().at(-1)).toBe('gave-up');
  });

  it('after giving up, tries again 2 minutes later, then every 10 minutes it gives up again (Session 23)', () => {
    const crashLoop = () => {
      for (let i = 0; i < 4; i++) {
        contents.emit('render-process-gone', {}, { reason: 'crashed' });
        clock.advance(10);
      }
    };
    crashLoop();
    expect(kinds().at(-1)).toBe('gave-up');
    const reloadsWhenGivenUp = contents.reloads;
    clock.advance(RETRY_FIRST_MS - 1000);
    expect(contents.reloads).toBe(reloadsWhenGivenUp);
    clock.advance(1000);
    expect(contents.reloads).toBe(reloadsWhenGivenUp + 1);
    expect(events.at(-1)).toMatchObject({ kind: 'retried', reason: '2 minutes after giving up' });
    // Still crashing: given up on again, and this time tried again after 10 minutes.
    crashLoop();
    expect(kinds().at(-1)).toBe('gave-up');
    const again = contents.reloads;
    clock.advance(RETRY_FIRST_MS);
    expect(contents.reloads).toBe(again);
    clock.advance(RETRY_AGAIN_MS - RETRY_FIRST_MS);
    expect(contents.reloads).toBe(again + 1);
    expect(events.at(-1)).toMatchObject({ kind: 'retried', reason: '10 minutes after giving up' });
  });

  it('Try again tries at once, and its crash count starts afresh', () => {
    for (let i = 0; i < 4; i++) contents.emit('render-process-gone', {}, { reason: 'crashed' });
    expect(kinds().at(-1)).toBe('gave-up');
    const before = contents.reloads;
    expect(dog.retryNow(contents, 'Try again')).toBe(true);
    expect(contents.reloads).toBe(before + 1);
    expect(events.at(-1)).toMatchObject({ kind: 'retried', reason: 'Try again' });
    // One crash now is an ordinary one: reloaded after the first back-off.
    contents.emit('render-process-gone', {}, { reason: 'crashed' });
    clock.advance(100);
    expect(contents.reloads).toBe(before + 2);
    // The timer for the retry it no longer needs never fires.
    clock.advance(RETRY_FIRST_MS);
    expect(contents.reloads).toBe(before + 2);
    expect(dog.retryNow(new FakeContents())).toBe(false);
  });

  it('a window judged stuck from outside is crashed into the reload', () => {
    dog.stuck(contents, 'operator', 'no report for 7 s');
    expect(contents.crashes).toBe(1);
    expect(events[0]).toMatchObject({ kind: 'hung', reason: 'no report for 7 s' });
    clock.advance(100);
    expect(contents.reloads).toBe(1);
  });

  it('asks a hung window where its JavaScript is, then crashes it: its stack in the hung event (ROB-1)', async () => {
    const page = new FakeContents();
    let answer: (stack: string) => void = () => undefined;
    Object.assign(page, {
      mainFrame: { collectJavaScriptCallStack: () => new Promise<string>((resolve) => (answer = resolve)) },
    });
    dog.watch(page, 'output "Main Hall"');
    dog.stuck(page, 'output "Main Hall"', 'no report for 7 s');
    // Not crashed while it is asked: the stack would go with it.
    expect(page.crashes).toBe(0);
    answer('\n    at drashtiSelfTestHangsHere (<anonymous>:1:33)\n    at <anonymous>:1:47');
    await Promise.resolve();
    expect(page.crashes).toBe(1);
    expect(events.find((e) => e.kind === 'hung')).toMatchObject({
      window: 'output "Main Hall"',
      reason: 'no report for 7 s',
      stack: 'at drashtiSelfTestHangsHere (<anonymous>:1:33) | at <anonymous>:1:47',
    });
    clock.advance(100);
    expect(page.reloads).toBe(1);
  });

  it('crashes a hung window that does not say within a second, and leaves one that stopped by itself', () => {
    const silent = new FakeContents();
    Object.assign(silent, { mainFrame: { collectJavaScriptCallStack: () => new Promise(() => undefined) } });
    dog.watch(silent, 'output "Silent"');
    silent.emit('unresponsive');
    clock.advance(5000);
    expect(silent.crashes).toBe(0);
    clock.advance(STACK_WAIT_MS - 1);
    expect(silent.crashes).toBe(0);
    clock.advance(1);
    expect(silent.crashes).toBe(1);
    expect(events.find((e) => e.kind === 'hung')?.stack).toBe(
      `none (no answer within ${String(STACK_WAIT_MS)} ms)`,
    );

    // Asked, and it crashes by itself first: not crashed again, and the crash path reloads it once.
    events.length = 0;
    const gone = new FakeContents();
    Object.assign(gone, { mainFrame: { collectJavaScriptCallStack: () => new Promise(() => undefined) } });
    dog.watch(gone, 'output "Gone"');
    dog.stuck(gone, 'output "Gone"', 'no report for 7 s');
    gone.emit('render-process-gone', {}, { reason: 'crashed' });
    clock.advance(STACK_WAIT_MS);
    expect(gone.crashes).toBe(0);
    expect(gone.reloads).toBe(1);
    expect(events.filter((e) => e.window === 'output "Gone"').map((e) => [e.kind, e.stack])).toEqual([
      ['hung', 'none (it stopped first)'],
      ['crashed', undefined],
      ['reloaded', undefined],
    ]);
  });

  it("says a hung page's stack as one line, at most 20 frames, or why there is none", () => {
    const deep = Array.from(
      { length: 30 },
      (_, i) => `    at placeholder${String(i)} (file:///x/output.js:${String(i)}:1)`,
    );
    expect(stackLine(`\n${deep.join('\n')}`).split(' | ')).toHaveLength(20);
    expect(stackLine('Website owner has not opted in for JS call stacks in crash reports.')).toBe(
      'none (Website owner has not opted in for JS call stacks in crash reports.)',
    );
    expect(stackLine(undefined)).toBe('none (it gave none)');
  });

  it('forgets crashes older than a minute', () => {
    for (let i = 0; i < 3; i++) {
      contents.emit('render-process-gone', {}, { reason: 'crashed' });
      clock.advance(1000);
    }
    clock.advance(61_000);
    contents.emit('render-process-gone', {}, { reason: 'crashed' });
    clock.advance(100);
    expect(contents.reloads).toBe(4);
    expect(kinds()).not.toContain('gave-up');
  });

  it('ignores a clean exit and a destroyed window', () => {
    contents.emit('render-process-gone', {}, { reason: 'clean-exit' });
    contents.destroyed = true;
    contents.emit('render-process-gone', {}, { reason: 'crashed' });
    clock.advance(10_000);
    expect(contents.reloads).toBe(0);
    expect(events).toEqual([]);
  });

  it('restarts a renderer that stays unresponsive', () => {
    contents.emit('unresponsive');
    clock.advance(4999);
    expect(contents.crashes).toBe(0);
    clock.advance(1);
    expect(contents.crashes).toBe(1);
    clock.advance(100);
    expect(contents.reloads).toBe(1);
    // The restart says how long it held the main process (Session 38): here the fake crashes at once.
    expect(kinds()).toEqual(['unresponsive', 'hung', 'crashed', 'restarted', 'reloaded']);
  });

  it('leaves a renderer alone that recovers by itself', () => {
    contents.emit('unresponsive');
    clock.advance(2000);
    contents.emit('responsive');
    clock.advance(10_000);
    expect(contents.crashes).toBe(0);
    expect(kinds()).toEqual(['unresponsive', 'responsive']);
  });

  it('stops its timers when the window is destroyed', () => {
    contents.emit('render-process-gone', {}, { reason: 'crashed' });
    contents.destroyed = true;
    contents.emit('destroyed');
    clock.advance(10_000);
    expect(contents.reloads).toBe(0);
  });
});

/** A window whose crash takes a set time: Electron writes its dump inside the main process first (Session 37). */
class SlowCrash extends FakeContents {
  constructor(private readonly takesMs: number) {
    super();
  }
  override forcefullyCrashRenderer(): void {
    clock.t += this.takesMs;
    super.forcefullyCrashRenderer();
  }
}

describe('how long restarting a hung window held the main process (Session 38)', () => {
  /** The log's lines, as the main process writes them from the watchdog's events. */
  let lines: string[];
  const logging = (crashFiles: boolean) =>
    new RendererWatchdog(
      (e) => {
        events.push(e);
        lines.push(watchdogLine(e));
      },
      clock,
      crashFiles,
    );

  beforeEach(() => {
    lines = [];
  });

  it('says it once, in plain words, as a hung window that gave its stack is restarted: the stack only once', async () => {
    const dog = logging(true);
    const page = new SlowCrash(240);
    Object.assign(page, {
      mainFrame: {
        collectJavaScriptCallStack: () =>
          Promise.resolve('\n    at drashtiSelfTestHangsHere (<anonymous>:1:33)\n    at <anonymous>:1:47'),
      },
    });
    dog.watch(page, 'output "Main Hall"');
    dog.stuck(page, 'output "Main Hall"', 'no report for 7 s');
    await vi.waitFor(() => {
      expect(page.crashes).toBe(1);
    });
    expect(events.filter((e) => e.kind === 'restarted')).toEqual([
      {
        window: 'output "Main Hall"',
        kind: 'restarted',
        reason: 'Drashti waited 240 ms while it saved the crash file',
        heldMs: 240,
        at: 240,
      },
    ]);
    expect(lines).toContain(
      'Watchdog: output "Main Hall" restarted (Drashti waited 240 ms while it saved the crash file)',
    );
    expect(lines.filter((line) => line.includes('drashtiSelfTestHangsHere'))).toEqual([
      'Watchdog: output "Main Hall" hung (no report for 7 s); its JavaScript: at drashtiSelfTestHangsHere (<anonymous>:1:33) | at <anonymous>:1:47',
    ]);
    // The rest as before: the crash path reloads it.
    clock.advance(100);
    expect(page.reloads).toBe(1);
  });

  it('says it for a hung window with no page to ask (no stack), and when no crash file is kept', () => {
    const dog = logging(true);
    const bare = new SlowCrash(1153);
    dog.watch(bare, 'operator', { hangMs: 5000 });
    bare.emit('unresponsive');
    clock.advance(5000);
    expect(bare.crashes).toBe(1);
    expect(events.find((e) => e.kind === 'restarted')).toMatchObject({ window: 'operator', heldMs: 1153 });
    expect(lines).toContain(
      'Watchdog: operator restarted (Drashti waited 1153 ms while it saved the crash file)',
    );
    // Running translated, Drashti keeps no crash files (crash-files.ts): the wait is the restart's alone.
    events.length = 0;
    const translated = logging(false);
    const other = new SlowCrash(2);
    translated.watch(other, 'audio player', { hangMs: 5000 });
    other.emit('unresponsive');
    clock.advance(5000);
    expect(lines).toContain(
      'Watchdog: audio player restarted (Drashti waited 2 ms; no crash file while Drashti runs translated)',
    );
  });

  it('says no wait for a hung window that stopped by itself while it was asked (it was never restarted)', () => {
    const dog = logging(true);
    const gone = new SlowCrash(240);
    Object.assign(gone, { mainFrame: { collectJavaScriptCallStack: () => new Promise(() => undefined) } });
    dog.watch(gone, 'output "Gone"');
    dog.stuck(gone, 'output "Gone"', 'no report for 7 s');
    gone.emit('render-process-gone', {}, { reason: 'crashed' });
    clock.advance(STACK_WAIT_MS);
    expect(gone.crashes).toBe(0);
    expect(events.filter((e) => e.kind === 'restarted')).toEqual([]);
  });
});

describe('a render error (Session 23)', () => {
  it('reloads the window once, through the same reload a crash gets; again only after a minute', () => {
    dog.renderError(contents, 'output "Main Hall"', 'Error: boom');
    expect(kinds()).toEqual(['render-error']);
    expect(contents.reloads).toBe(0);
    clock.advance(100);
    expect(contents.reloads).toBe(1);
    expect(kinds()).toEqual(['render-error', 'reloaded']);
    // It fails again as it draws after the reload: logged, not reloaded again within the minute.
    clock.advance(5000);
    dog.renderError(contents, 'output "Main Hall"', 'Error: boom');
    clock.advance(10_000);
    expect(contents.reloads).toBe(1);
    expect(kinds()).toEqual(['render-error', 'reloaded', 'render-error']);
    // A minute after the reload, once more.
    clock.advance(50_000);
    dog.renderError(contents, 'output "Main Hall"', 'Error: boom');
    clock.advance(100);
    expect(contents.reloads).toBe(2);
  });

  it('each window has its own minute, and a window gone is not reloaded', () => {
    const other = new FakeContents();
    dog.renderError(contents, 'output "Main Hall"', 'Error: boom');
    dog.renderError(other, 'output "Stage"', 'Error: boom');
    other.destroyed = true;
    clock.advance(100);
    expect(contents.reloads).toBe(1);
    expect(other.reloads).toBe(0);
  });
});

describe('shouldConfirmQuit', () => {
  it('asks only while outputs are showing, once, unless switched off', () => {
    expect(shouldConfirmQuit(2, false, false)).toBe(true);
    expect(shouldConfirmQuit(0, false, false)).toBe(false);
    expect(shouldConfirmQuit(2, true, false)).toBe(false);
    expect(shouldConfirmQuit(2, false, true)).toBe(false);
  });

  it('asks while the stream is on air or recording, with no screen showing (Session 23)', () => {
    expect(shouldConfirmQuit(0, false, false, true)).toBe(true);
    expect(shouldConfirmQuit(0, true, false, true)).toBe(false);
    expect(shouldConfirmQuit(0, false, true, true)).toBe(false);
  });
});

describe('quitDetail', () => {
  const off = { live: false, recording: false };
  it('names the screens, and the stream when it is on air or recording', () => {
    expect(quitDetail(2, off)).toBe('2 screens are showing. If Drashti quits, they go black.');
    expect(quitDetail(1, off)).toBe('1 screen is showing. If Drashti quits, it goes black.');
    expect(quitDetail(0, { live: true, recording: false })).toBe(
      'The stream is on air. If Drashti quits, the stream ends.',
    );
    expect(quitDetail(0, { live: false, recording: true })).toBe(
      'Drashti is recording. If Drashti quits, the recording stops.',
    );
    expect(quitDetail(3, { live: true, recording: true })).toBe(
      '3 screens are showing, and the stream is on air and recording. If Drashti quits, the screens go black, the stream ends and the recording stops.',
    );
  });
});
