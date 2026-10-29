import { z } from 'zod';
import { matchDisplays, sameKey } from '../../shared/display-match';
import type {
  DisplayInfo,
  DisplayJob,
  DisplayKey,
  DisplayUse,
  ScreensResult,
  ScreensSaid,
} from '../../shared/screens';
import { jobOf } from '../../shared/screens';

/*
 * Screens that set themselves (Session 55, Part 1; Priyansh, 29 Oct 2026: a display plugged in had to be set up by
 * hand, and Set Up Screens… went round in a loop). A display plugged in is used at once, with no question and no
 * click: the first that is not the one with the controls shows the audience picture, the next the stage (any more,
 * the audience picture too), and a one-line notice says so, with Change…. The display with the controls is never
 * taken, nor a computer's own built-in display. Each display is remembered by itself (display-ids.ts): plugged in
 * again or after a restart, it goes straight back to its job through the screen it was given, and a job changed by
 * hand is remembered instead; "Not used" too (here), so a display set so is never taken again by itself.
 */

/** The automatic jobs: the audience picture or the stage. */
export type GivenJob = Exclude<DisplayJob, 'none'>;

export interface JobFor {
  display: DisplayInfo;
  job: GivenJob;
}

/**
 * The jobs the displays that have none get, in the order the computer lists them: the first the audience picture
 * unless a display shows it already, then the stage unless one shows it, then the audience picture again. Never
 * the controls' display, a built-in one, one used by a screen, or one set Not used by hand.
 */
export function jobsFor(
  displays: readonly DisplayInfo[],
  uses: readonly DisplayUse[],
  controlsDisplayId: number | null,
  notUsed: ReadonlySet<number>,
): JobFor[] {
  const used = new Map(uses.filter((u) => u.screenId !== null).map((u) => [u.displayId, jobOf(u)]));
  let audience = [...used.values()].includes('audience');
  let stage = [...used.values()].includes('stage');
  const out: JobFor[] = [];
  for (const d of displays) {
    if (d.id === controlsDisplayId || d.internal || used.has(d.id) || notUsed.has(d.id)) continue;
    const job: GivenJob = !audience ? 'audience' : !stage ? 'stage' : 'audience';
    if (job === 'audience') audience = true;
    else stage = true;
    out.push({ display: d, job });
  }
  return out;
}

/** A display's name as the notice says it: its own, or its place in the computer's list. */
export function displayName(d: DisplayInfo, all: readonly DisplayInfo[]): string {
  const label = d.label.trim();
  if (label !== '') return label;
  const i = all.findIndex((x) => x.id === d.id);
  return `Display ${String(i < 0 ? d.id : i + 1)}`;
}

const listed = (names: string[]): string =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;

/** What the notice says of the jobs given: "“A” shows the audience picture, and “B” the stage." */
export function sayJobs(jobs: readonly JobFor[], all: readonly DisplayInfo[]): string {
  const named = (job: GivenJob) =>
    jobs.filter((j) => j.job === job).map((j) => `“${displayName(j.display, all)}”`);
  const audience = named('audience');
  const stage = named('stage');
  const verb = (names: string[]) => (names.length === 1 ? 'shows' : 'show');
  if (audience.length > 0 && stage.length > 0)
    return `${listed(audience)} ${verb(audience)} the audience picture, and ${listed(stage)} the stage.`;
  if (audience.length > 0) return `${listed(audience)} ${verb(audience)} the audience picture.`;
  return `${listed(stage)} ${verb(stage)} the stage.`;
}

/** What the notice says once when the computer mirrors its screen, Drashti then seeing one display. */
export function sayMirroring(names: readonly string[], platform: NodeJS.Platform): string {
  const onto = listed(names.map((n) => `“${n}”`)) || 'the projector';
  const it = names.length > 1 ? 'them' : onto;
  return platform === 'win32'
    ? `Windows shows the same picture on ${onto} (Duplicate), so Drashti sees one display. To give ${it} the audience picture, extend instead: press Windows+P and choose Extend.`
    : `This Mac is mirroring its screen onto ${onto}, so Drashti sees one display. To give ${it} the audience picture, extend instead: in System Settings › Displays, choose ${names.length > 1 ? 'each of them' : onto}, then Use as: Extended display.`;
}

// ---- the displays set Not used by hand ---------------------------------------------------------------------------

/** Where the list is kept (the library's settings). */
export interface NotUsedStore {
  get(): unknown;
  set(value: unknown): void;
}

const keySchema = z.object({
  id: z.number(),
  label: z.string().max(500),
  pixelWidth: z.number(),
  pixelHeight: z.number(),
  x: z.number(),
  y: z.number(),
  internal: z.boolean(),
  hardwareId: z.string().max(500).nullable().optional(),
});

