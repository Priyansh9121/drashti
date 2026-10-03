import type { z } from 'zod';
import {
  ANNOUNCEMENT_TEMPLATE,
  type Announcement,
  announcementApproveSchema,
  announcementEditSchema,
  announcementIdSchema,
  announcementInputSchema,
  type AnnouncementResult,
  type AnnouncementStatusView,
  ANNOUNCEMENTS_WAITING_MAX,
  ANNOUNCEMENTS_WAITING_PER_PHONE,
  type AnnouncementsView,
} from '../../shared/announcements';
import type { CommandResult, EngineCommand } from '../../shared/engine/commands';
import type { EngineState, MessageItem, TickerItem } from '../../shared/engine/state';
import {
  fieldOf,
  fillMessage,
  type MessageTemplate,
  type MessageTemplateFields,
  templateFields,
} from '../../shared/messages';
import { idSchema } from '../../shared/model-schema';
import type { DeviceAnswer } from '../../shared/network-api';
import type { AnnouncementRepo } from '../db/announcements';

/*
 * Announcements from phones, as the main process runs them (README, "The
 * local network"). A phone sends one; it waits in the operator's queue; the
 * operator approves it (as a message or in the ticker), edits it or rejects
 * it; when its time is up it comes off the screens by itself. The log names
 * the device, never the words (they are content) or anything secret.
 */

export interface AnnouncementDeps {
  repo: AnnouncementRepo;
  engine: {
    state(): EngineState;
    dispatch(command: EngineCommand): CommandResult;
    showTicker(item: TickerItem): CommandResult;
    takeDown(id: string): CommandResult;
  };
  templates: {
    list(): MessageTemplate[];
    create(template: MessageTemplateFields): string;
    /** The message templates changed (Drashti added its own). */
    changed(): void;
  };
  now(): number;
  /** How long a minute is: 60 000 ms (the tests make it shorter). */
  minuteMs: number;
  /** Run `run` after `ms`; returns a way to cancel it (setTimeout when left out). */
  schedule?: (ms: number, run: () => void) => () => void;
  /** The queue changed: the operator window is told. */
  changed(view: AnnouncementsView): void;
  log(level: 'info' | 'warn', message: string): void;
}

/** Ended and rejected announcements are kept this long. */
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
/** The queue shows this many of those. */
const EARLIER = 20;

const deny = (status: number, message: string): DeviceAnswer => ({ status, body: { ok: false, message } });
const firstProblem = (error: z.ZodError): string =>
  error.issues[0]?.message ?? 'That is not a valid request.';
const statusView = (a: Announcement): AnnouncementStatusView => ({
  id: a.id,
  status: a.status,
  until: a.until,
});

export class AnnouncementService {
  /** Who sent each one still waiting (a device from an address), for the limit per phone. */
  private readonly senders = new Map<string, string>();
  private cancelTimer: (() => void) | null = null;

  constructor(private readonly deps: AnnouncementDeps) {}

  private iso(ms = this.deps.now()): string {
    return new Date(ms).toISOString();
  }

  view(): AnnouncementsView {
    const { repo } = this.deps;
    return {
      waiting: repo.withStatus('waiting'),
      showing: repo.withStatus('showing'),
      earlier: repo.earlier(EARLIER),
    };
  }

  private changed(): AnnouncementResult {
    const view = this.view();
    this.deps.changed(view);
    return { ok: true, view };
  }

  // ---- from phones ---------------------------------------------------------------------------

