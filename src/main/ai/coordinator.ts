import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import {
  aiSettings,
  aiSettingsSchema,
  aiPlaylistRequestSchema,
  aiSearchRequestSchema,
  type AiFeature,
  type AiSettings,
  type AiPlaylistReview,
  type AiResult,
  type AiLyricReview,
  type AiSearchProgress,
} from '../../shared/ai';
import { lyricRequestSchema, lyricProposalSchema } from '../../shared/ai-lyrics';
import type { SearchResult } from '../../shared/search';
import type { PlaylistItemInfo } from '../../shared/playlists';
import { cutText } from '../../shared/text';
import type { Db } from '../db/database';
import type { SettingsRepo } from '../db/settings';
import type { PlaylistRepo } from '../db/playlists';
import type { CalendarRepo } from '../db/calendar';
import type { SearchIndex } from '../db/search';
import { aiHintSchema } from './protocol';
import type { AiWorkerRpc } from './rpc';
const PRO = 'AI helpers are available to the operator in Pro Mode.';
const OFF = 'This helper is switched off.';
const AGAIN = 'The source or choices changed. Ask for a new suggestion.';
const UNAVAILABLE = 'The helper could not finish. Your words and playlists have not changed.';
const rankedSchema = z
  .array(z.object({ id: z.string().max(200), score: z.number().min(0).max(1) }).strict())
  .max(50);
const approvalSchema = z
  .object({
    id: z.string().max(100),
    name: z.string().trim().min(1).max(200),
    rows: z.array(z.string().max(100)).min(1).max(500),
  })
  .strict();
const lyricApprovalSchema = z
  .object({
    id: z.string().max(100),
    text: z.string().max(20000),
    selected: z.array(z.string().max(100)).max(200),
  })
  .strict();
