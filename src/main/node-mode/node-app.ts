import { app, BrowserWindow, dialog, net, protocol, shell } from 'electron';
import {
  controllerArea,
  controllerRequestSchema,
  controllerReplySchema,
  type ControllerReply,
} from '../../shared/controller-actions';
import type { Installer } from '../update/installer';
import { UpdateService } from '../update/update-service';
import { basename, join } from 'node:path';
import { EngineMirror } from '../../shared/engine/mirror';
import { MainAccess } from './main-access';
import type { EngineSnapshotMessage } from '../../shared/engine/protocol';
import { ENGINE_STATE_VERSION, type EngineState, initialEngineState } from '../../shared/engine/state';
import { IPC } from '../../shared/ipc';
import {
  blurMediaId,
  copyMediaId,
  displayMediaId,
  displayOfId,
  MEDIA_ID_PATTERN,
  MEDIA_SCHEME,
  mediaUrl,
} from '../../shared/media';
import { saveStill } from '../media/stills';
import { sharpenStep } from '../../shared/picture-look';
import { picturesWithLocalDisplayCopies } from '../../shared/picture-display';
import { mediaInState } from '../../shared/node-media';
import { NO_PICTURE } from '../../shared/no-picture';
import { type PointedClip, sameClip } from '../../shared/point-ahead';
import {
  DEFAULT_NODE_PORT,
  type LinkState,
  type MediaWant,
  type NodeClock,
  type NodeControllerContext,
  type NodeHealth,
  type NodeScreen,
  type NodeView,
  type NodeViewResult,
  type ToNode,
} from '../../shared/nodes';
import {
  mediaWantListSchema,
  nodeNameFrom,
  nodeScreenListSchema,
  nodeControllerContextSchema,
} from '../../shared/nodes-schema';
import type { DisplayInfo, OutputContext, OutputReport, ScreenConfig } from '../../shared/screens';
import { missingFontsIn } from '../../shared/screens';
import { hallPictureOfScreens } from '../../shared/stage-layouts';
import type { CrashFile } from '../crash-files';
import type { CrashFilesChoice, DiagnosticsInput, NodeDiagnosticsInput } from '../diagnostics';
import { writeDiagnosticsFile } from '../diagnostics';
import { blankQuoted } from '../log-commands';
import { type LogPeriod, periodText } from '../../shared/log-period';
import { handle } from '../ipc/handle';
import { hearRenderErrors } from '../render-errors-ipc';
import { CHECK_EVERY_MS, OutputHeartbeat, TEST_GRACES } from '../outputs/heartbeat';
import { HEARTBEAT_KEEPS_A_PAGE } from '../../shared/screens-summary';
import { judgedOutputs } from '../outputs/judged-outputs';
import { keepsRestartingLine, keptLine, restartsWords } from '../outputs/heartbeat-words';
import { log } from '../log';
import { handleMediaRequest, mediaRequestOf } from '../media/media-protocol';
import {
  createOutputWindow,
  listDisplays,
  showDisplayNumber,
  watchDisplays,
} from '../outputs/electron-outputs';
import { OutputManager } from '../outputs/output-manager';
import { onQuitRefused } from '../outputs/quit-refused';
import type { SleepGuard } from '../outputs/sleep-guard';
import type { SelfTestResult } from '../selftest';
import { runNodeWatchdogSelfTest } from '../selftest';
import { IpcTransport } from '../transport/ipc-transport';
import type { RendererWatchdog, WatchdogEvent } from '../watchdog';
import { windowIcon } from '../windows/app-icon';
import { pageAlive, sendToPage } from '../windows/send';
import { loadPage } from '../windows/renderer';
import { watchLoadFailures } from '../outputs/load-failures';
import { followOutputs, type WarmUpChoices, warmUpFact } from '../outputs/warm-up-choice';
import { secureWebPreferences } from '../windows/web-preferences';
import { LinkClient, openMediaFromMain, pairWithMain, postReportToMain } from './link-client';
import { isReportId, readReportDraft } from '../../shared/report';
import type { GuideFiles } from '../guides';
import { readManual } from '../manual-service';
import { capturedPixelOrder } from '../library/pixel-order';
import type {
  DiagnosticsTextJob,
  DiagnosticsTextMade,
  ReportFilesJob,
  ReportFilesMade,
} from '../report/report-files';
import { type HeldPicture, ReportService } from '../report/report-service';
import { MediaCache } from './media-cache';
import { NodeStore, ShowSaver, type NodeFile } from './node-state';
import { cutText, plural } from '../../shared/text';
import { packaged, sw, swMs } from '../switches';
import { type ClockStyle, validClockStyle } from '../../shared/format';

/*
 * Drashti as a Node (Session 13): no library, no show controls and no sound.
 * A small window says which Main it follows, the link, its displays and its
 * media; output windows (the same output page as Main's) open on the
 * displays Main assigned, and draw the show Main's feed brings, on Main's
 * clock. The last show state and the screens are kept on disk, so a node
 * that restarts while Main is away shows the last picture again; when the
 * link drops, the screens hold their picture (videos play on) and the link
 * comes back by itself.
 */

export interface NodeAppDeps {
  /** This computer's appearance (Sessions 39–40): the node's own window opens on its colour and follows it. */
  appearance: { background(): string; track(win: BrowserWindow): void };
  userData: string;
  /** What the start found that the person at the node should read (Session 23), shown in its window. */
  startNotes: string[];
  version: string;
  /** Outputs as ordinary windows (development and tests). */
  windowed: boolean;
  watchdog: RendererWatchdog;
  sleepGuard: SleepGuard;
  /** Whether each output warms its graphics chip up (Session 57): not where Chromium draws without one. */
  warmUps: WarmUpChoices;
  /** Tests only: this computer's clock as if it were this far off, to stand in for another computer's. */
  clockSkewMs: number;
  /** This computer's name (as Main lists the node, and its window says). */
  computerName: string;
  /** Restart as Main (the role file is written first). */
  restartAsMain(): void;
  /** Something to stop as Drashti quits, in the one ordered list (../lifecycle.ts, Session 23). */
  atQuit(name: string, stop: () => unknown): void;
  /** Where releases are, and how this computer installs one (Session 14: matching Main's version). */
  updateBase: string;
  installer: Installer;
  /** Tests only: the download speed. */
  updateRate: number | null;
  /** For Help > Save Diagnostics… (Session 17): the versions, the watchdog's events, the log, the Desktop. */
  diagnostics: {
    app: () => DiagnosticsInput['app'];
    watchdogHistory: () => DiagnosticsInput['watchdog'];
    /** The crash journal, and whether the crash files go too (asked; null when cancelled): Sessions 31–36, ROB-6. */
    crashJournal: () => DiagnosticsInput['crashJournal'];
    chooseCrashFiles: () => Promise<CrashFilesChoice | null>;
    /** What the notice says once it is saved. */
    savedText: (path: string, crash: CrashFilesChoice) => string;
    /** The log files of a period's days, oldest first, and the days kept, newest first (alpha.21, logs (c)). */
    logFilesOf: (period: LogPeriod, now: number) => string[];
    logDays: () => readonly string[];
    /** This install's own id, and this computer's name as the Access List would show it (alpha.21, logs (b)). */
    installId: string;
    computer: () => string;
    /** Save Diagnostics' text, made by a report worker off the node's own thread. */
    makeText: (job: DiagnosticsTextJob) => Promise<DiagnosticsTextMade>;
    desktop: () => string;
  };
  /**
   * Help › Report a Problem… on a node (x49, the owner's Q60-42, 2): the crash files kept here, the report worker, the
   * Manual's files (its features), and (tests only) the wait before a try again. Its reports go through the Main it
   * is paired with.
   */
  reports: {
    crashFiles: () => CrashFile[];
    makeFiles: (job: ReportFilesJob) => Promise<ReportFilesMade>;
    guides: GuideFiles;
    retryMs?: readonly number[];
  };
}

