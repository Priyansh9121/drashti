import { z } from 'zod';
import { matchDisplays } from '../../shared/display-match';
import type { Lang } from '../../shared/model';
import { GROUP_ROLES } from '../../shared/screens';
import type { SetupOutput } from '../../shared/setup';
import type {
  CoverOptions,
  DisplayInfo,
  DisplayKey,
  NodeDisplays,
  ScreenConfig,
  ScreenPatch,
  ScreenStatus,
  ScreensResult,
  ScreensSnapshot,
} from '../../shared/screens';
import {
  coverOptionsSchema,
  displayIdSchema,
  groupLanguagesSchema,
  idSchema,
  nameSchema,
  screenPatchSchema,
} from '../../shared/screens-schema';
import type { SavedScreens, ScreenRepo } from '../db/screens';
import type { OutputManager } from './output-manager';

/**
 * The screen setup as it was, for Go back to put back exactly (Keep these screens?, Session 50): every group and
 * screen as stored, and each group's languages in the live Look (where Screens and the setup wizard keep them).
 */
export interface ScreensSetup extends SavedScreens {
  languages: Record<string, Lang[] | null>;
}

const sameLanguages = (a: Lang[] | null, b: Lang[] | null) => JSON.stringify(a) === JSON.stringify(b);

/** What screen changes do to the Looks (look-service.ts), which hold each group's languages. */
export interface ScreenLooks {
  /** A group's languages in the live Look. */
  liveLanguages(groupId: string): Lang[] | null;
  setLiveLanguages(groupId: string, languages: Lang[] | null): boolean;
  /** A new group, with these languages in every Look (null: every language). */
  groupMade(groupId: string, languages?: Lang[] | null): void;
  groupsChanged(): void;
  groupGone(groupId: string): void;
  /** A group became a key and fill pair: in every Look it starts with the words as a lower third, props and messages. */
  becameKeyFill(groupId: string): void;
}

/** Without Looks (tests of screens alone): languages kept here. */
export function memoryScreenLooks(): ScreenLooks {
  const langs = new Map<string, Lang[] | null>();
  return {
    liveLanguages: (id) => langs.get(id) ?? null,
    setLiveLanguages: (id, l) => {
      langs.set(id, l);
      return true;
    },
    groupMade: (id, l = null) => {
      langs.set(id, l);
    },
    groupsChanged: () => undefined,
    groupGone: (id) => {
      langs.delete(id);
    },
    becameKeyFill: () => undefined,
  };
}

/** Screens on output nodes (Session 13): their displays and how their screens stand. */
export interface NodeScreens {
  displays(): NodeDisplays[];
  screenStatus(): ScreenStatus[];
}

const NO_NODES: NodeScreens = { displays: () => [], screenStatus: () => [] };

/**
 * The operator's screen-setup actions. Every input is validated here (it
 * arrives over IPC), then saved, then the output windows are reconciled.
 */
export class ScreensService {
  constructor(
    private readonly repo: ScreenRepo,
    private readonly outputs: OutputManager,
    private readonly listDisplays: () => DisplayInfo[],
    /** The display the operator window is on (null when outputs cannot cover it, e.g. windowed outputs). */
    private readonly operatorDisplayId: () => number | null = () => null,
    /** Each group's languages live in the Looks. */
    private readonly looks: ScreenLooks = memoryScreenLooks(),
    /** Output nodes' displays and screens. */
    private readonly nodes: NodeScreens = NO_NODES,
  ) {}

  /** An output on this display would cover the operator window, and the operator has not agreed. */
  private needsCoverConsent(displayId: number | null | undefined, rawOptions: unknown): ScreensResult | null {
    if (displayId === null || displayId === undefined || displayId !== this.operatorDisplayId()) return null;
    const options = coverOptionsSchema.safeParse(rawOptions ?? {});
    const agreed: CoverOptions = options.success ? options.data : {};
    if (agreed.coverOperator) return null;
    return {
      ok: false,
      confirm: 'covers-operator',
      message: 'The Drashti controls are on this display. An output here would cover them.',
    };
  }

  snapshot(): ScreensSnapshot {
    return {
      displays: this.listDisplays(),
      groups: this.repo.groups(),
      status: [...this.outputs.status(), ...this.nodes.screenStatus()],
      nodes: this.nodes.displays(),
    };
  }

  private done(): ScreensResult {
    this.outputs.reconcile();
    return { ok: true, snapshot: this.snapshot() };
  }

  private fail(message: string): ScreensResult {
    return { ok: false, message };
  }

