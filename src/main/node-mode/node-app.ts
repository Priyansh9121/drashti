import { app, BrowserWindow, dialog, net, protocol, shell } from 'electron';
import type { Installer } from '../update/installer';
import { UpdateService } from '../update/update-service';
import { basename, join } from 'node:path';
import { EngineMirror } from '../../shared/engine/mirror';
import type { EngineSnapshotMessage } from '../../shared/engine/protocol';
import { ENGINE_STATE_VERSION, initialEngineState } from '../../shared/engine/state';
import { IPC } from '../../shared/ipc';
import { MEDIA_SCHEME } from '../../shared/media';
import { mediaInState } from '../../shared/node-media';
import {
  DEFAULT_NODE_PORT,
  type LinkState,
  type MediaWant,
  type NodeClock,
  type NodeHealth,
  type NodeScreen,
  type NodeView,
  type NodeViewResult,
  type ToNode,
} from '../../shared/nodes';
import { mediaWantListSchema, nodeNameFrom, nodeScreenListSchema } from '../../shared/nodes-schema';
import type { DisplayInfo, OutputContext, OutputReport, ScreenConfig } from '../../shared/screens';
import type { DiagnosticsInput } from '../diagnostics';
import { saveNodeDiagnostics } from '../diagnostics';
import { handle } from '../ipc/handle';
import { log } from '../log';
import { handleMediaRequest, mediaRequestOf } from '../media/media-protocol';
import {
  createOutputWindow,
  listDisplays,
  showDisplayNumber,
  watchDisplays,
} from '../outputs/electron-outputs';
import { OutputManager } from '../outputs/output-manager';
import type { SleepGuard } from '../outputs/sleep-guard';
import type { SelfTestResult } from '../selftest';
import { runNodeWatchdogSelfTest } from '../selftest';
import { IpcTransport } from '../transport/ipc-transport';
import type { RendererWatchdog } from '../watchdog';
import { windowIcon } from '../windows/app-icon';
import { pageAlive, sendToPage } from '../windows/send';
import { loadPage } from '../windows/renderer';
import { secureWebPreferences } from '../windows/web-preferences';
import { LinkClient, openMediaFromMain, pairWithMain } from './link-client';
import { MediaCache } from './media-cache';
import { NodeStore, ShowSaver, type NodeFile } from './node-state';

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
  userData: string;
  version: string;
  /** Outputs as ordinary windows (development and tests). */
  windowed: boolean;
  watchdog: RendererWatchdog;
  sleepGuard: SleepGuard;
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
    logFiles: () => string[];
    desktop: () => string;
  };
}

/** What the node's menu can do (Session 17). */
export interface NodeAppHandle {
  saveDiagnostics: () => void;
  runSelfTest: () => Promise<SelfTestResult>;
  crashWindow: () => void;
  crashOutputs: () => void;
}

/** How often the node reports its health to Main. */
const HEALTH_EVERY_MS = 2000;