/** At most this many displays are remembered Not used (the oldest go first). */
export const NOT_USED_MAX = 50;

/**
 * The displays set Not used by hand (Session 55: in Set Up Screens…, Screens or a phone, or by removing a display's
 * screen), each by its key, found as screens find theirs (shared/display-match.ts). Never taken by themselves again
 * until given a job by hand.
 */
export class NotUsedDisplays {
  constructor(private readonly store: NotUsedStore) {}

  private list(): DisplayKey[] {
    const parsed = z.array(keySchema).safeParse(this.store.get());
    return parsed.success ? parsed.data.slice(-NOT_USED_MAX) : [];
  }

  /** The displays among these set Not used. */
  among(displays: readonly DisplayInfo[]): Set<number> {
    const list = this.list();
    const found = matchDisplays(
      list.map((key, i) => ({ screenId: String(i), key })),
      displays,
    );
    return new Set([...found.values()].filter((id): id is number => id !== null));
  }

  /** A display set Not used (by its key, as it is now or as a screen had it). */
  remember(key: DisplayKey): void {
    const kept = this.list().filter(
      (k) => !sameKey(k, key) && !(key.hardwareId && k.hardwareId === key.hardwareId),
    );
    this.store.set([...kept, key].slice(-NOT_USED_MAX));
  }

  /** A display given a job by hand: no longer Not used. */
  forget(display: DisplayInfo): void {
    const list = this.list();
    const found = matchDisplays(
      list.map((key, i) => ({ screenId: String(i), key })),
      [display],
    );
    const left = list.filter((_, i) => found.get(String(i)) === null);
    if (left.length !== list.length) this.store.set(left);
  }
}

/** A list kept in memory (tests, and screens without a library's settings). */
export function memoryNotUsed(): NotUsedDisplays {
  let value: unknown = [];
  return new NotUsedDisplays({
    get: () => value,
    set: (v) => {
      value = v;
    },
  });
}

// ---- giving them their jobs ----------------------------------------------------------------------------------------

export interface AutoScreensDeps {
  /** Off: displays never set themselves (tests not about it). */
  on: boolean;
  /** This computer's displays now, with their own identities. */
  displays(): DisplayInfo[];
  /** What each display does now (screens-service.ts). */
  uses(): DisplayUse[];
  /** The display the controls are on: never taken. Null when there is none yet. */
  controlsDisplayId(): number | null;
  notUsed: NotUsedDisplays;
  /** Give displays their jobs (screens-service.ts, giveJobs): no question, never the controls' display. */
  give(jobs: readonly JobFor[]): ScreensResult;
  /** Tell the operator window (and keep it for a window that opens after). */
  said(said: ScreensSaid): void;
  /** The displays the computer mirrors its screen onto now (display-ids.ts), none when it does not. */
  mirroredOnto(): string[];
  platform: NodeJS.Platform;
  log(message: string): void;
}

/**
 * Gives each display plugged in its job, at the start (once its displays have been read) and after every change of
 * the displays; says what it did once, and once how to extend when the computer mirrors.
 */
export class AutoScreens {
  private told = 0;
  /** The mirroring said, as it was said (said again only once it has stopped and started again). */
  private mirroringSaid = '';

  constructor(private readonly deps: AutoScreensDeps) {}

  /** Give the displays that have no job theirs; say it. */
  check(): void {
    if (!this.deps.on) return;
    this.mirroring();
    const displays = this.deps.displays();
    const jobs = jobsFor(
      displays,
      this.deps.uses(),
      this.deps.controlsDisplayId(),
      this.deps.notUsed.among(displays),
    );
    if (jobs.length === 0) return;
    const given = this.deps.give(jobs);
    if (!given.ok) {
      this.deps.log(`Screens: a display plugged in could not be given its job (${given.message})`);
      return;
    }
    const text = sayJobs(jobs, displays);
    this.deps.log(`Screens: set by themselves: ${text}`);
    this.deps.said({ id: ++this.told, kind: 'set', text, displayIds: jobs.map((j) => j.display.id) });
  }

  private mirroring(): void {
    const onto = this.deps.mirroredOnto();
    const now = onto.join('\n');
    if (now === this.mirroringSaid) return;
    this.mirroringSaid = now;
    if (onto.length === 0) return;
    const text = sayMirroring(onto, this.deps.platform);
    this.deps.log(`Screens: the computer mirrors its screen onto ${onto.join(', ')}: said how to extend`);
    this.deps.said({ id: ++this.told, kind: 'mirroring', text, displayIds: [] });
  }
}
