import { describe, expect, it, vi } from 'vitest';
import { openDatabase } from './db/database';
import { PresentationRepo } from './db/presentations';
import { presentationToShow } from './selftest';

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
    expect(words.every((w) => /^Placeholder/u.test(w))).toBe(true);
    expect(new Set(words).size).toBe(slides.length);
    shown.done();
    expect(removed).toEqual([shown.id]);
    expect(repo.list()).toEqual([]);
    db.close();
  });
});