interface Options {
  db: Db;
  settings: SettingsRepo;
  playlists: PlaylistRepo;
  calendar: CalendarRepo;
  search: SearchIndex;
  rpc: Pick<AiWorkerRpc, 'run' | 'cancel' | 'busy'>;
  authorised: (owner: number) => boolean;
  changed: () => void;
  settingsChanged: (settings: AiSettings) => void;
}
interface Lease {
  owner: number;
  generation: number;
}
interface PendingLyrics extends Lease {
  created: number;
  review: AiLyricReview;
}
interface PendingPlaylist extends Lease {
  created: number;
  review: AiPlaylistReview;
  sourceId: string;
  fingerprint: string;
  rows: PlaylistItemInfo[];
  calendarFingerprint: string;
}
function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function eligible(item: PlaylistItemInfo): boolean {
  switch (item.kind) {
    case 'presentation':
      return item.presentationName !== null;
    case 'media':
      return !item.missing && item.unplayable === null;
    case 'shastra':
    case 'input':
      return !item.missing;
    case 'header':
      return true;
    case 'placeholder':
      return false;
  }
}
export class AiHelpers {
  private settings: AiSettings;
  private generation = 0;
  private readonly lyrics = new Map<string, PendingLyrics>();
  private readonly playlists = new Map<string, PendingPlaylist>();
  constructor(private readonly options: Options) {
    this.settings = aiSettings(options.settings.get('ai.helpers'));
  }
  private can(owner: number, feature?: AiFeature): boolean {
    return this.options.authorised(owner) && (!feature || this.settings[feature]);
  }
  private lease(owner: number): Lease {
    return { owner, generation: this.generation };
  }
  private current(lease: Lease, feature: AiFeature): boolean {
    return lease.generation === this.generation && this.can(lease.owner, feature);
  }
  get(owner: number): AiResult<AiSettings> {
    return this.can(owner) ? { ok: true, value: { ...this.settings } } : { ok: false, message: PRO };
  }
  set(owner: number, input: unknown): AiResult<AiSettings> {
    if (!this.can(owner)) return { ok: false, message: PRO };
    const parsed = aiSettingsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: 'Choose each helper on or off.' };
    this.suspend();
    this.settings = parsed.data;
    this.options.settings.set('ai.helpers', this.settings);
    this.options.settingsChanged({ ...this.settings });
    return { ok: true, value: { ...this.settings } };
  }
  suspend(): void {
    this.generation++;
    this.lyrics.clear();
    this.playlists.clear();
    this.options.rpc.cancel();
  }
  busy(until: number): void {
    this.options.rpc.busy(until);
  }
  past(owner: number): AiResult<{ id: string; name: string }[]> {
    if (!this.can(owner, 'playlist')) return { ok: false, message: this.can(owner) ? OFF : PRO };
    return {
      ok: true,
      value: this.options.playlists
        .tree()
        .filter((p) => !p.isFolder && p.kind === 'normal' && !p.template && !p.fromFolder)
        .map((p) => ({ id: p.id, name: p.name })),
    };
  }
  async search(
    owner: number,
    input: unknown,
    progress: (value: AiSearchProgress) => void,
  ): Promise<AiResult<SearchResult>> {
    if (!this.can(owner, 'search')) return { ok: false, message: this.can(owner) ? OFF : PRO };
    const parsed = aiSearchRequestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: 'Type a few words to look for.' };
    const request = parsed.data;
    const lease = this.lease(owner);
    try {
      const result = await this.options.rpc.run({ kind: 'search', query: request.query }, (hints) => {
        if (this.current(lease, 'search'))
          progress({
            requestId: request.requestId,
            result: this.options.search.search(request.query, 50, hints),
            checking: true,
          });
      });
      if (!this.current(lease, 'search')) return { ok: false, message: OFF };
      const hints = z.array(aiHintSchema).max(50).safeParse(result);
      if (!hints.success) return { ok: false, message: UNAVAILABLE };
      return { ok: true, value: this.options.search.search(request.query, 50, hints.data) };
    } catch {
      return { ok: false, message: UNAVAILABLE };
    }
  }
  async suggestLyrics(owner: number, input: unknown): Promise<AiResult<AiLyricReview>> {
    if (!this.can(owner, 'tidy')) return { ok: false, message: this.can(owner) ? OFF : PRO };
    const request = lyricRequestSchema.safeParse(input);
    if (!request.success)
      return { ok: false, message: 'Use this helper with pasted lyrics. Books are kept as loaded.' };
    const lease = this.lease(owner);
    try {
      const result = await this.options.rpc.run({ kind: 'lyrics', request: request.data });
      if (!this.current(lease, 'tidy')) return { ok: false, message: OFF };
      const checked = z
        .object({ ok: z.literal(true), value: lyricProposalSchema })
        .strict()
        .safeParse(result);
      if (!checked.success || checked.data.value.sourceText !== request.data.text)
        return { ok: false, message: UNAVAILABLE };
      const review = { id: randomUUID(), proposal: checked.data.value };
      if (this.lyrics.size >= 32) this.lyrics.clear();
      this.lyrics.set(review.id, { ...lease, created: Date.now(), review });
      return { ok: true, value: review };
    } catch {
      return { ok: false, message: UNAVAILABLE };
    }
  }
  async approveLyrics(owner: number, input: unknown): Promise<AiResult<string>> {
    if (!this.can(owner, 'tidy')) return { ok: false, message: this.can(owner) ? OFF : PRO };
    const parsed = lyricApprovalSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: AGAIN };
    const request = parsed.data;
    const pending = this.lyrics.get(request.id);
    if (
      pending?.owner !== owner ||
      !this.current(pending, 'tidy') ||
      Date.now() - pending.created > 120000 ||
      pending.review.proposal.sourceText !== request.text
    )
      return { ok: false, message: AGAIN };
    try {
      const result = await this.options.rpc.run({
        kind: 'apply-lyrics',
        text: request.text,
        proposal: pending.review.proposal,
        selected: request.selected,
      });
      if (!this.current(pending, 'tidy')) return { ok: false, message: OFF };
      const checked = z
        .object({ ok: z.literal(true), value: z.string().max(100000) })
        .strict()
        .safeParse(result);
      if (!checked.success) return { ok: false, message: AGAIN };
      this.lyrics.delete(request.id);
      return { ok: true, value: checked.data.value };
    } catch {
      return { ok: false, message: UNAVAILABLE };
    }
  }
  async suggestPlaylist(owner: number, input: unknown): Promise<AiResult<AiPlaylistReview>> {
    if (!this.can(owner, 'playlist')) return { ok: false, message: this.can(owner) ? OFF : PRO };
    const parsed = aiPlaylistRequestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: 'Choose a date and the past sabhas to use.' };
    const request = parsed.data;
    const lease = this.lease(owner);
    const wanted = [...new Set(request.pastIds)];
    const available = this.options.playlists
      .tree()
      .filter(
        (p) => !p.isFolder && p.kind === 'normal' && !p.template && !p.fromFolder && wanted.includes(p.id),
      );
    if (available.length !== wanted.length) return { ok: false, message: AGAIN };
    const sources = available.map((p) => ({ ...p, rows: this.options.playlists.itemsOf(p.id) }));
    const day = this.options.calendar.day(request.date);
    const calendarNames = day?.festivals
      .flatMap((value) => [value.en, value.gu].filter((x): x is string => typeof x === 'string'))
      .join(' · ');
    const calendar = calendarNames === '' ? null : (calendarNames ?? null);
    try {
      const raw = calendar
        ? await this.options.rpc.run({
            kind: 'rank',
            query: calendar,
            rows: sources.map((p) => ({
              id: p.id,
              text: cutText(p.name + '\n' + p.rows.map((r) => r.label).join('\n'), 1800),
            })),
          })
        : sources.map((p) => ({ id: p.id, score: 1 }));
      if (!this.current(lease, 'playlist')) return { ok: false, message: OFF };
      const ranked = rankedSchema.safeParse(raw);
      if (!ranked.success) return { ok: false, message: UNAVAILABLE };
      const best = ranked.data.find((p) => p.score >= 0.78 && sources.some((s) => s.id === p.id));
      const source = best ? sources.find((p) => p.id === best.id) : undefined;
      if (!source)
        return {
          ok: false,
          message: 'No close match. Choose different past sabhas or make a playlist yourself.',
        };
      const rows = source.rows
        .filter(eligible)
        .map((row) => ({ id: row.id, label: row.label, source: source.name }));
      if (!rows.length)
        return { ok: false, message: 'Those past sabhas have no available items to suggest.' };
      const review = { id: randomUUID(), name: 'Sabha, ' + request.date, date: request.date, rows, calendar };
      if (this.playlists.size >= 32) this.playlists.clear();
      this.playlists.set(review.id, {
        ...lease,
        created: Date.now(),
        review,
        sourceId: source.id,
        fingerprint: fingerprint(source.rows),
        rows: source.rows,
        calendarFingerprint: fingerprint(day),
      });
      return { ok: true, value: review };
    } catch {
      return { ok: false, message: UNAVAILABLE };
    }
  }
  approvePlaylist(owner: number, input: unknown): AiResult<{ id: string }> {
    if (!this.can(owner, 'playlist')) return { ok: false, message: this.can(owner) ? OFF : PRO };
    const parsed = approvalSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: AGAIN };
    const request = parsed.data;
    const pending = this.playlists.get(request.id);
    if (
      pending?.owner !== owner ||
      !this.current(pending, 'playlist') ||
      Date.now() - pending.created > 120000 ||
      new Set(request.rows).size !== request.rows.length
    )
      return { ok: false, message: AGAIN };
    const allowed = new Set(pending.review.rows.map((r) => r.id));
    if (request.rows.some((id) => !allowed.has(id))) return { ok: false, message: AGAIN };
    if (
      !this.options.playlists.tree().some((p) => p.id === pending.sourceId) ||
      fingerprint(this.options.playlists.itemsOf(pending.sourceId)) !== pending.fingerprint ||
      fingerprint(this.options.calendar.day(pending.review.date)) !== pending.calendarFingerprint
    )
      return { ok: false, message: AGAIN };
    try {
      const id = this.options.db.transaction(() => {
        const made = this.options.playlists.duplicate(pending.sourceId);
        if (!made) throw new Error('STALE');
        const copies = this.options.playlists.itemsOf(made);
        if (copies.length !== pending.rows.length) throw new Error('STALE');
        const map = new Map(pending.rows.map((row, i) => [row.id, copies[i]?.id]));
        const keep = new Set(request.rows.map((row) => map.get(row)));
        if (keep.has(undefined)) throw new Error('STALE');
        this.options.playlists.removeItems(copies.filter((row) => !keep.has(row.id)).map((row) => row.id));
        for (const [position, row] of request.rows.entries()) {
          const copied = map.get(row);
          if (!copied || !this.options.playlists.moveItems(made, [copied], position))
            throw new Error('STALE');
        }
        if (!this.options.playlists.rename(made, request.name)) throw new Error('STALE');
        this.options.db
          .prepare('INSERT INTO ai_sabhas (playlist_id, for_date) VALUES (?, ?)')
          .run(made, pending.review.date);
        return made;
      })();
      this.playlists.delete(request.id);
      this.options.changed();
      return { ok: true, value: { id } };
    } catch {
      return { ok: false, message: AGAIN };
    }
  }
}