  /** An Announcements device sends one (the network service has checked the device and its kind). */
  submit(device: { id: string; name: string }, address: string, input: unknown): DeviceAnswer {
    const parsed = announcementInputSchema.safeParse(input);
    if (!parsed.success) return deny(400, firstProblem(parsed.error));
    const { repo } = this.deps;
    if (repo.waitingCount() >= ANNOUNCEMENTS_WAITING_MAX)
      return deny(
        429,
        'The operator has a lot of announcements waiting already. Try again in a few minutes.',
      );
    const sender = `${device.id} ${address}`;
    const waiting = new Set(repo.withStatus('waiting').map((a) => a.id));
    const mine = [...this.senders].filter(([id, from]) => from === sender && waiting.has(id)).length;
    if (mine >= ANNOUNCEMENTS_WAITING_PER_PHONE)
      return deny(
        429,
        `You have ${mine} announcements waiting. Wait until the operator has decided on them.`,
      );
    const added = repo.add({
      ...parsed.data,
      deviceId: device.id,
      deviceName: device.name,
      sentAt: this.iso(),
    });
    this.senders.set(added.id, sender);
    this.deps.log('info', `Announcements: “${device.name}” sent one (for ${added.minutes} min)`);
    this.changed();
    return { status: 202, body: { ok: true, announcement: statusView(added) } };
  }

  /** What became of one the device sent (never anyone else's). */
  statusFor(device: { id: string }, args: unknown): DeviceAnswer {
    const id = idSchema.safeParse((args as Record<string, unknown> | null)?.['id']);
    const found = id.success ? this.deps.repo.get(id.data) : null;
    if (!found || this.deps.repo.deviceOf(found.id) !== device.id)
      return deny(404, 'There is no such announcement from this device.');
    return { status: 200, body: { ok: true, announcement: statusView(found) } };
  }

  // ---- the operator's queue ------------------------------------------------------------------