export function startNode(deps: NodeAppDeps): NodeAppHandle {
  const store = new NodeStore(deps.userData);
  let paired: NodeFile | null = store.read();
  const host = nodeNameFrom(deps.computerName);
  const localNow = () => Date.now() + deps.clockSkewMs;

  // ---- the show, as Main's feed brings it (or as it was last kept) --------------------------
  const mirror = new EngineMirror();
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
  const snapshot = (): EngineSnapshotMessage => ({
    kind: 'snapshot',
    version: ENGINE_STATE_VERSION,
    rev: mirror.rev,
    state: mirror.state ?? initialEngineState(),
    sentAt: engineNow(),
    ...(mirror.session !== undefined ? { session: mirror.session } : {}),
  });
  const transport = new IpcTransport((error, target) => {
    log.warn(`Node: could not send the show to window ${target.id}`, error);
  });
  const saver = new ShowSaver(store, (m) => {
    log.warn(`Node: ${m}`);
  });

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
    return [...m.now, ...m.next];
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
    },
    log: (level, message) => {
      if (level === 'warn') log.warn(`Node: ${message}`);
      else log.info(`Node: ${message}`);
    },
  });
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const asked = mediaRequestOf(request.url);
    // On the screens before its copy arrived: fetched at once, and the screen's request waits for it
    // (the picture before it stays up meanwhile) for as long as it is on the screens and can still
    // come. Requests for files already here never wait behind it.
    if (asked?.what === 'media' && !cache.has(asked.mediaId)) await cache.ensure(asked.mediaId);
    return handleMediaRequest(request, {
      mediaDir: cacheDir,
      lookup: (id) => {
        const path = cache.pathFor(id);
        return path ? { path: path.slice(cacheDir.length + 1), missing: false, sha256: null } : null;
      },
    });
  });

  // ---- outputs on the displays Main assigned ------------------------------------------------
  const outputWindows = new Map<string, BrowserWindow>();
  const reports = new Map<string, OutputReport>();
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
  });
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
      testCardUntil: null,
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
    };
  };
  const sendContexts = () => {
    for (const [screenId, win] of outputWindows) {
      const context = contextFor(screenId);
      if (context) sendToPage(win, IPC.output.context, context);
    }
  };
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
      deps.watchdog.watch(window.webContents, `output "${config.name}"`);
      window.on('closed', () => {
        if (outputWindows.get(config.id) === window) outputWindows.delete(config.id);
        reports.delete(config.id);
      });
      return h;
    },
    onChange: () => {
      sendContexts();
      deps.sleepGuard.update(manager.status().filter((st) => st.state === 'showing').length);
      viewChanged();
    },
  });

  // ---- health, pictures and orders from Main ----------------------------------------------------
  const health = (): NodeHealth => {
    const s = mirror.state;
    const missingNow = s ? inUse().filter((id) => !cache.has(id)).length : 0;
    return {
      version: deps.version,
      host,
      displays: listDisplays(),
      outputs: manager.status().flatMap((st) => {
        if (st.state !== 'showing' && st.state !== 'missing-display' && st.state !== 'disabled') return [];
        const r = reports.get(st.screenId);
        return [
          {
            screenId: st.screenId,
            state: st.state,
            displayId: st.displayId,
            droppedFrames: r?.droppedFrames ?? 0,
            paintedRev: r?.paintedRev ?? -1,
          },
        ];
      }),
      media: cache.status(missingNow),
      clock,
      rev: mirror.rev,
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
  const fromMain = (message: ToNode) => {
    switch (message.type) {
      case 'engine': {
        const result = mirror.apply(message.message);
        if (result === 'applied') {
          fromSaved = false;
          transport.broadcast(message.message);
          saver.update(snapshot(), offsetMs);
          cache.kick();
        } else if (result === 'resync') client?.send({ type: 'resync' });
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
          win.webContents.reload();
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
  const connect = () => {
    if (!paired) return;
    const pairing = paired;
    client?.stop();
    client = new LinkClient(
      pairing.main,
      pairing.token,
      deps.version,
      {
        state: (state, why) => {
          if (state !== link.state || why !== link.why) {
            link = { state, why, since: Date.now() };
            log.info(`Node: link ${state}${why ? ` (${why})` : ''}`);
          }
          if (state === 'online') cache.backOnline();
          viewChanged();
        },
        welcome: (main) => {
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
          if (Math.abs(offsetMs - before) > 1) sendContexts();
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
      mainVersion: link.state === 'refused' ? mainVersion : null,
      update: updates.view(),
      notice,
    };
  };

  handle(IPC.node.view, () => view());
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
  handle(IPC.engine.subscribe, (event) => {
    transport.add(event.sender);
    return snapshot();
  });
  handle(IPC.engine.snapshot, () => snapshot());
  handle(IPC.output.getContext, (event) => {
    const screenId = manager.screenIdFor(event.sender.id);
    return screenId ? contextFor(screenId) : null;
  });
  handle(IPC.output.report, (event, raw) => {
    const screenId = manager.screenIdFor(event.sender.id);
    const r = raw as Partial<OutputReport> | null;
    if (screenId && r && typeof r.droppedFrames === 'number' && typeof r.paintedRev === 'number')
      reports.set(screenId, { droppedFrames: r.droppedFrames, paintedRev: r.paintedRev });
    return null;
  });
  // A node keeps no lengths and no stills (the library is Main's).
  handle(IPC.media.reportLength, () => null);

  nodeWindow = new BrowserWindow({
    width: 760,
    height: 700,
    minWidth: 560,
    minHeight: 520,
    show: false,
    title: 'Drashti Node',
    backgroundColor: '#0b0d11',
    autoHideMenuBar: true,
    ...windowIcon(),
    webPreferences: secureWebPreferences(),
  });
  deps.watchdog.watch(nodeWindow.webContents, 'node window');
  nodeWindow.once('ready-to-show', () => {
    nodeWindow?.show();
  });
  void loadPage(nodeWindow, 'node');
  nodeWindow.on('close', (event) => {
    const showing = manager.status().filter((st) => st.state === 'showing').length;
    if (showing === 0 || process.env['DRASHTI_NO_QUIT_CONFIRM'] === '1') return;
    const options = {
      type: 'warning' as const,
      buttons: ['Keep showing', 'Quit Drashti'],
      defaultId: 0,
      cancelId: 0,
      message: 'Quit Drashti?',
      detail: `${showing} screen(s) on this node are showing. If Drashti quits, they go black.`,
    };
    const choice = nodeWindow
      ? dialog.showMessageBoxSync(nodeWindow, options)
      : dialog.showMessageBoxSync(options);
    if (choice === 0) event.preventDefault();
  });
  nodeWindow.on('closed', () => {
    nodeWindow = null;
    app.quit();
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
  // Globals the end-to-end tests read (the node's clock estimate and link).
  (globalThis as { drashtiNode?: unknown }).drashtiNode = {
    view,
    health,
    engineNow,
    mirror: () => ({ rev: mirror.rev, session: mirror.session }),
  };
  if (paired) connect();
  log.info(`Node: started${paired ? ` following Main “${paired.main.name}”` : ' (not paired yet)'}`);

  // ---- diagnostics (Session 17) ---------------------------------------------------------------------
  const saveDiagnostics = () => {
    try {
      const status = manager.status();
      const displays = listDisplays();
      const file = saveNodeDiagnostics(deps.diagnostics.desktop(), {
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
        logFiles: deps.diagnostics.logFiles(),
        now: new Date(),
      });
      log.info('Node: diagnostics saved to the Desktop');
      say(`Diagnostics saved on the Desktop: ${basename(file)}`);
    } catch (error) {
      log.error('Node: could not save diagnostics', error);
      say('Could not save diagnostics: see the log in the data folder.');
    }
  };
  const showingOutputs = () => [...outputWindows.values()].filter((w) => !w.isDestroyed());
  return {
    saveDiagnostics,
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
  };
}