/** What the node's menu can do (Session 17). */
export interface NodeAppHandle {
  /** A self-test's end is not the quit an update waits for. */
  holdUpdate: () => void;
  /** Help › Save Diagnostics (alpha.21, logs (c)): of the period chosen. */
  saveDiagnostics: (period: LogPeriod) => void;
  /** Help › Report a Problem… (x49): the node's window opens it. */
  reportProblem: () => void;
  runSelfTest: () => Promise<SelfTestResult>;
  crashWindow: () => void;
  crashOutputs: () => void;
  /** What the node does with its outputs' watchdog events (Sessions 31–36): Stopped when given up on. */
  watchdogEvent: (e: WatchdogEvent) => void;
  /** Mark an output as given up on (tests only: DRASHTI_TEST_GIVE_UP, never a packaged Drashti). */
  giveUp: (screenId: string) => void;
}

/** How often the node reports its health to Main. */
const HEALTH_EVERY_MS = 2000;

/** Tests only (never a packaged Drashti): a node's 2 minutes without a Main let in, shorter. */
function testGrace(): { graceMs?: number } {
  const ms = swMs('DRASHTI_TEST_ACCESS_STOP_MS');
  return ms === null ? {} : { graceMs: ms };
}

export function startNode(deps: NodeAppDeps): NodeAppHandle {
  const store = new NodeStore(deps.userData);
  const startNotes = [...deps.startNotes];
  const loaded = store.load({
    log: (line) => {
      log.warn(line);
    },
  });
  if (loaded.note) startNotes.push(loaded.note);
  let paired: NodeFile | null = loaded.paired;
  const host = nodeNameFrom(deps.computerName);
  const localNow = () => Date.now() + deps.clockSkewMs;

  // ---- the show, as Main's feed brings it (or as it was last kept) --------------------------
  const mirror = new EngineMirror();
  // Public permission from Main, held through a brief link drop. No pairing or certificate data changes.
  let controller: NodeControllerContext | null = null;
  let controllerReady = false;
  const pendingActions = new Map<
    string,
    {
      promise: Promise<ControllerReply>;
      resolve(answer: ControllerReply): void;
      timer: ReturnType<typeof setTimeout>;
      request: string;
    }
  >();
  const cancelActions = () => {
    for (const [id, pending] of pendingActions) {
      clearTimeout(pending.timer);
      pending.resolve({
        id,
        status: 'refused',
        rev: Math.max(0, mirror.rev),
        message: 'The link or permission changed. Check LIVE before pressing again.',
      });
    }
    pendingActions.clear();
  };
  let clock: NodeClock | null = null;
  let offsetMs = 0;
  let fromSaved = false;
  const saved = paired ? store.readShow() : null;
  if (saved && mirror.apply(saved.snapshot) === 'applied') {
    offsetMs = saved.offsetMs;
    fromSaved = true;
    log.info('Node: showing the last picture kept, until Main answers');
  }
  /** What to add to this computer's own clock (as the windows read it) to get Main's engine clock. */
  const outputOffset = () => deps.clockSkewMs + offsetMs;
  const engineNow = () => Date.now() + outputOffset();
  // A node shows only while it hears a Main let in (Session 54, access by Gmail: main-access.ts): until then, when
  // told it is not, and 2 minutes after it last heard one, its screens are black, the stop drawn over Main's state.
  const mainAccess = new MainAccess({
    engineNow,
    setTimer: (ms, run) => {
      const t = setTimeout(run, ms);
      return () => {
        clearTimeout(t);
      };
    },
    changed: () => {
      transport.broadcast(snapshot());
      viewChanged();
    },
    log: (line) => {
      log.info(line);
    },
    // Tests only (never a packaged Drashti): the 2 minutes shorter, as Main's own (behind-the-lock.ts).
    ...testGrace(),
  });
  /** Main's state as this node's screens draw it: black over it while no Main let in is heard. */
  let displayFilePresent: (mediaId: string) => boolean = () => false;
  const shown = (state: EngineState, localCopies = true): EngineState => {
    const pictures = localCopies
      ? picturesWithLocalDisplayCopies(state.pictures, displayFilePresent)
      : state.pictures;
    let drawing = pictures === state.pictures ? state : { ...state, pictures };
    const stop = mainAccess.stop;
    if (stop && !drawing.stopped) drawing = { ...drawing, stopped: stop };
    return drawing;
  };
  const snapshot = (outputs = true, localCopies = true): EngineSnapshotMessage => ({
    kind: 'snapshot',
    version: ENGINE_STATE_VERSION,
    rev: mirror.rev,
    state: outputs
      ? shown(mirror.state ?? initialEngineState(), localCopies)
      : (mirror.state ?? initialEngineState()),
    sentAt: engineNow(),
    ...(mirror.session !== undefined ? { session: mirror.session } : {}),
  });
  const transport = new IpcTransport((error, target) => {
    log.warn(`Node: could not send the show to window ${target.id}`, error);
  });
  const controllerTransport = new IpcTransport((error, target) => {
    log.warn(`Node: could not send the shared show view to window ${target.id}`, error);
  });
  const saver = new ShowSaver(store, (m) => {
    log.warn(`Node: ${m}`);
  });

  /** Reports kept while Main was away are handed over once the link is back (x49; set once the reports are made). */
  let problemReportsWake: (() => void) | null = null;
  // ---- link state, for the window ------------------------------------------------------------
  let link: { state: LinkState; why: string | null; since: number } = {
    state: paired ? 'connecting' : 'unpaired',
    why: null,
    since: Date.now(),
  };
  let nodeWindow: BrowserWindow | null = null;
  let viewTimer: NodeJS.Timeout | null = null;
  /** Main refused this node for its version: Main's version, to update to (Session 14). */
  let mainVersion: string | null = null;
  /** Matching Main's version: offered once Main has refused this node for its version. */
  const updates = new UpdateService({
    current: deps.version,
    platform: process.platform,
    arch: process.arch,
    base: deps.updateBase,
    dir: join(deps.userData, 'Updates'),
    packaged: packaged(),
    fetch: (url, init) => net.fetch(url, init),
    installer: deps.installer,
    // A node streams nothing; it never waits for that.
    onAir: () => false,
    autoCheck: null,
    now: Date.now,
    changed: () => {
      viewChanged();
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(`Node: ${message}`);
      else log.info(`Node: ${message}`);
    },
    ...(deps.updateRate ? { bytesPerSecond: deps.updateRate } : {}),
  });
  deps.atQuit('updates (an install at quit)', () => {
    updates.quit();
  });
  /** A line the node's window shows for a while (diagnostics saved, say), as Main's live controls do. */
  let notice: string | null = null;
  let noticeTimer: NodeJS.Timeout | null = null;
  const say = (text: string) => {
    // Every notice in the log (alpha.21, logs (a)), its names in quotes blanked.
    log.info(`Notice: ${blankQuoted(text.replace(/\s+/gu, ' ').trim())}`);
    notice = text;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      notice = null;
      noticeTimer = null;
      viewChanged();
    }, 20_000);
    viewChanged();
  };
  const viewChanged = () => {
    viewTimer ??= setTimeout(() => {
      viewTimer = null;
      if (pageAlive(nodeWindow)) sendToPage(nodeWindow, IPC.node.changed, view());
    }, 150);
  };

  // ---- media copies ----------------------------------------------------------------------------
  let client: LinkClient | null = null;
  const cacheDir = join(deps.userData, 'Media cache');
  const inUse = () => {
    const s = mirror.state;
    if (!s) return [];
    const m = mediaInState(s);
    // A picture's sharpened copy that Main has ready (Session 26f) is fetched as soon as the picture is.
    const copies = [...m.now, ...m.next].flatMap((id) => {
      const look = s.pictures[id];
      return [
        ...(look?.copy && look.copy === sharpenStep(look.sharpness) ? [copyMediaId(id, look.copy)] : []),
        // Its blurred copy (Session 55, Part 5, D), once Main has it ready.
        ...(look?.blurred ? [blurMediaId(id)] : []),
      ];
    });
    const display = [...m.now, ...m.next].flatMap((id) => {
      const ready = s.pictures[id]?.display;
      return ready ? [displayMediaId(id, ready.key)] : [];
    });
    return [...display, ...m.now, ...m.next, ...copies];
  };
  const cache = new MediaCache({
    dir: cacheDir,
    open: (mediaId, from) => {
      if (!paired || !client) return Promise.reject(new Error('Not paired with a Main'));
      return openMediaFromMain(paired.main, client.host, paired.token, mediaId, from);
    },
    online: () => client?.online ?? false,
    inUse,
    changed: viewChanged,
    // A screen that stopped waiting for this file (Main was away, say) loads it now.
    landed: (mediaId) => {
      for (const win of outputWindows.values()) sendToPage(win, IPC.output.mediaReady, { mediaId });
      if (controller) sendToPage(nodeWindow, IPC.output.mediaReady, { mediaId });
      if (displayOfId(mediaId) || mirror.state?.pictures[mediaId]?.display) transport.broadcast(snapshot());
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(`Node: ${message}`);
      else log.info(`Node: ${message}`);
    },
  });
  displayFilePresent = (id) => cache.has(id);
  protocol.handle(MEDIA_SCHEME, async (request) => {
    let asked = mediaRequestOf(request.url);
    if (asked?.what === 'display') {
      const id = displayMediaId(asked.mediaId, asked.key);
      request = new Request(mediaUrl(id), { method: request.method, headers: request.headers });
      asked = { what: 'media', mediaId: id };
    }
    // A picture's sharpened copy (Session 26f) is a file of its own here, copied from Main as media is.
    if (asked?.what === 'sharp') {
      const id = copyMediaId(asked.mediaId, asked.step);
      request = new Request(mediaUrl(id), { method: request.method, headers: request.headers });
      asked = { what: 'media', mediaId: id };
    }
    // A picture's blurred copy (Session 55, D) is a file of its own here too.
    if (asked?.what === 'blur') {
      const id = blurMediaId(asked.mediaId);
      request = new Request(mediaUrl(id), { method: request.method, headers: request.headers });
      asked = { what: 'media', mediaId: id };
    }
    // On the screens before its copy arrived: fetched at once, and the screen's request waits for it
    // (the picture before it stays up meanwhile) for as long as it is on the screens and can still
    // come. Requests for files already here never wait behind it.
    if (asked?.what === 'media' && !cache.has(asked.mediaId)) await cache.ensure(asked.mediaId);
    return handleMediaRequest(request, {
      mediaDir: cacheDir,
      lookup: (id) => {
        const path = cache.pathFor(id);
        return path
          ? { path: path.slice(cacheDir.length + 1), missing: false, sha256: cache.hashFor(id) }
          : null;
      },
    });
  });

  // ---- outputs on the displays Main assigned ------------------------------------------------
  const outputWindows = new Map<string, BrowserWindow>();
  /** Each output's name, as the watchdog and the log call it. */
  const outputNames = new Map<string, string>();
  const reports = new Map<string, OutputReport>();
  /**
   * Outputs given up on (Sessions 31–36) whose page has loaded again since: their next report ends Stopped,
   * as on Main (Session 23).
   */
  const loadedSinceStopped = new Set<string>();
  // Tests only (never a packaged Drashti): a node's outputs held at one moment of the engine's time, as Main's
  // are (Session 27), so a node and Main can be compared pixel for pixel part-way through a transition.
  if (!packaged() && sw('DRASHTI_TEST_CLOCK_HOLD') === '1')
    (globalThis as { drashtiTestHoldClock?: (at: number | null) => number }).drashtiTestHoldClock = (at) => {
      let reached = 0;
      for (const win of outputWindows.values())
        if (pageAlive(win)) {
          sendToPage(win, IPC.output.testClock, { at });
          reached++;
        }
      return reached;
    };
  const screenOf = (id: string): NodeScreen | undefined => paired?.screens.find((s) => s.screenId === id);
  const asConfig = (s: NodeScreen): ScreenConfig => ({
    id: s.screenId,
    groupId: s.groupId,
    name: s.name,
    displayKey: s.displayKey,
    canvasWidth: s.canvasWidth,
    canvasHeight: s.canvasHeight,
    scaling: s.scaling,
    enabled: s.enabled,
    feed: s.feed,
    nodeId: null,
    // Its geometry as Main sent it (x27), a key's its fill's already.
    geometry: s.geometry ?? null,
  });
  /** How Main writes the time, from its welcome (Sessions 31–36, I18N-8); null until it says. */
  let mainClock: ClockStyle | null = null;
  const contextFor = (screenId: string): OutputContext | null => {
    const s = screenOf(screenId);
    if (!s) return null;
    const displayId = manager.status().find((st) => st.screenId === screenId)?.displayId;
    const d = listDisplays().find((x) => x.id === displayId);
    return {
      screenId: s.screenId,
      screenName: s.name,
      groupId: s.groupId,
      groupName: s.groupName,
      role: s.role,
      feed: s.feed,
      canvasWidth: s.canvasWidth,
      canvasHeight: s.canvasHeight,
      scaling: s.scaling,
      display: d
        ? {
            pixelWidth: d.pixelWidth,
            pixelHeight: d.pixelHeight,
            refreshHz: d.refreshHz,
            scaleFactor: d.scaleFactor,
          }
        : null,
      clockOffsetMs: outputOffset(),
      ...(mainClock ? { clockStyle: mainClock } : {}),
      // A stage layout's audience picture box (Session 50): this node's own first audience screen's picture; with
      // none, Main's hall as Main sent it with this stage screen (Session 51), never every layer.
      hall: hallPictureOfScreens(paired?.screens ?? [], s.hall ?? null),
      // No warm-up where Chromium draws without a graphics chip (Session 57), as on Main.
      ...warmUpFact(
        deps.warmUps,
        outputWindows.get(screenId),
        outputNames.get(screenId) ?? 'an output',
        s.role,
      ),
      // Its picture's geometry as Main sent it (x27; a key's its fill's), and the grid while Main's Screens adjusts it.
      geometry: s.geometry ?? null,
      ...(s.grid === true ? { grid: true as const } : {}),
    };
  };
  const sendContexts = () => {
    for (const [screenId, win] of outputWindows) {
      const context = contextFor(screenId);
      if (context) sendToPage(win, IPC.output.context, context);
    }
  };
  // An output open before Chromium said how it draws is sent its context again once it skips its warm-up (Session 57).
  followOutputs(deps.warmUps, outputWindows, outputNames, (screenId, win) => {
    const context = contextFor(screenId);
    if (context) sendToPage(win, IPC.output.context, context);
  });
  // Hung and stale outputs (Session 23; ../outputs/heartbeat.ts): as on Main, an output whose reports
  // stop, or stop showing the show, is crashed into the watchdog's reload.
  /** The outputs the log said keep restarting (a23-heartbeat): said once each time it starts. */
  const keepsRestarting = new Set<string>();
  // Tests only (never a packaged Drashti; review SA4), as on Main: shorter graces, and a hook that drops an output's
  // reports.
  const heartbeatFast = !packaged() && sw('DRASHTI_TEST_HEARTBEAT_FAST') === '1';
  const heartbeatDeaf = new Set<string>();
  if (heartbeatFast)
    (
      globalThis as { drashtiTestHeartbeatDeaf?: (screenId: string, on: boolean) => void }
    ).drashtiTestHeartbeatDeaf = (screenId, on) => {
      if (on) heartbeatDeaf.add(screenId);
      else heartbeatDeaf.delete(screenId);
    };
  const heartbeat = new OutputHeartbeat({
    now: Date.now,
    engineRev: () => mirror.rev,
    judged: () => judgedOutputs(manager.status(), (id) => outputWindows.get(id)),
    ...(heartbeatFast ? { graces: TEST_GRACES } : {}),
    stuck: (screenId, reason, inARow) => {
      const w = outputWindows.get(screenId);
      if (!w || w.isDestroyed()) return;
      const name = outputNames.get(screenId) ?? 'an output';
      log.warn(`Node: output ${name} is stuck (${reason}): restarting it${restartsWords(inARow)}`);
      deps.watchdog.stuck(w.webContents, name, reason);
    },
    // Restarted again and again (a23-heartbeat): Main's Screens and status line say so (from its next health, at
    // most 2 s on), the log too.
    told: (screenId, restarts) => {
      manager.setRestarting(screenId, restarts);
      const name = outputNames.get(screenId) ?? 'an output';
      if (restarts === null) {
        if (keepsRestarting.delete(screenId)) log.info(`Node: output ${name} no longer keeps restarting`);
      } else if (!keepsRestarting.has(screenId)) {
        keepsRestarting.add(screenId);
        log.warn(keepsRestartingLine(`Node: output ${name}`, restarts, HEARTBEAT_KEEPS_A_PAGE));
      }
    },
    // HELD FOR THE OWNER (QA23-HEARTBEAT-1, A), as on Main: kept as it is, Stopped (Main's notice says why), tried
    // again by the node's watchdog's own tries; back by itself once it paints the show.
    keep: (screenId, reason, restarts) => {
      const w = outputWindows.get(screenId);
      if (!w || w.isDestroyed()) return;
      const name = outputNames.get(screenId) ?? 'an output';
      log.warn(keptLine(`Node: output ${name}`, reason, restarts));
      manager.setNotAnswering(screenId, true);
      deps.watchdog.stopTrying(
        w.webContents,
        name,
        `stuck again (${reason}) after ${String(restarts)} restarts in a row`,
      );
    },
    back: (screenId) => {
      const w = outputWindows.get(screenId);
      log.info(`Node: output ${outputNames.get(screenId) ?? 'an output'} draws the show again by itself`);
      manager.setStopped(screenId, false);
      if (w && !w.isDestroyed()) deps.watchdog.backByItself(w.webContents);
    },
    // Translated, a page's reports may come 30 s apart (a23-heartbeat), as on Main.
    translated: app.runningUnderARM64Translation,
  });
  const heartbeatTimer = setInterval(() => {
    heartbeat.check();
  }, CHECK_EVERY_MS);
  deps.atQuit('output heartbeat', () => {
    clearInterval(heartbeatTimer);
  });
  const manager = new OutputManager({
    listDisplays,
    screens: () => (paired?.screens ?? []).map(asConfig),
    saveDisplayKey: (id, key) => {
      const s = screenOf(id);
      if (s && paired) {
        s.displayKey = key;
        store.write(paired);
      }
    },
    openWindow: (config, display) => {
      log.info(`Node: opening output "${config.name}" on ${display.label || display.id}`);
      const { window, handle: h } = createOutputWindow(config, display, { windowed: deps.windowed });
      outputWindows.set(config.id, window);
      outputNames.set(config.id, `output "${config.name}"`);
      deps.watchdog.watch(window.webContents, `output "${config.name}"`);
      watchLoadFailures(window, {
        name: `output "${config.name}"`,
        screen: config.id,
        watchdog: deps.watchdog,
        log: (message) => {
          log.warn(`Node: ${message}`);
        },
      });
      // A new window starts afresh, as on Main (a23-heartbeat, review S2).
      heartbeat.closed(config.id);
      heartbeat.opened(config.id);
      window.webContents.on('did-start-loading', () => {
        heartbeat.opened(config.id);
        loadedSinceStopped.add(config.id);
      });
      window.on('closed', () => {
        deps.warmUps.forget(h.webContentsId);
        if (outputWindows.get(config.id) === window) {
          outputWindows.delete(config.id);
          heartbeat.closed(config.id);
        }
        reports.delete(config.id);
      });
      return h;
    },
    onChange: () => {
      sendContexts();
      // A stopped output (Sessions 31–36) is still on its display and tried again: the display stays awake.
      deps.sleepGuard.update(
        manager.status().filter((st) => st.state === 'showing' || st.state === 'stopped').length,
      );
      viewChanged();
    },
  });

  /** An output the watchdog gave up on: Stopped until a page loaded since reports again. */
  const stopOutput = (screenId: string) => {
    loadedSinceStopped.delete(screenId);
    manager.setStopped(screenId, true);
  };

  // ---- health, pictures and orders from Main ----------------------------------------------------
  const health = (): NodeHealth => {
    const s = mirror.state;
    const missingNow = s ? inUse().filter((id) => !cache.has(id)).length : 0;
    return {
      version: deps.version,
      host,
      displays: listDisplays(),
      outputs: manager.status().flatMap((st) => {
        if (
          st.state !== 'showing' &&
          st.state !== 'stopped' &&
          st.state !== 'missing-display' &&
          st.state !== 'disabled'
        )
          return [];
        const r = reports.get(st.screenId);
        return [
          {
            screenId: st.screenId,
            state: st.state,
            displayId: st.displayId,
            droppedFrames: r?.droppedFrames ?? 0,
            paintedRev: r?.paintedRev ?? -1,
            ...(r?.missingFonts && r.missingFonts.length > 0 ? { missingFonts: r.missingFonts } : {}),
            // Restarted again and again by its heartbeat (a23-heartbeat): Main says so.
            // Held under the health's own limit (review N1: past it Main would drop the node's whole health).
            ...(st.restarts === undefined ? {} : { restarts: Math.min(st.restarts, 100_000) }),
            // Held for the owner (QA23-HEARTBEAT-1, A): stopped, its page kept as it is.
            ...(st.notAnswering === true ? { notAnswering: true as const } : {}),
          },
        ];
      }),
      media: cache.status(missingNow),
      clock,
      rev: mirror.rev,
      // Whether it draws without a graphics chip (x27), for Adjust the picture… on Main.
      ...(deps.warmUps.drawsWithoutChip() ? { noGpu: true as const } : {}),
    };
  };
  let healthTimer: NodeJS.Timeout | null = null;
  let thumbTimer: NodeJS.Timeout | null = null;
  const sendThumbs = () => {
    for (const [screenId, win] of outputWindows) {
      if (win.isDestroyed()) continue;
      void win.webContents
        .capturePage()
        .then((image) => {
          if (image.isEmpty()) return;
          const jpeg = image.resize({ width: 320, quality: 'good' }).toJPEG(60).toString('base64');
          client?.send({ type: 'thumb', screenId, jpeg });
        })
        .catch(() => undefined);
    }
  };
  let pointed: PointedClip | null = null;
  const updatePointed = (clip: PointedClip | null) => {
    if (sameClip(pointed, clip)) return;
    pointed = clip;
    for (const win of outputWindows.values()) sendToPage(win, IPC.output.pointed, { clip });
  };
  const fromMain = (message: ToNode) => {
    switch (message.type) {
      case 'engine': {
        const result = mirror.apply(message.message);
        if (result === 'applied') {
          if (message.message.kind === 'snapshot') {
            controllerReady = true;
            viewChanged();
          }
          heartbeat.changed(mirror.rev);
          fromSaved = false;
          // A whole state from Main keeps the black over it while no Main let in is heard (Session 54).
          const m = message.message;
          controllerTransport.broadcast(m);
          transport.broadcast(
            m.kind === 'snapshot'
              ? { ...m, state: shown(m.state) }
              : {
                  ...m,
                  ops: m.ops.map((op) =>
                    op.path.length === 1 && op.path[0] === 'pictures'
                      ? {
                          ...op,
                          value: picturesWithLocalDisplayCopies(
                            mirror.state?.pictures ?? {},
                            displayFilePresent,
                          ),
                        }
                      : op,
                  ),
                },
          );
          // Keep Main's full copy metadata for restart and download priority, including this node's access stop.
          saver.update(snapshot(true, false), offsetMs);
          cache.kick();
        } else if (result === 'resync') {
          controllerReady = false;
          viewChanged();
          client?.send({ type: 'resync' });
        }
        return;
      }
      case 'controller-answer': {
        const checked = controllerReplySchema.safeParse(message.answer);
        if (!checked.success) return;
        const pending = pendingActions.get(checked.data.id);
        if (pending) {
          clearTimeout(pending.timer);
          pendingActions.delete(checked.data.id);
          pending.resolve(checked.data);
        }
        return;
      }
      case 'controller': {
        const parsed = nodeControllerContextSchema.nullable().safeParse(message.context);
        if (parsed.success) {
          controller = parsed.data;
          if (!controller || (controller.areas?.length ?? 0) === 0) cancelActions();
          mainAccess.setController(controller !== null);
          nodeWindow?.setTitle(controller ? 'Drashti Controller' : 'Drashti Node');
          viewChanged();
        }
        return;
      }
      case 'screens': {
        const screens = nodeScreenListSchema.safeParse(message.screens);
        if (!screens.success || !paired) return;
        paired = { ...paired, screens: screens.data };
        store.write(paired);
        manager.reconcile();
        return;
      }
      case 'media': {
        const wanted = mediaWantListSchema.safeParse(message.wanted);
        if (wanted.success) cache.setWanted(wanted.data satisfies MediaWant[]);
        return;
      }
      case 'thumbs':
        if (thumbTimer) clearInterval(thumbTimer);
        thumbTimer = null;
        if (message.everyMs !== null) {
          sendThumbs();
          thumbTimer = setInterval(sendThumbs, Math.max(1000, message.everyMs));
        }
        return;
      case 'identify':
        identify(message.displayId, message.label);
        return;
      case 'reload': {
        const win = outputWindows.get(message.screenId);
        if (win && !win.isDestroyed()) {
          log.info('Node: Main asked to reload an output');
          // Main's Try again for a screen that keeps restarting (a23-heartbeat) too: its restarts start afresh.
          heartbeat.afresh(message.screenId);
          win.webContents.reload();
        }
        return;
      }
      case 'access':
        mainAccess.heard(message.letIn);
        return;
      // The deck slide the operator points at on Main (C3, Session 58): this node's outputs load its clip ahead.
      case 'pointed':
        updatePointed(message.clip);
        return;
      case 'tryAgain': {
        // Try again on Main's dashboard or its notice (Sessions 31–36): an output given up on, tried again
        // now by the node's watchdog, its count of crashes starting afresh.
        const win = outputWindows.get(message.screenId);
        const stopped = manager
          .status()
          .some((st) => st.screenId === message.screenId && st.state === 'stopped');
        if (win && !win.isDestroyed() && stopped) {
          log.info('Node: Main asked to try a stopped output again');
          deps.watchdog.retryNow(win.webContents, 'Try again on Main');
        }
        return;
      }
      default:
        return;
    }
  };

  const identify = (displayId: number | null, label: string): number => {
    const displays = listDisplays();
    const shown = displays
      .map((d, i) => ({ d, n: i + 1 }))
      .filter(({ d }) => displayId === null || d.id === displayId);
    for (const { d, n } of shown) {
      // A display with an output: the output says it; one without gets its number for a few seconds.
      const screenId = manager
        .status()
        .find((st) => st.displayId === d.id && st.state === 'showing')?.screenId;
      const win = screenId ? outputWindows.get(screenId) : undefined;
      const s = screenId ? screenOf(screenId) : undefined;
      if (win && s)
        sendToPage(win, IPC.output.identify, {
          name: `${n}: ${s.name}`,
          groupName: `${host} · ${s.groupName}`,
          label,
        });
      else showDisplayNumber(d, n, { windowed: deps.windowed, forMs: 5000 });
    }
    return shown.length;
  };

  // ---- the link ------------------------------------------------------------------------------------
  const linkChanged = (state: LinkState, why: string | null) => {
    if (state !== link.state || why !== link.why) {
      link = { state, why, since: Date.now() };
      log.info(`Node: link ${state}${why ? ` (${why})` : ''}`);
    }
    if (state === 'online') {
      cache.backOnline();
      // Reports kept while Main was away go now (x49).
      problemReportsWake?.();
    } else {
      cancelActions();
      controllerReady = false;
      updatePointed(null);
    }
    viewChanged();
  };
  const connect = () => {
    if (!paired) return;
    const pairing = paired;
    client?.stop();
    client = new LinkClient(
      pairing.main,
      pairing.token,
      deps.version,
      {
        state: linkChanged,
        welcome: (main) => {
          controllerReady = false;
          // How Main writes the time (Sessions 31–36, I18N-8): this node's clocks show Main's.
          const style = validClockStyle(main.clock);
          if (JSON.stringify(style) !== JSON.stringify(mainClock)) {
            mainClock = style;
            sendContexts();
          }
          if (!paired) return;
          paired = {
            ...paired,
            main: {
              ...paired.main,
              name: main.name,
              addresses: client?.pinned.addresses ?? paired.main.addresses,
            },
          };
          store.write(paired);
          sendHealthNow();
        },
        message: fromMain,
        refusedVersion: (version) => {
          if (version !== mainVersion) {
            mainVersion = version;
            viewChanged();
          }
        },
        clock: (c) => {
          const before = offsetMs;
          clock = c;
          offsetMs = c.offsetMs;
          // The outputs follow Main's clock: told when it moves by more than a millisecond.
          if (Math.abs(offsetMs - before) > 1) {
            sendContexts();
            viewChanged();
          }
        },
        removed: () => {
          log.warn('Node: Main removed this node; its pairing is forgotten');
          forget();
        },
      },
      localNow,
    );
    client.start();
  };
  const sendHealthNow = () => {
    client?.sendHealth(health());
  };
  healthTimer = setInterval(sendHealthNow, HEALTH_EVERY_MS);

  const forget = () => {
    client?.stop();
    client = null;
    paired = null;
    cancelActions();
    controller = null;
    controllerReady = false;
    mainAccess.setController(false);
    nodeWindow?.setTitle('Drashti Node');
    store.forget();
    manager.reconcile();
    link = { state: 'unpaired', why: link.why, since: Date.now() };
    viewChanged();
  };

  // ---- the node's window ----------------------------------------------------------------------------
  const view = (): NodeView => {
    const status = manager.status();
    const displays: DisplayInfo[] = listDisplays();
    return {
      version: deps.version,
      host,
      paired: paired
        ? {
            main: {
              name: paired.main.name,
              addresses: paired.main.addresses,
              port: paired.main.port,
              fingerprint: paired.main.fingerprint,
            },
            node: { name: paired.node.name },
            pairedAt: paired.pairedAt,
          }
        : null,
      link,
      displays: displays.map((d) => {
        const st = status.find((x) => x.displayId === d.id && x.state === 'showing');
        const s = st
          ? screenOf(st.screenId)
          : (paired?.screens.find((x) => x.displayKey.id === d.id) ?? undefined);
        return {
          id: d.id,
          label: d.label,
          pixelWidth: d.pixelWidth,
          pixelHeight: d.pixelHeight,
          refreshHz: d.refreshHz,
          screen: s ? { name: s.name, groupName: s.groupName, showing: st !== undefined } : null,
        };
      }),
      media: cache.status(mirror.state ? inUse().filter((id) => !cache.has(id)).length : 0),
      clock,
      fromSaved,
      controller: controller
        ? {
            ...controller,
            connected: link.state === 'online' && controllerReady && mainAccess.stopped === null,
            clockOffsetMs: outputOffset(),
          }
        : null,
      stopped: mainAccess.stopped,
      mainVersion: link.state === 'refused' ? mainVersion : null,
      update: updates.view(),
      notice,
      startNotes: [...startNotes],
    };
  };

  handle(IPC.node.view, () => view());
  handle(IPC.node.action, (event, raw): Promise<ControllerReply> | ControllerReply => {
    const parsed = controllerRequestSchema.safeParse(raw);
    const id = parsed.success ? parsed.data.id : '';
    const refuse = (message: string): ControllerReply => ({
      id,
      status: 'refused',
      rev: Math.max(0, mirror.rev),
      message,
    });
    if (!pageAlive(nodeWindow) || event.sender.id !== nodeWindow.webContents.id || !parsed.success)
      return refuse('That press is not offered here.');
    const request = parsed.data;
    const area = controllerArea(request.command);
    if (
      !paired ||
      !client ||
      link.state !== 'online' ||
      !controllerReady ||
      !controller ||
      mainAccess.stopped !== null
    )
      return refuse('Not connected to Main. Check LIVE before pressing again.');
    if (!area || !controller.areas?.includes(area))
      return refuse('Main has not allowed that action for this computer.');
    const fingerprint = JSON.stringify(request);
    const prior = pendingActions.get(id);
    if (prior)
      return prior.request === fingerprint ? prior.promise : refuse('Use a new press after checking LIVE.');
    if (pendingActions.size >= 8) return refuse('Wait for Main’s answer before pressing again.');
    let finish: (answer: ControllerReply) => void = () => undefined;
    const promise = new Promise<ControllerReply>((resolve) => {
      finish = resolve;
    });
    const timer = setTimeout(() => {
      pendingActions.delete(id);
      finish(refuse('Main has not answered. Check LIVE before pressing again.'));
    }, 4000);
    pendingActions.set(id, { promise, resolve: finish, timer, request: fingerprint });
    client.send({ type: 'controller-action', request });
    return promise;
  });
  handle(IPC.node.pair, async (_e, rawAddress, rawCode): Promise<NodeViewResult> => {
    if (typeof rawAddress !== 'string' || typeof rawCode !== 'string')
      return { ok: false, message: 'Type Main’s address and the code it shows.' };
    if (paired) return { ok: false, message: 'This node already follows a Main. Unpair it first.' };
    const result = await pairWithMain({
      address: rawAddress,
      defaultPort: DEFAULT_NODE_PORT,
      code: rawCode,
      name: host,
      version: deps.version,
    });
    if (!result.ok) {
      log.warn(`Node: pairing refused (${result.message})`);
      if (result.mainVersion) {
        mainVersion = result.mainVersion;
        link = { state: 'refused', why: result.message, since: Date.now() };
        viewChanged();
      }
      return { ok: false, message: result.message };
    }
    const { version: _version, ...main } = result.main;
    paired = {
      main,
      token: result.token,
      node: result.node,
      screens: [],
      pairedAt: new Date().toISOString(),
    };
    store.write(paired);
    log.info(`Node: paired with Main “${main.name}”`);
    link = { state: 'connecting', why: null, since: Date.now() };
    connect();
    return { ok: true, view: view() };
  });
  handle(IPC.node.unpair, (): NodeViewResult => {
    log.info('Node: unpaired from its Main');
    forget();
    link = { state: 'unpaired', why: null, since: Date.now() };
    return { ok: true, view: view() };
  });
  handle(IPC.node.useAsMain, () => {
    // Drashti starts again at once: an update waits for a quit of its own (as on Main).
    updates.holdForNextQuit();
    deps.restartAsMain();
    return { ok: true };
  });
  handle(IPC.node.identify, () => ({ shown: identify(null, '') }));
  // Matching Main's version (Session 14): look for it, download it, then quit to install it.
  handle(IPC.node.updateCheck, async (): Promise<NodeViewResult> => {
    if (!mainVersion) return { ok: false, message: 'Main has not said which version it runs.' };
    const r = await updates.check(mainVersion);
    return r.ok ? { ok: true, view: view() } : { ok: false, message: r.message };
  });
  handle(IPC.node.updateDownload, (): NodeViewResult => {
    const r = updates.download();
    return r.ok ? { ok: true, view: view() } : { ok: false, message: r.message };
  });
  handle(IPC.node.updateInstall, async (): Promise<NodeViewResult> => {
    const r = await updates.setInstallOnQuit(true);
    if (!r.ok) return { ok: false, message: r.message };
    if (!r.view.installOnQuit)
      return { ok: false, message: r.view.message ?? 'It cannot install by itself here.' };
    log.info('Node: quitting to install the update, as asked');
    // Quit on purpose, as asked: the installer starts once Drashti has quit.
    setTimeout(() => {
      app.quit();
    }, 200);
    return { ok: true, view: view() };
  });
  handle(IPC.node.updateShowFile, () => {
    const file = updates.downloadedFile();
    if (file) shell.showItemInFolder(file);
    return null;
  });

  // The output page's own requests: the show, its screen, and how it draws.
  handle(IPC.engine.videoCueReady, (event, cueId, kind, ready) => {
    const screenId = manager.screenIdFor(event.sender.id);
    const cue = snapshot().state.videoCue;
    if (
      kind !== 'picture' ||
      typeof cueId !== 'string' ||
      typeof ready !== 'boolean' ||
      !screenId ||
      cue?.id !== cueId
    )
      return null;
    if (!cache.has(cue.background.mediaId)) return null;
    client?.send({ type: 'video-cue', report: { cueId, screenId, state: ready ? 'ready' : 'failed' } });
    return null;
  });
  handle(IPC.engine.subscribe, (event) => {
    const shared = pageAlive(nodeWindow) && event.sender.id === nodeWindow.webContents.id;
    (shared ? controllerTransport : transport).add(event.sender);
    const screenId = manager.screenIdFor(event.sender.id);
    const cue = snapshot().state.videoCue;
    if (screenId && cue)
      client?.send({ type: 'video-cue', report: { cueId: cue.id, screenId, state: 'loading' } });
    return snapshot(!shared);
  });
  handle(IPC.engine.snapshot, (event) =>
    snapshot(!(pageAlive(nodeWindow) && event.sender.id === nodeWindow.webContents.id)),
  );
  handle(IPC.output.getContext, (event) => {
    const screenId = manager.screenIdFor(event.sender.id);
    return screenId ? contextFor(screenId) : null;
  });
  handle(IPC.output.getPointed, ({ sender }) =>
    manager.screenIdFor(sender.id) !== undefined ? pointed : null,
  );
  // Render errors in the node's windows (Session 23): logged; an output draws black and is reloaded once.
  hearRenderErrors({
    log: (line) => {
      log.warn(`Node: ${line}`);
    },
    watchdog: deps.watchdog,
    windowOf: (sender) => {
      const screenId = manager.screenIdFor(sender.id);
      const output = screenId ? outputWindows.get(screenId) : undefined;
      if (screenId && output && !output.isDestroyed())
        return { name: outputNames.get(screenId) ?? 'an output', output: output.webContents };
      if (nodeWindow && !nodeWindow.isDestroyed() && sender.id === nodeWindow.webContents.id)
        return { name: 'the node’s window', output: null };
      return { name: 'a window', output: null };
    },
  });
  handle(IPC.output.report, (event, raw) => {
    const screenId = manager.screenIdFor(event.sender.id);
    // Tests only (DRASHTI_TEST_HEARTBEAT_FAST): a page that does not answer sends no report.
    if (screenId && heartbeatDeaf.has(screenId)) return null;
    const r = raw as Partial<OutputReport> | null;
    if (screenId && r && typeof r.droppedFrames === 'number' && typeof r.paintedRev === 'number') {
      reports.set(screenId, {
        droppedFrames: r.droppedFrames,
        paintedRev: r.paintedRev,
        missingFonts: missingFontsIn(r.missingFonts),
      });
      heartbeat.report(screenId, r.paintedRev);
      // Reporting from a page loaded since it was given up on: it draws again.
      if (loadedSinceStopped.has(screenId)) manager.setStopped(screenId, false);
    }
    return null;
  });
  // The shared view's NEXT thumbnails are made and kept on this computer only, never written on Main.
  handle(IPC.media.saveStill, (event, rawId, jpeg) => {
    if (
      !paired ||
      !pageAlive(nodeWindow) ||
      event.sender.id !== nodeWindow.webContents.id ||
      typeof rawId !== 'string' ||
      !MEDIA_ID_PATTERN.test(rawId)
    )
      return {
        ok: false as const,
        message: 'Only this node’s window can keep its still frames.',
      };
    const hash = cache.hashFor(rawId);
    return hash
      ? saveStill(cacheDir, hash, jpeg)
      : { ok: false as const, message: 'That file has not been copied here yet.' };
  });
  // A node keeps no lengths (the library is Main's).
  handle(IPC.media.reportLength, () => null);
  // A showing one of this node's screens could not play (Q60-44, the owner's answer A of 20 Nov 2026; ledger G-A14):
  // its element failed, its first frame never came, or its picture cannot be drawn here (x36's sound only). The screen
  // keeps what it showed (its page's slots, render/background-slots.ts), never black; Main is told and tells its
  // operator, while the video plays on everywhere else (main/media/cannot-play.ts). Not while this node's copy of the
  // file is still on its way: its landing tries it again.
  const tellMain = (sender: number, mediaId: unknown, startedAt: unknown, code: unknown, words: unknown) => {
    const screenId = manager.screenIdFor(sender);
    if (screenId === undefined || typeof mediaId !== 'string' || !MEDIA_ID_PATTERN.test(mediaId)) return null;
    if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null;
    if (typeof code !== 'number' || !Number.isInteger(code) || typeof words !== 'string') return null;
    if (!cache.has(mediaId)) return null;
    log.warn(
      `Node: a video could not play on ${outputNames.get(screenId) ?? 'a screen'} (code ${String(code)}): ${mediaId}; Main is told`,
    );
    client?.send({
      type: 'cannot-play',
      report: { screenId, mediaId, startedAt, code, words: cutText(words, 1000) },
    });
    return null;
  };
  handle(IPC.media.cannotPlay, (event, mediaId, startedAt, code, words) =>
    tellMain(event.sender.id, mediaId, startedAt, code, words),
  );
  handle(IPC.media.noPicture, (event, mediaId, startedAt) =>
    tellMain(event.sender.id, mediaId, startedAt, NO_PICTURE, ''),
  );
  // Another app's window as the background (Session 48) is on Main's computer: a node's screens never show
  // it, and keep the rest of the show.
  handle(IPC.liveWindow.ask, () => false);
  handle(IPC.liveWindow.ended, () => null);
  // So is a video input (Session 50): a camera on Main's computer. A node's session never gives a page a camera
  // (no camera rule: windows/security.ts), so its screens never show one, and keep the rest of the show.
  handle(IPC.videoInputs.list, () => ({ inputs: [] }));
  handle(IPC.videoInputs.access, () => 'denied' as const);
  handle(IPC.videoInputs.report, () => null);

  const resumeAfterQuitRefused = () => manager.cancelQuitting();
  const watchQuitRefusal = (window: BrowserWindow) => {
    window.on('close', (event) => onQuitRefused(event, resumeAfterQuitRefused));
    window.webContents.on('will-prevent-unload', (event) =>
      onQuitRefused(event, resumeAfterQuitRefused, true),
    );
  };
  for (const window of BrowserWindow.getAllWindows()) watchQuitRefusal(window);
  app.on('browser-window-created', (_event, window) => watchQuitRefusal(window));
  app.on('before-quit', (event) => {
    manager.quitting();
    onQuitRefused(event, resumeAfterQuitRefused);
  });

  nodeWindow = new BrowserWindow({
    width: 760,
    height: 700,
    minWidth: 560,
    minHeight: 520,
    show: false,
    title: 'Drashti Node',
    backgroundColor: deps.appearance.background(),
    autoHideMenuBar: true,
    ...windowIcon(),
    webPreferences: secureWebPreferences(),
  });
  deps.appearance.track(nodeWindow);
  deps.watchdog.watch(nodeWindow.webContents, 'node window');
  nodeWindow.once('ready-to-show', () => {
    nodeWindow?.show();
  });
  void loadPage(nodeWindow, 'node');
  nodeWindow.on('close', (event) => {
    const showing = manager.status().filter((st) => st.state === 'showing').length;
    if (showing === 0 || sw('DRASHTI_NO_QUIT_CONFIRM') === '1') return;
    const options = {
      type: 'warning' as const,
      buttons: ['Keep showing', 'Quit Drashti'],
      defaultId: 0,
      cancelId: 0,
      message: 'Quit Drashti?',
      detail: `${plural(showing, 'screen')} on this node ${showing === 1 ? 'is' : 'are'} showing. If Drashti quits, ${showing === 1 ? 'it goes' : 'they go'} black.`,
    };
    const choice = nodeWindow
      ? dialog.showMessageBoxSync(nodeWindow, options)
      : dialog.showMessageBoxSync(options);
    if (choice === 0) event.preventDefault();
  });
  nodeWindow.on('closed', () => {
    nodeWindow = null;
    // The node quits with its window: every output closes now and none opens again (QA24-QUITRACE-1). An output opened
    // once a quit had begun (a display change, Main's screens) is one Electron's quit never closes, and app.quit() again
    // does nothing while it quits: it would keep the node running.
    manager.closeForQuit();
    app.quit();
  });
  deps.atQuit('Main’s access', () => {
    mainAccess.dispose();
  });
  deps.atQuit('the link to Main', () => {
    if (healthTimer) clearInterval(healthTimer);
    if (thumbTimer) clearInterval(thumbTimer);
    healthTimer = null;
    client?.stop();
  });
  deps.atQuit('the last picture on disk', () => {
    saver.flush();
  });
  deps.atQuit('the media copies', () => cache.close());
  deps.atQuit('outputs', () => {
    manager.closeAll();
  });

  manager.reconcile();
  watchDisplays(() => {
    manager.reconcile();
    sendHealthNow();
  });
  // Globals the end-to-end tests read (the node's clock estimate and link), and its link dropped as a network
  // drop would (Sessions 31–36).
  (globalThis as { drashtiNode?: unknown }).drashtiNode = {
    view,
    health,
    engineNow,
    mirror: () => ({ rev: mirror.rev, session: mirror.session }),
    dropLink: () => client?.drop(),
  };
  if (!packaged() && sw('DRASHTI_TEST_NODE_LINK_HOLD') === '1') {
    Object.assign((globalThis as { drashtiNode?: unknown }).drashtiNode ?? {}, {
      pauseLink: () => {
        client?.stop();
        linkChanged('offline', 'The connection to Main was lost.');
      },
      resumeLink: connect,
    });
  }
  if (paired) connect();
  log.info(`Node: started${paired ? ` following Main “${paired.main.name}”` : ' (not paired yet)'}`);

  // ---- diagnostics (Session 17) ---------------------------------------------------------------------
  const saveDiagnostics = (period: LogPeriod) => {
    void (async () => {
      const crash = await deps.diagnostics.chooseCrashFiles().catch(() => null);
      if (crash) await writeDiagnostics(crash, period);
    })();
  };
  /** The node's diagnostics as they stand now, with the log of the period chosen (Save Diagnostics, and a report's). */
  const nodeDiagnosticsInput = (crash: CrashFilesChoice, period: LogPeriod): NodeDiagnosticsInput => {
    const status = manager.status();
    const now = new Date();
    const displays = listDisplays();
    return {
      app: deps.diagnostics.app(),
      displays,
      screens: (paired?.screens ?? []).map((s) => {
        const st = status.find((x) => x.screenId === s.screenId);
        const d = displays.find((x) => x.id === st?.displayId);
        const r = reports.get(s.screenId);
        return {
          name: s.name,
          groupName: s.groupName,
          role: s.role,
          canvasWidth: s.canvasWidth,
          canvasHeight: s.canvasHeight,
          scaling: s.scaling,
          enabled: s.enabled,
          state: st?.state ?? 'unknown',
          display: d ? d.label || `display ${String(d.id)}` : null,
          droppedFrames: r?.droppedFrames ?? 0,
          paintedRev: r?.paintedRev ?? -1,
        };
      }),
      main: paired
        ? {
            name: paired.main.name,
            addresses: paired.main.addresses,
            port: paired.main.port,
            pairedAt: paired.pairedAt,
          }
        : null,
      link,
      clock,
      rev: mirror.rev,
      fromSaved,
      media: cache.status(mirror.state ? inUse().filter((id) => !cache.has(id)).length : 0),
      watchdog: deps.diagnostics.watchdogHistory(),
      crashJournal: deps.diagnostics.crashJournal(),
      crashFiles: crash,
      logFiles: deps.diagnostics.logFilesOf(period, now.getTime()),
      now,
      // Who and what made it (alpha.21, logs (b)): a node has no entry of its own on the access list.
      who: {
        computer: deps.diagnostics.computer(),
        computerId: null,
        installId: deps.diagnostics.installId,
        grantId: null,
        role: null,
        made: 'node',
        main: paired?.main.name ?? null,
        period: periodText(period, now.getTime()),
      },
    };
  };
  const writeDiagnostics = async (crash: CrashFilesChoice, period: LogPeriod) => {
    try {
      const input = nodeDiagnosticsInput(crash, period);
      // Made by a report worker, off the node's own thread (a period's log can be days long), then written here.
      const made = await deps.diagnostics.makeText({ kind: 'diagnostics-text', main: null, node: input });
      if (!made.ok) throw new Error(made.message);
      const file = writeDiagnosticsFile(deps.diagnostics.desktop(), input.now, made.text, crash);
      log.info(
        `Node: diagnostics saved to the Desktop (the log of ${periodText(period, input.now.getTime())})${crash.included ? ', with the crash files' : ''}`,
      );
      say(deps.diagnostics.savedText(file, crash));
    } catch (error) {
      log.error('Node: could not save diagnostics', error);
      say('Could not save diagnostics: see the log in the data folder.');
    }
  };
  // ---- Help › Report a Problem… (x49, the owner's Q60-42, 2): handed to the Main this node follows --------
  const problemReports = new ReportService({
    dir: join(deps.userData, 'reports'),
    dbFile: '',
    client: () => Promise.resolve(null),
    grant: () => null,
    // Handed over only while the link to Main is up; kept here until then.
    letIn: () => paired !== null && client?.online === true,
    gmail: () => null,
    owner: () => false,
    from: () => 'node',
    onAir: () => false,
    crashFiles: () => deps.reports.crashFiles(),
    diagnostics: () => Promise.reject(new Error('A node has its own diagnostics.')),
    logDays: () => deps.diagnostics.logDays(),
    makeFiles: (job) => deps.reports.makeFiles(job),
    now: () => Date.now(),
    setTimer: (ms, run) => {
      const t = setTimeout(run, ms);
      return () => {
        clearTimeout(t);
      };
    },
    notice: say,
    changed: () => {
      if (pageAlive(nodeWindow)) sendToPage(nodeWindow, IPC.report.changed, { at: Date.now() });
    },
    log: (line) => {
      log.info(line);
    },
    ...(deps.reports.retryMs ? { retryMs: deps.reports.retryMs, startDelayMs: deps.reports.retryMs[0] } : {}),
    node: {
      self: () => ({ name: deps.computerName, version: deps.version, platform: process.platform }),
      main: () => paired?.main.name ?? null,
      handOver: (body, stop) =>
        paired && client
          ? postReportToMain(paired.main, client.host, paired.token, body, stop)
          : Promise.resolve(null),
      diagnostics: (crashIncluded, period) =>
        nodeDiagnosticsInput({ files: deps.reports.crashFiles(), included: crashIncluded }, period),
    },
  });
  deps.atQuit('reports', () => {
    problemReports.dispose();
  });
  problemReports.start();
  problemReportsWake = () => {
    problemReports.wake();
  };
  const fromNodeWindow = (event: { sender: { id: number } }) =>
    pageAlive(nodeWindow) && event.sender.id === nodeWindow.webContents.id;
  /** The node's window as it is now, before Report a Problem draws: its pixels and a small copy. */
  const captureNodeWindow = async (): Promise<HeldPicture | null> => {
    if (!pageAlive(nodeWindow)) return null;
    try {
      const image = await nodeWindow.webContents.capturePage();
      if (image.isEmpty()) return null;
      for (const scaleFactor of [...image.getScaleFactors(), 1]) {
        const { width, height } = image.getSize(scaleFactor);
        const pixels = image.toBitmap({ scaleFactor });
        if (width > 0 && height > 0 && pixels.length === width * height * 4)
          return {
            picture: {
              width,
              height,
              pixels: new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.length),
              order: capturedPixelOrder(),
            },
            thumb: `data:image/jpeg;base64,${image.resize({ width: 320, quality: 'good' }).toJPEG(70).toString('base64')}`,
          };
      }
      return null;
    } catch {
      return null;
    }
  };
  const notPaired = {
    ok: false as const,
    message: 'Report a Problem works once this node is paired with Main.',
  };
  // The Manual's features, read from the files beside the app.
  handle(IPC.manual.read, (e) =>
    fromNodeWindow(e)
      ? readManual(deps.reports.guides)
      : { ok: false, message: 'Only Drashti’s own window can read the manual.' },
  );
  handle(IPC.report.open, async (e) =>
    fromNodeWindow(e) && paired ? problemReports.opened(await captureNodeWindow()) : notPaired,
  );
  handle(IPC.report.close, (e) => {
    if (fromNodeWindow(e)) problemReports.closed();
    return true;
  });
  handle(IPC.report.prepare, (e, raw) => {
    const draft = readReportDraft(raw);
    return fromNodeWindow(e) && draft && paired ? problemReports.prepare(draft) : Promise.resolve(notPaired);
  });
  handle(IPC.report.discard, (e, id) => {
    if (fromNodeWindow(e) && isReportId(id)) problemReports.discard(id);
    return true;
  });
  handle(IPC.report.send, (e, id) =>
    fromNodeWindow(e) && isReportId(id) ? problemReports.send(id) : Promise.resolve(null),
  );
  handle(IPC.report.list, (e) => (fromNodeWindow(e) ? problemReports.list() : []));
  handle(IPC.report.forget, (e, id) => fromNodeWindow(e) && isReportId(id) && problemReports.forget(id));
  handle(IPC.report.copy, async (e, id) => {
    if (!fromNodeWindow(e) || !isReportId(id) || !pageAlive(nodeWindow))
      return { ok: false as const, cancelled: false as const, message: notPaired.message };
    const picked = await dialog.showOpenDialog(nodeWindow, {
      title: 'Save a Copy of the Report',
      defaultPath: deps.diagnostics.desktop(),
      buttonLabel: 'Save Here',
      properties: ['openDirectory', 'createDirectory'],
    });
    const into = picked.filePaths[0];
    if (picked.canceled || !into) return { ok: false as const, cancelled: true as const };
    const folder = problemReports.copy(id, into);
    return folder
      ? { ok: true as const, folder }
      : { ok: false as const, cancelled: false as const, message: 'That report is no longer kept here.' };
  });
  handle(IPC.report.showFile, async (e, id, name) => {
    const file =
      fromNodeWindow(e) && isReportId(id) && typeof name === 'string' && name.length <= 200
        ? problemReports.filePath(id, name)
        : null;
    if (!file) return false;
    if (!packaged() && sw('DRASHTI_TEST_REPORT_SHOW') === 'log') {
      log.info(`Report: would show ${basename(file)}`);
      return true;
    }
    return (await shell.openPath(file)) === '';
  });
  const showingOutputs = () => [...outputWindows.values()].filter((w) => !w.isDestroyed());
  return {
    holdUpdate: () => {
      updates.holdForNextQuit();
    },
    saveDiagnostics,
    reportProblem: () => {
      if (pageAlive(nodeWindow)) sendToPage(nodeWindow, IPC.app.showReport, { at: Date.now() });
    },
    runSelfTest: () =>
      runNodeWatchdogSelfTest({
        nodeWindow: () => (nodeWindow && !nodeWindow.isDestroyed() ? nodeWindow : null),
        outputs: showingOutputs,
        watchdog: deps.watchdog,
        rev: () => mirror.rev,
        online: () => client?.online ?? false,
      }),
    crashWindow: () => {
      nodeWindow?.webContents.forcefullyCrashRenderer();
    },
    crashOutputs: () => {
      for (const w of showingOutputs()) w.webContents.forcefullyCrashRenderer();
    },
    watchdogEvent: (e) => {
      const screenId = [...outputNames].find(([, n]) => n === e.window)?.[0];
      if (screenId === undefined) return;
      // A page loaded again gets its grace before it is judged; tried again, its restarts forgotten (a23-heartbeat).
      if (e.kind === 'reloaded' || e.kind === 'retried') heartbeat.opened(screenId);
      if (e.kind === 'retried') {
        heartbeat.afresh(screenId);
        // Tried again: no longer kept as it is (QA23-HEARTBEAT-1, A; review SA2).
        manager.setNotAnswering(screenId, false);
      }
      // Given up on: Stopped (Main's dashboard and its notice say so) until it draws again.
      if (e.kind === 'gave-up') stopOutput(screenId);
    },
    giveUp: (screenId) => {
      stopOutput(screenId);
    },
  };
}