  edit(input: unknown): AnnouncementResult {
    const parsed = announcementEditSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: firstProblem(parsed.error) };
    const { id, text, minutes } = parsed.data;
    if (!this.deps.repo.edit(id, text, minutes))
      return { ok: false, message: 'That announcement is no longer waiting.' };
    this.deps.log('info', 'Announcements: the operator edited one');
    return this.changed();
  }

  approve(input: unknown): AnnouncementResult {
    const parsed = announcementApproveSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: firstProblem(parsed.error) };
    const a = this.deps.repo.get(parsed.data.id);
    if (a?.status !== 'waiting') return { ok: false, message: 'That announcement is no longer waiting.' };
    const now = this.deps.now();
    if (parsed.data.as === 'message') {
      const template = this.template(parsed.data.templateId ?? null);
      if (!template) return { ok: false, message: 'That message template no longer exists.' };
      const message = this.messageFor(a, template);
      if (!message)
        return {
          ok: false,
          message: `“${template.name}” needs more than the announcement's words. Choose a template with one field to type into.`,
        };
      const shown = this.deps.engine.dispatch({ type: 'showMessage', message });
      if (!shown.ok) return { ok: false, message: shown.message };
    } else {
      const shown = this.deps.engine.showTicker({ id: a.id, text: a.text });
      if (!shown.ok) return { ok: false, message: shown.message };
    }
    this.deps.repo.approve(
      a.id,
      parsed.data.as,
      this.iso(now),
      this.iso(now + a.minutes * this.deps.minuteMs),
    );
    this.senders.delete(a.id);
    this.deps.log(
      'info',
      `Announcements: approved one from “${a.deviceName}” as ${parsed.data.as === 'message' ? 'a message' : 'the ticker'} for ${a.minutes} min`,
    );
    this.schedule();
    return this.changed();
  }

  reject(input: unknown): AnnouncementResult {
    const parsed = announcementIdSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: 'Which announcement?' };
    const a = this.deps.repo.get(parsed.data.id);
    if (!a || !this.deps.repo.reject(a.id, this.iso()))
      return { ok: false, message: 'That announcement is no longer waiting.' };
    this.senders.delete(a.id);
    this.deps.log('info', `Announcements: rejected one from “${a.deviceName}”`);
    return this.changed();
  }

  /** Take one off the screens before its time is up. */
  takeOff(input: unknown): AnnouncementResult {
    const parsed = announcementIdSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: 'Which announcement?' };
    const a = this.deps.repo.get(parsed.data.id);
    if (a?.status !== 'showing') return { ok: false, message: 'That announcement is not showing.' };
    this.end(a, 'the operator took it off');
    this.schedule();
    return this.changed();
  }

  // ---- time --------------------------------------------------------------------------------

  /**
   * At startup, after restart recovery: what recovery put back on the screens
   * carries on until its time; anything else that was showing has ended (it
   * is not on the screens), and so has anything whose time ran out while
   * Drashti was not running.
   */
  resume(): void {
    const { repo } = this.deps;
    const now = this.deps.now();
    repo.prune(this.iso(now - KEEP_MS));
    const layers = this.deps.engine.state().layers;
    const up = new Set([
      ...layers.messages.map((m) => m.id),
      ...(layers.ticker?.items.map((i) => i.id) ?? []),
    ]);
    const showing = repo.withStatus('showing');
    for (const a of showing)
      if (!up.has(a.id)) this.end(a, 'it was not put back on the screens');
      else if (Date.parse(a.until ?? '') <= now) this.end(a, 'its time ran out');
    // An announcement on the screens that is no longer showing (an end the recovery file missed).
    for (const id of up) {
      const a = repo.get(id);
      if (a && a.status !== 'showing') this.deps.engine.takeDown(id);
    }
    this.schedule();
  }

  private end(a: Announcement, why: string): void {
    this.deps.engine.takeDown(a.id);
    this.deps.repo.end(a.id, this.iso());
    this.deps.log('info', `Announcements: one from “${a.deviceName}” came off the screens (${why})`);
  }

  /** Wait for the next one's time to be up. */
  private schedule(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
    const times = this.deps.repo.withStatus('showing').map((a) => Date.parse(a.until ?? ''));
    const next = Math.min(...times.filter((t) => Number.isFinite(t)));
    if (!Number.isFinite(next)) return;
    const schedule =
      this.deps.schedule ??
      ((ms: number, run: () => void) => {
        const t = setTimeout(run, ms);
        return () => {
          clearTimeout(t);
        };
      });
    this.cancelTimer = schedule(Math.max(0, next - this.deps.now()), () => {
      this.cancelTimer = null;
      this.expire();
    });
  }

  private expire(): void {
    const now = this.deps.now();
    let ended = 0;
    for (const a of this.deps.repo.withStatus('showing'))
      if (Date.parse(a.until ?? '') <= now) {
        this.end(a, 'its time was up');
        ended++;
      }
    this.schedule();
    if (ended > 0) this.changed();
  }

  /** The template to show it with: the one chosen, or Drashti's own (made the first time it is needed). */
  private template(templateId: string | null): MessageTemplate | null {
    const templates = this.deps.templates.list();
    if (templateId) return templates.find((t) => t.id === templateId) ?? null;
    const own = templates.find((t) => t.name === ANNOUNCEMENT_TEMPLATE.name);
    if (own) return own;
    const id = this.deps.templates.create({ ...ANNOUNCEMENT_TEMPLATE, fields: {} });
    this.deps.log('info', 'Announcements: added the “Announcement” message template');
    this.deps.templates.changed();
    return this.deps.templates.list().find((t) => t.id === id) ?? null;
  }

  /**
   * The message: the template's first typed field gets the words, and a field
   * named "from" who sent it. Null when the template asks for anything more.
   * Its id is the announcement's, so several can be up and each comes off by itself.
   */
  private messageFor(a: Announcement, template: MessageTemplate): MessageItem | null {
    const typed = templateFields(template.template).filter((n) => fieldOf(template, n).kind === 'text');
    const words = typed.find((n) => n.toLowerCase() !== 'from');
    if (!words) return null;
    const values: Record<string, string> = { [words]: a.text };
    for (const n of typed) if (n.toLowerCase() === 'from') values[n] = a.from;
    const timers = this.deps.engine.state().timers;
    const filled = fillMessage(template, values, (id) => timers.find((t) => t.id === id)?.name ?? 'timer');
    return filled.message ? { ...filled.message, id: a.id } : null;
  }

  close(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
  }
}
