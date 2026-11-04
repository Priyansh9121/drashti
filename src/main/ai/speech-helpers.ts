import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  bookQuerySchema,
  bookHintSchema,
  speechHelperSettings,
  speechHelperSettingsSchema,
  type BookReview,
  type SpeechHelperSettings,
  type SpeechHelperView,
} from '../../shared/ai-speech';
import type { AiResult } from '../../shared/ai';
import { parsePassageId } from '../../shared/shastra';
import { cutText } from '../../shared/text';
import type { Heard } from '../../shared/speech';
import type { SpeechHub } from '../speech/speech-hub';
import type { SettingsRepo } from '../db/settings';
import type { ShastraRepo } from '../db/shastra';
import type { AiWorkerRpc } from './rpc';
import { bookCursorSchema } from './protocol';

export interface HeardLive {
  presentationId: string;
  slideIndex: number;
  slideCount: number;
  shownAt: number;
  text: string;
  kirtan: boolean;
}
interface Options {
  hub: SpeechHub;
  settings: SettingsRepo;
  books: ShastraRepo;
  rpc: Pick<AiWorkerRpc, 'run' | 'cancel' | 'busy'>;
  owner: () => number | null;
  live: () => HeardLive | null;
  showBook: (passageId: string) => boolean;
  next: () => boolean;
  changed: (view: SpeechHelperView) => void;
}
const REFUSED = 'Speech helpers are available to the operator in Pro Mode.';
const STALE = 'The source or show changed. Ask for a new suggestion.';
const UNAVAILABLE = 'The helper could not finish. The show has not changed.';
const approvalSchema = z.object({ id: z.string().max(100), passageId: z.string().max(512) }).strict();
const rankedSchema = z.array(z.object({ id: z.string(), score: z.number().min(0).max(1) }).strict()).max(50);
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class SpeechHelpers {
  private settings: SpeechHelperSettings;
  private generation = 0;
  private queryGeneration = 0;
  private bookReview: BookReview | null = null;
  private verse: { id: string; tag: string; created: number } | null = null;
  private bookSources = new Map<string, string>();
  private bookOwner: number | null = null;
  private bookCreated = 0;
  private problem: string | null = null;
  private unlisten: (() => void) | null = null;
  private unwatch: (() => void) | null = null;
  private listenerOwner: number | null = null;
  private pending: { text: string; until: number } | null = null;
  private trailing: ReturnType<typeof setTimeout> | null = null;
  private working = false;
  private nextAt = 0;
  private busyUntil = 0;
  constructor(private readonly options: Options) {
    this.settings = speechHelperSettings(options.settings.get('ai.speech'));
  }
  private allowed(owner: number): boolean {
    return this.options.owner() === owner;
  }
  private view(): SpeechHelperView {
    return {
      settings: { ...this.settings },
      listening: this.options.hub.state().phase,
      books: this.bookReview,
      verse: this.verse
        ? { id: this.verse.id, label: 'The heard words match this verse. Review Next, then press it.' }
        : null,
      problem: this.problem,
    };
  }
  private tell(): void {
    if (this.options.owner() !== null) this.options.changed(this.view());
  }
  get(owner: number): AiResult<SpeechHelperView> {
    if (!this.allowed(owner)) return { ok: false, message: REFUSED };
    this.refresh();
    return { ok: true, value: this.view() };
  }
  set(owner: number, input: unknown): AiResult<SpeechHelperView> {
    if (!this.allowed(owner)) return { ok: false, message: REFUSED };
    const value = speechHelperSettingsSchema.safeParse(input);
    if (!value.success) return { ok: false, message: 'Choose both speech helpers on or off.' };
    this.suspend();
    this.problem = null;
    this.settings = value.data;
    this.options.settings.set('ai.speech', this.settings);
    this.refresh();
    this.tell();
    return { ok: true, value: this.view() };
  }
  refresh(): void {
    const owner = this.options.owner();
    if (owner === null || (!this.settings.books && !this.settings.verse)) {
      if (this.unlisten) this.suspend();
      return;
    }
    if (this.unlisten && this.listenerOwner === owner) return;
    this.suspend();
    this.listenerOwner = owner;
    this.unlisten = this.options.hub.listen('helper:references-and-singing', (heard) => this.heard(heard));
    this.unwatch = this.options.hub.onState((state) => {
      if (state.phase !== 'listening') {
        this.pending = null;
        this.verse = null;
        if (this.bookReview?.source === 'speech') {
          this.queryGeneration++;
          this.bookReview = null;
          this.bookSources.clear();
        }
      }
      this.tell();
    });
  }
  suspend(): void {
    this.generation++;
    this.queryGeneration++;
    this.unlisten?.();
    this.unwatch?.();
    this.unlisten = null;
    this.unwatch = null;
    this.listenerOwner = null;
    if (this.trailing) clearTimeout(this.trailing);
    this.trailing = null;
    this.pending = null;
    this.verse = null;
    this.bookReview = null;
    this.bookSources.clear();
    this.bookOwner = null;
    this.options.rpc.cancel();
  }
  busy(until: number): void {
    this.busyUntil = Math.max(this.busyUntil, until);
    this.options.rpc.busy(until);
  }
  liveChanged(): void {
    if (this.verse && this.verse.tag !== fingerprint(this.options.live())) {
      this.verse = null;
      this.tell();
    }
  }
  private heard(heard: Heard): void {
    // The hub callback only copies a bounded final phrase and schedules work; no database/model/UI work here.
    if (
      !heard.final ||
      this.options.owner() === null ||
      this.options.hub.state().phase !== 'listening' ||
      Date.now() - heard.endAt > 10000 ||
      heard.words.length < 2 ||
      (heard.languageConfidence !== null && heard.languageConfidence < 0.5)
    )
      return;
    if (heard.words.some((word) => word.confidence !== null && word.confidence < 0.5)) return;
    this.pending = { text: cutText(heard.text, 500), until: heard.endAt + 10000 };
    this.schedule();
  }
  private schedule(): void {
    if (this.trailing || this.working || !this.pending) return;
    this.trailing = setTimeout(
      () => {
        this.trailing = null;
        void this.drain();
      },
      Math.max(0, this.nextAt - Date.now(), this.busyUntil - Date.now()),
    );
  }
  private async drain(): Promise<void> {
    const pending = this.pending;
    this.pending = null;
    const owner = this.options.owner();
    if (
      !pending ||
      owner === null ||
      pending.until < Date.now() ||
      this.options.hub.state().phase !== 'listening'
    )
      return;
    if (Date.now() < this.busyUntil) {
      this.pending = pending;
      this.schedule();
      return;
    }
    this.working = true;
    const generation = this.generation;
    try {
      const live = this.options.live();
      if (
        this.settings.verse &&
        live?.kirtan &&
        live.text.trim() !== '' &&
        live.slideIndex + 1 < live.slideCount
      ) {
        const tag = fingerprint(live);
        const result = rankedSchema.safeParse(
          await this.options.rpc.run({
            kind: 'rank',
            query: pending.text,
            rows: [{ id: tag, text: cutText(live.text, 2000) }],
          }),
        );
        if (
          generation === this.generation &&
          this.allowed(owner) &&
          fingerprint(this.options.live()) === tag &&
          this.options.hub.state().phase === 'listening' &&
          result.success &&
          result.data.some((row) => row.id === tag && row.score >= 0.86)
        ) {
          if (pending.until >= Date.now()) {
            this.verse = { id: randomUUID(), tag, created: Date.now() };
            this.tell();
          }
        }
      }
      if (this.settings.books && pending.until >= Date.now())
        await this.search(owner, { query: pending.text }, 'speech', pending.until);
    } catch {
      if (generation === this.generation) {
        this.problem = UNAVAILABLE;
        this.tell();
      }
    } finally {
      this.working = false;
      this.nextAt = Date.now() + 2000;
      this.schedule();
    }
  }
  private signature(id: string): string | null {
    const key = parsePassageId(id);
    const passage = key ? this.options.books.passage(key) : null;
    return passage ? fingerprint(passage) : null;
  }
  async search(
    owner: number,
    input: unknown,
    source: 'typed' | 'speech' = 'typed',
    until = Infinity,
  ): Promise<AiResult<SpeechHelperView>> {
    if (!this.allowed(owner) || !this.settings.books) return { ok: false, message: REFUSED };
    const query = bookQuerySchema.safeParse(input);
    if (!query.success) return { ok: false, message: 'Type up to 500 characters to look in loaded Books.' };
    const generation = this.generation;
    const request = ++this.queryGeneration;
    const current = () =>
      generation === this.generation &&
      request === this.queryGeneration &&
      this.allowed(owner) &&
      this.settings.books &&
      (source === 'typed' || (Date.now() <= until && this.options.hub.state().phase === 'listening'));
    const review = {
      id: randomUUID(),
      hits: this.options.books.search(query.data.query, 6),
      checking: true,
      source,
    };
    this.bookReview = review;
    this.bookOwner = owner;
    this.bookCreated = Date.now();
    this.problem = null;
    const sources = () => {
      this.bookSources = new Map(
        review.hits.flatMap((hit) => {
          const stamp = this.signature(hit.passageId);
          return stamp ? [[hit.passageId, stamp] as const] : [];
        }),
      );
    };
    sources();
    this.tell();
    try {
      if (this.options.books.list().length > 0) {
        let after: { row: number; part: number } | undefined;
        let accumulated: z.infer<typeof bookHintSchema>[] = [];
        const replySchema = z
          .object({ hints: z.array(bookHintSchema).max(50), after: bookCursorSchema, finished: z.boolean() })
          .strict();
        for (;;) {
          const raw = await this.options.rpc.run({
            kind: 'books',
            query: query.data.query,
            ...(after ? { after } : {}),
          });
          if (!current()) break;
          const page = replySchema.safeParse(raw);
          if (!page.success) throw new Error('BAD_HINTS');
          const seen = new Set<string>();
          accumulated = [...accumulated, ...page.data.hints]
            .sort((a, b) => b.score - a.score)
            .filter((hint) => {
              const key = hint.itemId + ':' + hint.lang;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            })
            .slice(0, 50);
          review.hits = this.options.books.search(query.data.query, 6, accumulated);
          sources();
          this.tell();
          if (page.data.finished) break;
          if (page.data.after.row === after?.row && page.data.after.part === after.part)
            throw new Error('NO_PROGRESS');
          after = page.data.after;
          await new Promise<void>((resolve) => setTimeout(resolve, 20));
          if (!current()) break;
        }
      }
    } catch {
      if (current()) this.problem = 'Meaning search could not finish. Exact loaded matches remain.';
    }
    if (!current()) {
      if (this.view().books?.id === review.id && source === 'speech') {
        this.bookReview = null;
        this.bookSources.clear();
        this.tell();
      }
      return { ok: false, message: STALE };
    }
    review.checking = false;
    sources();
    this.bookReview = review;
    this.tell();
    return { ok: true, value: this.view() };
  }
  showBook(owner: number, input: unknown): AiResult<null> {
    const value = approvalSchema.safeParse(input);
    if (
      !this.allowed(owner) ||
      !this.settings.books ||
      !value.success ||
      this.bookOwner !== owner ||
      value.data.id !== this.bookReview?.id ||
      Date.now() - this.bookCreated > 45000 ||
      !this.bookSources.has(value.data.passageId) ||
      this.signature(value.data.passageId) !== this.bookSources.get(value.data.passageId)
    )
      return { ok: false, message: STALE };
    return this.options.showBook(value.data.passageId)
      ? { ok: true, value: null }
      : { ok: false, message: STALE };
  }
  nextVerse(owner: number, id: unknown): AiResult<null> {
    const review = this.verse;
    if (
      !this.allowed(owner) ||
      !this.settings.verse ||
      !review ||
      id !== review.id ||
      Date.now() - review.created > 20000 ||
      review.tag !== fingerprint(this.options.live())
    )
      return { ok: false, message: STALE };
    this.verse = null;
    this.tell();
    return this.options.next() ? { ok: true, value: null } : { ok: false, message: STALE };
  }
}
