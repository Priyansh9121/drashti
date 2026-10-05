import { contextBridge, ipcRenderer, type IpcRendererEvent, webUtils } from 'electron';
import type { DrashtiBridge } from '../shared/bridge';
import type { EventChannel, EventContract, InvokeArgs, InvokeChannel, InvokeResult } from '../shared/ipc';
import { IPC } from '../shared/ipc';
import { summariesOf } from '../shared/library';
import { isAdminChannel } from '../shared/roles';

/** The page's way to ask for the admin PIN (roles, Session 14), once it has given one. */
let askAdmin: (() => Promise<boolean>) | null = null;

/**
 * Typed ipcRenderer.invoke over the shared contract. Before an admin
 * request, with roles on and admin locked, the page asks for the admin PIN
 * first; the request goes either way, and the main process decides.
 */
async function invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResult<C>> {
  const asker = askAdmin;
  if (asker && isAdminChannel(channel)) {
    try {
      if ((await ipcRenderer.invoke(IPC.roles.needsAdmin)) === true) await asker();
    } catch {
      // Asked and not answered: the main process refuses the request if admin is still locked.
    }
  }
  return (await ipcRenderer.invoke(channel, ...args)) as InvokeResult<C>;
}

/** Typed listener for a main -> renderer event; returns an unsubscribe function. */
function on<C extends EventChannel>(channel: C, listener: (payload: EventContract[C]) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: EventContract[C]) => {
    listener(payload);
  };
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

// Ports for the stream's preview and encoder go on to the page itself: MessagePorts cannot cross the
// context bridge, so they are posted into the page's own world (only this preload posts these).
// (The preload is type-checked without the DOM's types: the page's window is reached through globalThis.)
const pageWindow = globalThis as unknown as {
  postMessage(message: unknown, targetOrigin: string, transfer: readonly unknown[]): void;
};
ipcRenderer.on(IPC.stream.port, (event, payload: { role: 'preview' | 'encoder' }) => {
  pageWindow.postMessage({ drashtiStreamPort: payload.role }, '*', event.ports);
});

