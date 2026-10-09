import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it } from 'vitest';
import type { WatchdogEvent, WatchTarget } from './watchdog';
import { quitDetail, RendererWatchdog, shouldConfirmQuit } from './watchdog';

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

beforeEach(() => {
  clock = new Clock();
  events = [];
  dog = new RendererWatchdog((e) => events.push(e), clock);
  contents = new FakeContents();
  dog.watch(contents, 'operator', { hangMs: 5000, maxCrashesPerMinute: 3, backoffMs: [100, 1000] });
});

describe('RendererWatchdog', () => {
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
    expect(kinds()).toEqual(['unresponsive', 'hung', 'crashed', 'reloaded']);
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
    expect(quitDetail(2, off)).toBe('2 screen(s) are showing. If Drashti quits, they go black.');
    expect(quitDetail(0, { live: true, recording: false })).toBe(
      'The stream is on air. If Drashti quits, the stream ends.',
    );
    expect(quitDetail(0, { live: false, recording: true })).toBe(
      'Drashti is recording. If Drashti quits, the recording stops.',
    );
    expect(quitDetail(3, { live: true, recording: true })).toBe(
      '3 screen(s) are showing, and the stream is on air and recording. If Drashti quits, the screens go black, the stream ends and the recording stops.',
    );
  });
});
