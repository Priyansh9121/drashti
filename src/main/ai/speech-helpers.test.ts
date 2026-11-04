import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../db/database';
import { SettingsRepo } from '../db/settings';
import { ShastraRepo } from '../db/shastra';
import { createFakeSpeechHub } from '../speech/speech-hub';
import { readShastraFile } from '../../shared/shastra';
import type { Heard } from '../../shared/speech';
import type { AiWorkerRpc } from './rpc';
import { SpeechHelpers, type HeardLive } from './speech-helpers';

const phrase = (text: string, id = 's1', final = true): Omit<Heard, 'heardAt'> => ({
  id,
  final,
  text,
  language: 'en',
  languageConfidence: 0.9,
  startAt: Date.now() - 1000,
  endAt: Date.now() - 100,
  words: text.split(' ').map((word, i) => ({
    text: word,
    startAt: Date.now() - 1000 + i * 40,
    endAt: Date.now() - 980 + i * 40,
    confidence: 0.9,
  })),
});
function setup() {
  const db = openDatabase(':memory:');
  const books = new ShastraRepo(db);
  const read = readShastraFile({
    format: 'drashti-shastra',
    version: 1,
    name: 'Placeholder Lantern Book',
    abbreviation: 'PLB',
    items: [{ number: 1, text: { en: 'A placeholder lantern shines beside an invented boat.' } }],
  });
  if (!read.ok) throw new Error(read.message);
  books.load(read.text, { path: null, hash: 'placeholder' }, 'plain');
  let owner: number | null = 7;
  let live: HeardLive | null = {
    presentationId: 'placeholder-kirtan',
    slideIndex: 0,
    slideCount: 4,
    shownAt: Date.now(),
    text: 'Placeholder chorus line',
    kirtan: true,
  };
  const hub = createFakeSpeechHub();
  const changed = vi.fn();
  const showBook = vi.fn(() => true);
  const next = vi.fn(() => true);
  const cancel = vi.fn();
  const run = vi.fn<AiWorkerRpc['run']>((job) =>
    Promise.resolve(
      job.kind === 'rank'
        ? job.rows.map((row) => ({ id: row.id, score: 0.95 }))
        : { hints: [], after: { row: 0, part: 0 }, finished: true },
    ),
  );
  const helpers = new SpeechHelpers({
    hub,
    settings: new SettingsRepo(db),
    books,
    rpc: { run, cancel, busy: vi.fn() },
    owner: () => owner,
    live: () => live,
    showBook,
    next,
    changed,
  });
  return {
    db,
    books,
    hub,
    run,
    cancel,
    showBook,
    next,
    changed,
    helpers,
    owner: (value: number | null) => {
      owner = value;
    },
    live: (value: HeardLive | null) => {
      live = value;
    },
  };
}
type Fixture = ReturnType<typeof setup>;
let s: Fixture;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-04T08:00:00Z'));
  s = setup();
});
afterEach(() => {
  s.helpers.suspend();
  s.db.close();
  vi.useRealTimers();
});
describe('operator-only speech suggestions', () => {
  it('starts off, rejects another owner and bad settings without starting work', () => {
    expect(s.helpers.get(7)).toMatchObject({ ok: true, value: { settings: { books: false, verse: false } } });
    expect(s.helpers.set(8, { books: true, verse: true }).ok).toBe(false);
    expect(s.helpers.set(7, { books: true, verse: true, extra: 'no' }).ok).toBe(false);
    s.hub.setState({ phase: 'listening', language: 'auto' });
    s.hub.say(phrase('Invented unheard sample'));
    expect(s.run).not.toHaveBeenCalled();
    expect(s.next).not.toHaveBeenCalled();
    expect(s.showBook).not.toHaveBeenCalled();
  });
  it('publishes exact loaded matches while meaning works, with no show before approval', async () => {
    s.helpers.set(7, { books: true, verse: false });
    let finish: ((value: unknown) => void) | undefined;
    s.run.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = s.helpers.search(7, { query: 'lantern' });
    const initial = s.helpers.get(7);
    if (!initial.ok) throw new Error('No view');
    expect(initial.value.books).toMatchObject({
      checking: true,
      hits: [{ reference: 'Placeholder Lantern Book 1' }],
    });
    expect(s.showBook).not.toHaveBeenCalled();
    finish?.({ hints: [], after: { row: 0, part: 0 }, finished: true });
    await pending;
    const view = s.helpers.get(7);
    if (!view.ok || !view.value.books) throw new Error('No review');
    const approval = { id: view.value.books.id, passageId: view.value.books.hits[0]?.passageId };
    expect(s.helpers.showBook(8, approval).ok).toBe(false);
    expect(s.helpers.showBook(7, { ...approval, passageId: 'shastra:foreign#99' }).ok).toBe(false);
    expect(s.helpers.showBook(7, approval).ok).toBe(true);
    expect(s.showBook).toHaveBeenCalledTimes(1);
    s.db.prepare("UPDATE shastra_item_texts SET text='Changed placeholder source' WHERE made=0").run();
    expect(s.helpers.showBook(7, approval).ok).toBe(false);
  });
  it('coalesces final phrases and never does work inside the hub listener or sends the transcript', async () => {
    s.helpers.set(7, { books: true, verse: false });
    s.hub.setState({ phase: 'listening', language: 'auto' });
    s.hub.say(phrase('Invented partial words', 's1', false));
    s.hub.say(phrase('Invented first final', 's1'));
    s.hub.say(phrase('Invented latest ephemeral phrase', 's2'));
    expect(s.run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(s.run).toHaveBeenCalledTimes(1);
    expect(s.run).toHaveBeenCalledWith({ kind: 'books', query: 'Invented latest ephemeral phrase' });
    expect(JSON.stringify(s.changed.mock.calls)).not.toContain('Invented latest ephemeral phrase');
    expect(s.showBook).not.toHaveBeenCalled();
    expect(s.next).not.toHaveBeenCalled();
  });
  it('discards an in-flight response after off or lost Pro ownership', async () => {
    s.helpers.set(7, { books: true, verse: false });
    let finish: ((value: unknown) => void) | undefined;
    s.run.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = s.helpers.search(7, { query: 'lantern' });
    s.helpers.set(7, { books: false, verse: false });
    finish?.({ hints: [], after: { row: 0, part: 0 }, finished: true });
    expect((await pending).ok).toBe(false);
    expect(s.helpers.get(7)).toMatchObject({ ok: true, value: { books: null } });
    s.owner(null);
    s.helpers.refresh();
    expect(s.helpers.get(7).ok).toBe(false);
    expect(s.cancel).toHaveBeenCalled();
    expect(s.showBook).not.toHaveBeenCalled();
  });
  it('only suggests Next for the current kirtan, waits for a press and rejects a changed LIVE', async () => {
    s.helpers.set(7, { books: false, verse: true });
    s.hub.setState({ phase: 'listening', language: 'auto' });
    s.hub.say(phrase('Placeholder chorus line'));
    await vi.advanceTimersByTimeAsync(1);
    const first = s.helpers.get(7);
    if (!first.ok || !first.value.verse) throw new Error('No verse');
    expect(s.next).not.toHaveBeenCalled();
    expect(s.helpers.nextVerse(8, first.value.verse.id).ok).toBe(false);
    s.live(null);
    expect(s.helpers.nextVerse(7, first.value.verse.id).ok).toBe(false);
    s.live({
      presentationId: 'placeholder-kirtan',
      slideIndex: 1,
      slideCount: 4,
      shownAt: Date.now(),
      text: 'Placeholder next words',
      kirtan: true,
    });
    s.hub.say(phrase('Placeholder next words', 's2'));
    await vi.advanceTimersByTimeAsync(2100);
    const second = s.helpers.get(7);
    if (!second.ok || !second.value.verse) throw new Error('No next verse');
    expect(s.helpers.nextVerse(7, second.value.verse.id).ok).toBe(true);
    expect(s.next).toHaveBeenCalledTimes(1);
    expect(s.helpers.nextVerse(7, second.value.verse.id).ok).toBe(false);
  });
  it('ignores partials, uncertain words, non-kirtans and held speech', async () => {
    s.helpers.set(7, { books: false, verse: true });
    s.hub.setState({ phase: 'listening', language: 'auto' });
    s.hub.say(phrase('Placeholder partial words', 's1', false));
    s.hub.say({ ...phrase('Placeholder uncertain words', 's2'), languageConfidence: 0.2 });
    await vi.advanceTimersByTimeAsync(1);
    expect(s.run).not.toHaveBeenCalled();
    s.live({
      presentationId: 'not-kirtan',
      slideIndex: 0,
      slideCount: 3,
      shownAt: Date.now(),
      text: 'Placeholder plain words',
      kirtan: false,
    });
    s.hub.say(phrase('Placeholder plain words', 's3'));
    await vi.advanceTimersByTimeAsync(2100);
    expect(s.run).not.toHaveBeenCalled();
    s.hub.setState({ phase: 'held', reason: 'busy' });
    expect(s.helpers.get(7)).toMatchObject({ ok: true, value: { verse: null, listening: 'held' } });
  });
});