  createGroup(rawName: unknown): ScreensResult {
    const name = nameSchema.safeParse(rawName);
    if (!name.success) return this.fail('Give the group a name (up to 80 characters).');
    const id = this.repo.createGroup(name.data);
    this.looks.groupMade(id);
    return this.done();
  }

  renameGroup(rawId: unknown, rawName: unknown): ScreensResult {
    const id = idSchema.safeParse(rawId);
    const name = nameSchema.safeParse(rawName);
    if (!id.success || !name.success) return this.fail('Give the group a name (up to 80 characters).');
    if (!this.repo.renameGroup(id.data, name.data)) return this.fail('That group no longer exists.');
    return this.done();
  }

  /** Audience screens show the picture; stage screens show the performers' view. */
  setGroupRole(rawId: unknown, rawRole: unknown): ScreensResult {
    const id = idSchema.safeParse(rawId);
    const role = z.enum(GROUP_ROLES).safeParse(rawRole);
    if (!id.success || !role.success)
      return this.fail('A group shows the audience picture, the stage view, or a key and fill pair.');
    if (this.repo.groupRole(id.data) === 'stream')
      return this.fail('The stream group always shows the stream.');
    const was = this.repo.groupRole(id.data);
    if (!this.repo.setGroupRole(id.data, role.data)) return this.fail('That group no longer exists.');
    this.repo.fixFeeds(id.data);
    if (role.data === 'keyfill' && was !== 'keyfill') this.looks.becameKeyFill(id.data);
    this.looks.groupsChanged();
    return this.done();
  }

  /** The languages a group shows of a kirtan's slides in the live Look, in order; null for all of them. */
  setGroupLanguages(rawId: unknown, rawLanguages: unknown): ScreensResult {
    const id = idSchema.safeParse(rawId);
    const languages = groupLanguagesSchema.safeParse(rawLanguages);
    if (!id.success || !languages.success)
      return this.fail('A group shows every language, or one to four of them, each once.');
    if (this.repo.groupName(id.data) === null || !this.looks.setLiveLanguages(id.data, languages.data))
      return this.fail('That group no longer exists.');
    return this.done();
  }

  deleteGroup(rawId: unknown): ScreensResult {
    const id = idSchema.safeParse(rawId);
    if (!id.success) return this.fail('That group no longer exists.');
    // YouTube's card in Screens is always there (Session 26): its group stays.
    if (this.repo.groupRole(id.data) === 'stream')
      return this.fail('The stream’s group stays: it is YouTube in Screens.');
    if (!this.repo.deleteGroup(id.data)) return this.fail('That group no longer exists.');
    this.looks.groupGone(id.data);
    return this.done();
  }

  assignDisplay(rawGroupId: unknown, rawDisplayId: unknown, rawOptions?: unknown): ScreensResult {
    const groupId = idSchema.safeParse(rawGroupId);
    const displayId = displayIdSchema.safeParse(rawDisplayId);
    if (!groupId.success || !displayId.success) return this.fail('Choose a group and a display.');
    const groupName = this.repo.groupName(groupId.data);
    if (groupName === null) return this.fail('That group no longer exists.');
    if (this.repo.groupRole(groupId.data) === 'stream')
      return this.fail('The stream is drawn off screen: its group has no displays.');
    const display = this.listDisplays().find((d) => d.id === displayId.data);
    if (!display) return this.fail('That display is not connected any more.');
    const user = this.outputs.status().find((s) => s.displayId === display.id);
    if (user) {
      const name = this.repo.screen(user.screenId)?.name ?? 'another screen';
      return this.fail(`That display is already used by "${name}".`);
    }
    const consent = this.needsCoverConsent(display.id, rawOptions);
    if (consent) return consent;
    const count = this.repo.screens().length;
    this.repo.addScreen(groupId.data, display.label || `Screen ${count + 1}`, display.key);
    return this.done();
  }

  /**
   * One of a node's displays shows a group (Session 13): a screen like any
   * other, on that node. A display already used by a screen is refused.
   */
  assignNodeDisplay(rawGroupId: unknown, rawNodeId: unknown, rawDisplayId: unknown): ScreensResult {
    const groupId = idSchema.safeParse(rawGroupId);
    const nodeId = idSchema.safeParse(rawNodeId);
    const displayId = displayIdSchema.safeParse(rawDisplayId);
    if (!groupId.success || !nodeId.success || !displayId.success)
      return this.fail('Choose a group and one of the node’s displays.');
    if (this.repo.groupName(groupId.data) === null) return this.fail('That group no longer exists.');
    if (this.repo.groupRole(groupId.data) === 'stream')
      return this.fail('The stream is drawn off screen: its group has no displays.');
    const node = this.nodes.displays().find((n) => n.id === nodeId.data);
    if (!node) return this.fail('That node is no longer paired.');
    const display = node.displays.find((d) => d.id === displayId.data);
    if (!display) return this.fail('That display is not connected to the node any more.');
    const user = this.repo
      .nodeScreens(node.id)
      .find(
        (sc) =>
          sc.displayKey &&
          matchDisplays([{ screenId: sc.id, key: sc.displayKey }], [display]).get(sc.id) === display.id,
      );
    if (user) return this.fail(`That display is already used by "${user.name}".`);
    const count = this.repo.allScreens().length;
    this.repo.addScreen(
      groupId.data,
      `${node.name}: ${display.label || `Screen ${count + 1}`}`,
      display.key,
      node.id,
    );
    return this.done();
  }

