import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { openDatabase } from './db/database';
import { PresentationRepo } from './db/presentations';
import { answerWithin, presentationToShow, waitFor } from './selftest';

describe('what the watchdog self-test shows (Session 50: a new library has no placeholder presentations)', () => {
  it("shows the library's first presentation when it has one, and adds nothing", () => {
    const ctx = {
      firstPresentationId: () => 'placeholder-first',
      addPresentation: vi.fn(() => 'made'),
      removePresentation: vi.fn(),
    };
    const shown = presentationToShow(ctx);
    expect(shown.id).toBe('placeholder-first');
    shown.done();
    expect(ctx.addPresentation).not.toHaveBeenCalled();
    expect(ctx.removePresentation).not.toHaveBeenCalled();
  });

  it('in a library with none (the installed app’s check starts in a new one) brings slides of its own, and takes them out after', () => {
    const db = openDatabase(':memory:');
    const repo = new PresentationRepo(db);
    const removed: string[] = [];
    const shown = presentationToShow({
      firstPresentationId: () => repo.list()[0]?.id ?? null,
      // As index.ts puts it in the library, and takes it out (the trash's remove).
      addPresentation: (doc) => repo.insert({ libraryId: repo.ensureLibrary('Default'), ...doc }),
      removePresentation: (id) => {
        removed.push(...repo.remove([id]));
      },
    });
    const listed = repo.list();
    expect(listed.map((p) => p.id)).toEqual([shown.id]);
    expect(listed[0]?.name).toMatch(/^Placeholder/u);
    // Words on every slide, each slide's its own: the output must show something, and Next must change it.
    const slides = repo.get(shown.id)?.groups.flatMap((g) => g.slides.map((s) => s.slide)) ?? [];
    expect(slides.length).toBeGreaterThanOrEqual(2);
    const words = slides.map((s) =>
      s.elements.flatMap((e) => (e.kind === 'text' ? [e.text] : [])).join(' / '),
    );
    expect(words.every((w) => w.startsWith('Placeholder'))).toBe(true);
    expect(new Set(words).size).toBe(slides.length);
    shown.done();
    expect(removed).toEqual([shown.id]);
    expect(repo.list()).toEqual([]);
    db.close();
  });
});

describe('the watchdog self-test behind the lock (Session 54, access by Gmail)', () => {
  it('moves the show on from the main process, never by a key in the operator window, whose controls stay locked', () => {
    const source = readFileSync(join(__dirname, 'selftest.ts'), 'utf8');
    const watchdog = source.slice(
      source.indexOf('export async function runWatchdogSelfTest'),
      source.indexOf('export async function runNodeWatchdogSelfTest'),
    );
    expect(watchdog).not.toContain('sendInputEvent');
    expect(watchdog).toContain("ctx.dispatch({ type: 'next' })");
  });
});

describe('a page that never answers never stops the watchdog self-test (alpha.22 Release run 45524056204)', () => {
  // Electron 44: a page's renderer crashed or reloaded while executeJavaScript waits for its answer leaves that call
  // pending for good, neither resolved nor rejected. On CI's Rosetta Mac the output's heartbeat restarted a slow page
  // during such a call, and the self-test gave no result in 480 s.
  const never = () => new Promise<never>(() => undefined);

  it('answerWithin rejects a call that never answers, at its limit', async () => {
    const started = Date.now();
    await expect(answerWithin(never(), 120, 'the output page')).rejects.toThrow(/the output page/);
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('answerWithin gives an answer that comes in time, and leaves no timer behind', async () => {
    vi.useFakeTimers();
    try {
      const answer = answerWithin(Promise.resolve(7), 5000, 'the output page');
      await expect(answer).resolves.toBe(7);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waitFor keeps its own deadline when a check never answers', async () => {
    const started = Date.now();
    await expect(waitFor(never, 200)).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('waitFor still says yes when a later try answers', async () => {
    let tries = 0;
    // As a page call does: each try has its own limit (js(): answerWithin), so a try that never answers ends.
    const check = () => (++tries < 3 ? answerWithin(never(), 50, 'the output page') : Promise.resolve(true));
    await expect(waitFor(check, 3000)).resolves.toBe(true);
    expect(tries).toBe(3);
  });
});