const bridge: DrashtiBridge = {
  app: {
    getInfo: () => invoke(IPC.app.getInfo),
    onUndo: (listener) =>
      on(IPC.app.undo, () => {
        listener();
      }),
    onRedo: (listener) =>
      on(IPC.app.redo, () => {
        listener();
      }),
    onNotice: (listener) =>
      on(IPC.app.notice, ({ text }) => {
        listener(text);
      }),
    recovery: () => invoke(IPC.app.recovery),
    dismissRecovery: () => invoke(IPC.app.dismissRecovery),
    startNotice: () => invoke(IPC.app.startNotice),
    onProgress: (listener) =>
      on(IPC.app.progress, ({ progress }) => {
        listener(progress);
      }),
    getMode: () => invoke(IPC.app.getMode),
    setMode: (mode, word) => invoke(IPC.app.setMode, mode, word),
    onModeChanged: (listener) =>
      on(IPC.app.modeChanged, ({ mode }) => {
        listener(mode);
      }),
    onAskLeaveSimple: (listener) =>
      on(IPC.app.askLeaveSimple, () => {
        listener();
      }),
  },
  backups: {
    view: () => invoke(IPC.backups.view),
    save: (schedule) => invoke(IPC.backups.save, schedule),
    pickFolder: () => invoke(IPC.backups.pickFolder),
    runNow: () => invoke(IPC.backups.runNow),
    dismiss: () => invoke(IPC.backups.dismiss),
    onChanged: (listener) => on(IPC.backups.changed, listener),
    onOpen: (listener) =>
      on(IPC.backups.open, () => {
        listener();
      }),
  },
  roles: {
    view: () => invoke(IPC.roles.view),
    unlock: (pin) => invoke(IPC.roles.unlock, pin),
    lock: () => invoke(IPC.roles.lock),
    setPins: (pins) => invoke(IPC.roles.setPins, pins),
    changePin: (change) => invoke(IPC.roles.changePin, change),
    turnOff: () => invoke(IPC.roles.turnOff),
    cancelAsk: () => invoke(IPC.roles.cancelAsk),
    onChanged: (listener) => on(IPC.roles.changed, listener),
    onAskAdmin: (listener) =>
      on(IPC.roles.askAdmin, ({ what }) => {
        listener(what);
      }),
    onOpen: (listener) =>
      on(IPC.roles.open, () => {
        listener();
      }),
    setAdminAsker: (asker) => {
      askAdmin = asker;
    },
  },
  files: {
    pathFor: (file) => webUtils.getPathForFile(file),
  },
  engine: {
    onMessage: (listener) => on(IPC.engine.message, listener),
    subscribe: () => invoke(IPC.engine.subscribe),
    snapshot: () => invoke(IPC.engine.snapshot),
    dispatch: (command) => invoke(IPC.engine.command, command),
  },
  library: {
    listPresentations: async () => summariesOf(await invoke(IPC.library.listPresentations)),
    listMedia: () => invoke(IPC.library.listMedia),
    search: (query) => invoke(IPC.library.search, query),
    words: (presentationId) => invoke(IPC.library.words, presentationId),
    saveWords: (presentationId, text) => invoke(IPC.library.saveWords, presentationId, text),
    newFromWords: (name, text) => invoke(IPC.library.newFromWords, name, text),
    restoreRevision: (revisionId) => invoke(IPC.library.restoreRevision, revisionId),
    legacyPresentations: () => invoke(IPC.library.legacyPresentations),
    getPresentation: (id) => invoke(IPC.library.getPresentation, id),
    slidesForEdit: (presentationId) => invoke(IPC.library.slidesForEdit, presentationId),
    saveSlides: (presentationId, doc, stamp, force = false) =>
      invoke(IPC.library.saveSlides, presentationId, doc, stamp, force),
    getDefaultTransition: () => invoke(IPC.library.getDefaultTransition),
    setDefaultTransition: (transition) => invoke(IPC.library.setDefaultTransition, transition),
    onChanged: (listener) =>
      on(IPC.library.changed, ({ what }) => {
        listener(what);
      }),
    importPaths: (paths, options) => invoke(IPC.library.importPaths, paths, options),
    cancelImport: (runId) => invoke(IPC.library.cancelImport, runId),
    onImportProgress: (listener) => on(IPC.library.importProgress, listener),
    listImportRuns: () => invoke(IPC.library.listImportRuns),
    getImportReport: (runId) => invoke(IPC.library.getImportReport, runId),
    pickImportPaths: (kind) => invoke(IPC.library.pickImportPaths, kind),
    relinkMedia: (mediaIds) => invoke(IPC.library.relinkMedia, mediaIds),
    setArrangement: (presentationId, arrangementId) =>
      invoke(IPC.library.setArrangement, presentationId, arrangementId),
    removePresentations: (ids) => invoke(IPC.library.removePresentations, ids),
    restorePresentations: (ids) => invoke(IPC.library.restorePresentations, ids),
  },
  kirtans: {
    tracks: (presentationId) => invoke(IPC.kirtans.tracks, presentationId),
    saveTracks: (presentationId, edits) => invoke(IPC.kirtans.saveTracks, presentationId, edits),
    setDetails: (presentationId, details) => invoke(IPC.kirtans.setDetails, presentationId, details),
    makeTransliteration: (presentationId, style, manual) =>
      invoke(IPC.kirtans.makeTransliteration, presentationId, style, manual),
    getTranslitStyle: () => invoke(IPC.kirtans.getTranslitStyle),
    categories: () => invoke(IPC.kirtans.categories),
    addCategory: (name) => invoke(IPC.kirtans.addCategory, name),
    setTranslitStyle: (style) => invoke(IPC.kirtans.setTranslitStyle, style),
  },
  playlists: {
    tree: () => invoke(IPC.playlists.tree),
    items: (playlistId) => invoke(IPC.playlists.items, playlistId),
    opened: (playlistId) => invoke(IPC.playlists.opened, playlistId),
    create: (name, parentId, isFolder) => invoke(IPC.playlists.create, name, parentId, isFolder),
    rename: (playlistId, name) => invoke(IPC.playlists.rename, playlistId, name),
    remove: (ids) => invoke(IPC.playlists.remove, ids),
    restore: (ids) => invoke(IPC.playlists.restore, ids),
    addItems: (playlistId, at, items) => invoke(IPC.playlists.addItems, playlistId, at, items),
    moveItems: (playlistId, ids, to) => invoke(IPC.playlists.moveItems, playlistId, ids, to),
    removeItems: (ids) => invoke(IPC.playlists.removeItems, ids),
    restoreItems: (ids) => invoke(IPC.playlists.restoreItems, ids),
    fillPlaceholder: (itemId, presentationId) =>
      invoke(IPC.playlists.fillPlaceholder, itemId, presentationId),
    setItemOrder: (itemId, order) => invoke(IPC.playlists.setItemOrder, itemId, order),
    renameHeader: (itemId, label) => invoke(IPC.playlists.renameHeader, itemId, label),
    templates: () => invoke(IPC.playlists.templates),
    saveAsTemplate: (playlistId, request) => invoke(IPC.playlists.saveAsTemplate, playlistId, request),
    newFromTemplate: (templateId, name, parentId) =>
      invoke(IPC.playlists.newFromTemplate, templateId, name, parentId),
    addSlot: (playlistId, at, slot) => invoke(IPC.playlists.addSlot, playlistId, at, slot),
    editSlot: (itemId, slot) => invoke(IPC.playlists.editSlot, itemId, slot),
    setTimers: (itemId, cues) => invoke(IPC.playlists.setTimers, itemId, cues),
    onChanged: (listener) =>
      on(IPC.playlists.changed, () => {
        listener();
      }),
  },
  props: {
    list: () => invoke(IPC.props.list),
    save: (propId, fields) => invoke(IPC.props.save, propId, fields),
    remove: (propId) => invoke(IPC.props.remove, propId),
    getLogo: () => invoke(IPC.props.getLogo),
    setLogo: (propId) => invoke(IPC.props.setLogo, propId),
  },
  themes: {
    list: () => invoke(IPC.themes.list),
    save: (themeId, fields) => invoke(IPC.themes.save, themeId, fields),
    remove: (themeId) => invoke(IPC.themes.remove, themeId),
    apply: (themeId, presentationIds) => invoke(IPC.themes.apply, themeId, presentationIds),
    fromPresentation: (presentationId) => invoke(IPC.themes.fromPresentation, presentationId),
    fromSlide: (name, slide) => invoke(IPC.themes.fromSlide, name, slide),
  },
  messages: {
    list: () => invoke(IPC.messages.list),
    create: (template) => invoke(IPC.messages.create, template),
    update: (templateId, template) => invoke(IPC.messages.update, templateId, template),
    remove: (templateId) => invoke(IPC.messages.remove, templateId),
  },
  timers: {
    create: (fields) => invoke(IPC.timers.create, fields),
    update: (timerId, fields) => invoke(IPC.timers.update, timerId, fields),
    remove: (timerId) => invoke(IPC.timers.remove, timerId),
  },
  media: {
    saveStill: (mediaId, jpeg) => invoke(IPC.media.saveStill, mediaId, jpeg),
    convert: (mediaIds) => invoke(IPC.media.convert, mediaIds),
    cancelConversion: (jobId) => invoke(IPC.media.cancelConversion, jobId),
    conversions: () => invoke(IPC.media.conversions),
    onConversions: (listener) => on(IPC.media.conversionsChanged, listener),
    undoConversion: (conversionId) => invoke(IPC.media.undoConversion, conversionId),
    reportLength: (mediaId, durationMs) => invoke(IPC.media.reportLength, mediaId, durationMs),
  },
  audio: {
    getOutput: () => invoke(IPC.audio.getOutput),
    setOutput: (device) => invoke(IPC.audio.setOutput, device),
    onStatus: (listener) => on(IPC.audio.status, listener),
    reportDevices: (devices, state) => invoke(IPC.audio.reportDevices, devices, state),
    onChosen: (listener) =>
      on(IPC.audio.chosen, (payload) => {
        listener(payload.device);
      }),
    onTestTone: (listener) =>
      on(IPC.audio.testTone, (payload) => {
        listener(payload.deviceId);
      }),
  },
  network: {
    status: () => invoke(IPC.network.status),
    onChanged: (listener) => on(IPC.network.changed, listener),
    setOn: (on) => invoke(IPC.network.setOn, on),
    setPort: (port) => invoke(IPC.network.setPort, port),
    startPairing: (kind, name) => invoke(IPC.network.startPairing, kind, name),
    cancelPairing: () => invoke(IPC.network.cancelPairing),
    renameDevice: (deviceId, name) => invoke(IPC.network.renameDevice, deviceId, name),
    revokeDevice: (deviceId) => invoke(IPC.network.revokeDevice, deviceId),
    makePoster: () => invoke(IPC.network.makePoster),
  },
  nodes: {
    status: () => invoke(IPC.nodes.status),
    onChanged: (listener) => on(IPC.nodes.changed, listener),
    onThumbs: (listener) => on(IPC.nodes.thumbs, listener),
    startPairing: () => invoke(IPC.nodes.startPairing),
    cancelPairing: () => invoke(IPC.nodes.cancelPairing),
    rename: (nodeId, name) => invoke(IPC.nodes.rename, nodeId, name),
    remove: (nodeId) => invoke(IPC.nodes.remove, nodeId),
    everything: (nodeId, on) => invoke(IPC.nodes.everything, nodeId, on),
    reload: (nodeId, screenId) => invoke(IPC.nodes.reload, nodeId, screenId),
    identify: (nodeId, displayId) => invoke(IPC.nodes.identify, nodeId, displayId),
    watch: (watching) => invoke(IPC.nodes.watch, watching),
  },
  node: {
    view: () => invoke(IPC.node.view),
    onChanged: (listener) => on(IPC.node.changed, listener),
    pair: (address, code) => invoke(IPC.node.pair, address, code),
    unpair: () => invoke(IPC.node.unpair),
    useAsMain: () => invoke(IPC.node.useAsMain),
    identify: () => invoke(IPC.node.identify),
  },
  announcements: {
    list: () => invoke(IPC.announcements.list),
    onChanged: (listener) => on(IPC.announcements.changed, listener),
    edit: (edit) => invoke(IPC.announcements.edit, edit),
    approve: (approval) => invoke(IPC.announcements.approve, approval),
    reject: (which) => invoke(IPC.announcements.reject, which),
    takeOff: (which) => invoke(IPC.announcements.takeOff, which),
  },
  stream: {
    status: () => invoke(IPC.stream.status),
    onChanged: (listener) => on(IPC.stream.changed, listener),
    setLayout: (layout) => invoke(IPC.stream.setLayout, layout),
    watchPreview: (watch) => invoke(IPC.stream.watchPreview, watch),
    profiles: () => invoke(IPC.stream.profiles),
    saveProfile: (id, input) => invoke(IPC.stream.saveProfile, id, input),
    removeProfile: (id) => invoke(IPC.stream.removeProfile, id),
    useProfile: (id) => invoke(IPC.stream.useProfile, id),
    setKey: (id, key) => invoke(IPC.stream.setKey, id, key),
    removeKey: (id) => invoke(IPC.stream.removeKey, id),
    goLive: (confirm) => invoke(IPC.stream.goLive, confirm),
    end: (confirm) => invoke(IPC.stream.end, confirm),
    startRecording: () => invoke(IPC.stream.startRecording),
    stopRecording: () => invoke(IPC.stream.stopRecording),
    pickFolder: () => invoke(IPC.stream.pickFolder),
    dismissResume: () => invoke(IPC.stream.dismissResume),
    page: {
      context: () => invoke(IPC.stream.pageContext),
      onContext: (listener) => on(IPC.stream.context, listener),
      reportInputs: (inputs) => invoke(IPC.stream.pageInputs, inputs),
    },
  },
  setup: {
    state: () => invoke(IPC.setup.state),
    setSeen: () => invoke(IPC.setup.setSeen),
    identifyDisplays: () => invoke(IPC.setup.identifyDisplays),
    testTone: (device) => invoke(IPC.setup.testTone, device),
    finish: (plan, options) => invoke(IPC.setup.finish, plan, options),
    onOpen: (listener) =>
      on(IPC.setup.open, () => {
        listener();
      }),
  },
  macros: {
    list: () => invoke(IPC.macros.list),
    onChanged: (listener) => on(IPC.macros.changed, listener),
    save: (macroId, macro) => invoke(IPC.macros.save, macroId, macro),
    remove: (macroId) => invoke(IPC.macros.remove, macroId),
    run: (macroId) => invoke(IPC.macros.run, macroId),
  },
  midi: {
    get: () => invoke(IPC.midi.get),
    set: (settings) => invoke(IPC.midi.set, settings),
  },
  masks: {
    list: () => invoke(IPC.masks.list),
    onChanged: (listener) => on(IPC.masks.changed, listener),
    save: (maskId, mask) => invoke(IPC.masks.save, maskId, mask),
    remove: (maskId) => invoke(IPC.masks.remove, maskId),
  },
  idle: {
    view: () => invoke(IPC.idle.view),
    onChanged: (listener) => on(IPC.idle.changed, listener),
    saveSettings: (settings) => invoke(IPC.idle.saveSettings, settings),
    saveQuote: (quoteId, quote) => invoke(IPC.idle.saveQuote, quoteId, quote),
    removeQuote: (quoteId) => invoke(IPC.idle.removeQuote, quoteId),
  },
  calendar: {
    view: () => invoke(IPC.calendar.view),
    onChanged: (listener) => on(IPC.calendar.changed, listener),
    remove: (calendarId) => invoke(IPC.calendar.remove, calendarId),
  },
  arti: {
    view: () => invoke(IPC.arti.view),
    onChanged: (listener) => on(IPC.arti.changed, listener),
    save: (scheduleId, fields) => invoke(IPC.arti.save, scheduleId, fields),
    setEnabled: (scheduleId, enabled) => invoke(IPC.arti.setEnabled, scheduleId, enabled),
    remove: (scheduleId) => invoke(IPC.arti.remove, scheduleId),
    putUp: (key) => invoke(IPC.arti.putUp, key),
    notNow: (key) => invoke(IPC.arti.notNow, key),
    cancel: (key) => invoke(IPC.arti.cancel, key),
  },
  shastra: {
    list: () => invoke(IPC.shastra.list),
    tree: (textId) => invoke(IPC.shastra.tree, textId),
    resolve: (reference) => invoke(IPC.shastra.resolve, reference),
    search: (query) => invoke(IPC.shastra.search, query),
    passage: (passageId) => invoke(IPC.shastra.passage, passageId),
    itemPassage: (itemId) => invoke(IPC.shastra.itemPassage, itemId),
    setTheme: (textId, themeId) => invoke(IPC.shastra.setTheme, textId, themeId),
    remove: (textId) => invoke(IPC.shastra.remove, textId),
  },
  stageLayouts: {
    list: () => invoke(IPC.stageLayouts.list),
    onChanged: (listener) => on(IPC.stageLayouts.changed, listener),
    save: (layoutId, layout) => invoke(IPC.stageLayouts.save, layoutId, layout),
    remove: (layoutId) => invoke(IPC.stageLayouts.remove, layoutId),
  },
  looks: {
    list: () => invoke(IPC.looks.list),
    onChanged: (listener) => on(IPC.looks.changed, listener),
    create: (name, copyOf) => invoke(IPC.looks.create, name, copyOf),
    rename: (lookId, name) => invoke(IPC.looks.rename, lookId, name),
    remove: (lookId) => invoke(IPC.looks.remove, lookId),
    move: (lookId, to) => invoke(IPC.looks.move, lookId, to),
    setGroup: (lookId, groupId, patch) => invoke(IPC.looks.setGroup, lookId, groupId, patch),
  },
  screens: {
    get: () => invoke(IPC.screens.get),
    onChanged: (listener) => on(IPC.screens.changed, listener),
    createGroup: (name) => invoke(IPC.screens.createGroup, name),
    renameGroup: (groupId, name) => invoke(IPC.screens.renameGroup, groupId, name),
    setGroupRole: (groupId, role) => invoke(IPC.screens.setGroupRole, groupId, role),
    setGroupLanguages: (groupId, languages) => invoke(IPC.screens.setGroupLanguages, groupId, languages),
    deleteGroup: (groupId) => invoke(IPC.screens.deleteGroup, groupId),
    assignDisplay: (groupId, displayId, options) =>
      invoke(IPC.screens.assignDisplay, groupId, displayId, options),
    updateScreen: (screenId, patch, options) => invoke(IPC.screens.updateScreen, screenId, patch, options),
    removeScreen: (screenId) => invoke(IPC.screens.removeScreen, screenId),
    assignNodeDisplay: (groupId, nodeId, displayId) =>
      invoke(IPC.screens.assignNodeDisplay, groupId, nodeId, displayId),
    identify: () => invoke(IPC.screens.identify),
    uncoverOperator: () => invoke(IPC.screens.uncoverOperator),
  },
  output: {
    getContext: () => invoke(IPC.output.getContext),
    onContext: (listener) => on(IPC.output.context, listener),
    onIdentify: (listener) => on(IPC.output.identify, listener),
    report: (report) => invoke(IPC.output.report, report),
    onMediaReady: (listener) =>
      on(IPC.output.mediaReady, ({ mediaId }) => {
        listener(mediaId);
      }),
  },
};

contextBridge.exposeInMainWorld('drashti', bridge);