  updateScreen(rawId: unknown, rawPatch: unknown, rawOptions?: unknown): ScreensResult {
    const id = idSchema.safeParse(rawId);
    const patch = screenPatchSchema.safeParse(rawPatch);
    if (!id.success) return this.fail('That screen no longer exists.');
    if (!patch.success)
      return this.fail('Canvas sizes are whole numbers from 16 to 16384; names need 1 to 80 characters.');
    const clean: ScreenPatch = patch.data;
    const current = this.repo.screen(id.data);
    if (!current) return this.fail('That screen no longer exists.');
    if (clean.enabled === true && !current.enabled && current.displayKey && current.nodeId === null) {
      // Turning a screen back on: where would its output open?
      const displayId = matchDisplays(
        [{ screenId: current.id, key: current.displayKey }],
        this.listDisplays(),
      ).get(current.id);
      const consent = this.needsCoverConsent(displayId, rawOptions);
      if (consent) return consent;
    }
    if (!this.repo.updateScreen(id.data, clean)) return this.fail('That screen no longer exists.');
    return this.done();
  }

  /**
   * Turn off every output showing on the operator window's display, so the
   * controls can be reached again. They stay off (saved) until switched on.
   */
  uncoverOperator(): ScreensResult & { turnedOff?: string[] } {
    const operatorDisplay = this.operatorDisplayId();
    const covering = this.outputs
      .status()
      // A stopped output (Session 23) is still a window over its display.
      .filter(
        (s) =>
          (s.state === 'showing' || s.state === 'stopped') &&
          s.displayId !== null &&
          s.displayId === operatorDisplay,
      );
    const turnedOff: string[] = [];
    for (const s of covering) {
      if (this.repo.updateScreen(s.screenId, { enabled: false }))
        turnedOff.push(this.repo.screen(s.screenId)?.name ?? s.screenId);
    }
    return { ...this.done(), turnedOff };
  }

  /**
   * The setup wizard's outputs, all at once: each connected display shows
   * the audience picture or the stage view in its languages, or nothing.
   * A display already used by a screen keeps that screen (and its canvas),
   * moved to the right group. A group whose screens all want the same new
   * role and languages simply changes (keeping its name); otherwise each
   * output joins a group with that role and those languages, made if there
   * is none ("Audience", "Stage"). "Not used" removes the display's screen.
   * Displays that are not connected are left alone. Covering the operator's
   * display needs consent first, before anything changes.
   */
  applySetup(outputs: readonly SetupOutput[], rawOptions?: unknown): ScreensResult {
    const displays = this.listDisplays();
    const wanted = outputs.filter((o) => displays.some((d) => d.id === o.displayId));
    for (const o of wanted)
      if (o.use !== 'none') {
        const consent = this.needsCoverConsent(o.displayId, rawOptions);
        if (consent) return consent;
      }
    const screens = this.repo.screens();
    const onDisplay = matchDisplays(
      screens.flatMap((sc) => (sc.displayKey ? [{ screenId: sc.id, key: sc.displayKey }] : [])),
      displays,
    );
    const screensOn = (displayId: number) => screens.filter((sc) => onDisplay.get(sc.id) === displayId);
    const same = sameLanguages;
    const want = new Map(wanted.map((o) => [o.displayId, o]));

    // A group whose connected screens all want the same new role and languages changes in place.
    for (const g of this.repo.groups()) {
      const asked = g.screens.flatMap((sc) => {
        const d = onDisplay.get(sc.id);
        const o = d === undefined || d === null ? undefined : want.get(d);
        return o ? [o] : [];
      });
      const first = asked[0];
      if (!first || first.use === 'none' || asked.length !== g.screens.length) continue;
      if (!asked.every((o) => o.use === first.use && same(o.languages, first.languages))) continue;
      if (g.role !== first.use) this.repo.setGroupRole(g.id, first.use);
      if (!same(this.looks.liveLanguages(g.id), first.languages))
        this.looks.setLiveLanguages(g.id, first.languages);
    }
    // Then every output goes where it belongs.
    const groupFor = (use: 'audience' | 'stage', languages: Lang[] | null): string => {
      const found = this.repo
        .groups()
        .find((g) => g.role === use && same(this.looks.liveLanguages(g.id), languages));
      if (found) return found.id;
      const base = use === 'stage' ? 'Stage' : 'Audience';
      const names = new Set(this.repo.groups().map((g) => g.name));
      let name = base;
      for (let n = 2; names.has(name); n++) name = `${base} ${n}`;
      const id = this.repo.createGroup(name, use);
      // A group the wizard makes shows its languages in every Look.
      this.looks.groupMade(id, languages);
      return id;
    };
    for (const o of wanted) {
      const display = displays.find((d) => d.id === o.displayId);
      if (!display) continue;
      const [keep, ...extra] = screensOn(o.displayId);
      for (const sc of extra) this.repo.removeScreen(sc.id);
      if (o.use === 'none') {
        if (keep) this.repo.removeScreen(keep.id);
        continue;
      }
      const groupId = groupFor(o.use, o.languages);
      if (keep) {
        if (keep.groupId !== groupId || !keep.enabled) this.repo.moveScreen(keep.id, groupId);
      } else {
        const count = this.repo.screens().length;
        this.repo.addScreen(groupId, display.label || `Screen ${count + 1}`, display.key);
      }
    }
    this.looks.groupsChanged();
    return this.done();
  }

  removeScreen(rawId: unknown): ScreensResult {
    const id = idSchema.safeParse(rawId);
    if (!id.success || !this.repo.removeScreen(id.data)) return this.fail('That screen no longer exists.');
    return this.done();
  }

  // ---- Keep these screens? (Session 50) ------------------------------------------------------------------

  /** The screen setup as it is now, to put back exactly. */
  setup(): ScreensSetup {
    const saved = this.repo.saved();
    const languages: Record<string, Lang[] | null> = {};
    for (const g of saved.groups) languages[g.id] = this.looks.liveLanguages(g.id);
    return { ...saved, languages };
  }

  /**
   * Put a setup back exactly (Go back): its groups and screens, and each group's languages in the live Look; a
   * group made since leaves every Look. The outputs follow, unless Drashti is quitting (`quitting`): then it is
   * only saved, and no window opens or closes (the next start shows it).
   */
  putBack(setup: ScreensSetup, quitting = false): ScreensResult {
    for (const id of this.repo.putBack(setup)) this.looks.groupGone(id);
    for (const g of setup.groups) {
      const languages = setup.languages[g.id] ?? null;
      if (!sameLanguages(this.looks.liveLanguages(g.id), languages))
        this.looks.setLiveLanguages(g.id, languages);
    }
    this.looks.groupsChanged();
    return quitting ? { ok: true, snapshot: this.snapshot() } : this.done();
  }

  /**
   * What each display shows: every output on a connected display, this computer's ("here") and each node's, as
   * its screen, group and role. A change that makes a display show something it did not is one Drashti asks
   * about; turning an output off is not. A screen Audience or Stage has switched off shows nothing on its display
   * (Session 51, S2-1): turned off and on again meanwhile, nothing is put on a display, so nothing is asked, and
   * the switch on again puts it back where it was, asking nothing as ever.
   */
  placed(): Map<string, string> {
    const roles = new Map(this.repo.groupIds().map((g) => [g.id, g.role]));
    const switchedOff = new Set(
      this.outputs
        .status()
        .filter((st) => st.state === 'switched-off')
        .map((st) => st.screenId),
    );
    const placed = new Map<string, string>();
    const place = (where: string, screens: ScreenConfig[], displays: readonly DisplayInfo[]) => {
      const on = screens.filter(
        (sc): sc is ScreenConfig & { displayKey: DisplayKey } => sc.enabled && sc.displayKey !== null,
      );
      const matched = matchDisplays(
        on.map((sc) => ({ screenId: sc.id, key: sc.displayKey })),
        displays,
      );
      // Matched with the rest, as the outputs are, so each keeps its own display.
      for (const sc of on) {
        if (switchedOff.has(sc.id)) continue;
        const displayId = matched.get(sc.id);
        if (displayId !== undefined && displayId !== null)
          placed.set(
            `${where} ${String(displayId)}`,
            `${sc.id} ${sc.groupId} ${roles.get(sc.groupId) ?? ''}`,
          );
      }
    };
    place('here', this.repo.screens(), this.listDisplays());
    for (const node of this.nodes.displays()) place(node.id, this.repo.nodeScreens(node.id), node.displays);
    return placed;
  }
}
