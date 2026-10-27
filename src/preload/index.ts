import { contextBridge, ipcRenderer, type IpcRendererEvent, webUtils } from 'electron';
import type { DrashtiBridge } from '../shared/bridge';
import type { EventChannel, EventContract, InvokeArgs, InvokeChannel, InvokeResult } from '../shared/ipc';
import type { AppearanceNow } from '../shared/appearance/appearances';
import { drawAppearance, type AppearanceRoot } from '../shared/appearance/draw';
import { IPC } from '../shared/ipc';
import { summariesOf } from '../shared/library';
import { bridgeFor, pageOf } from './page-groups';

/** Typed ipcRenderer.invoke over the shared contract. */
function invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResult<C>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<InvokeResult<C>>;
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
    renderError: (report) => invoke(IPC.app.renderError, report),
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
    simpleFirstRun: () => invoke(IPC.app.simpleFirstRun),
    simpleFirstRunSeen: () => invoke(IPC.app.simpleFirstRunSeen),
    safeAreas: () => invoke(IPC.app.safeAreas),
    onSafeAreasChanged: (listener) =>
      on(IPC.app.safeAreasChanged, ({ on: shown }) => {
        listener(shown);
      }),
    singleKeys: () => invoke(IPC.app.singleKeys),
    setSingleKeys: (keys) => invoke(IPC.app.setSingleKeys, keys),
    onSingleKeysChanged: (listener) =>
      on(IPC.app.singleKeysChanged, ({ on: keys }) => {
        listener(keys);
      }),
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
    onShowKeys: (listener) =>
      on(IPC.app.showKeys, () => {
        listener();
      }),
    onShowGuides: (listener) =>
      on(IPC.app.showGuides, () => {
        listener();
      }),
  },
  guides: {
    list: () => invoke(IPC.guides.list),
    read: (id) => invoke(IPC.guides.read, id),
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
  events: {
    view: () => invoke(IPC.events.view),
    add: (url, allowInternet) => invoke(IPC.events.add, url, allowInternet),
    update: (id, patch) => invoke(IPC.events.update, id, patch),
    remove: (id) => invoke(IPC.events.remove, id),
    rotate: (id) => invoke(IPC.events.rotate, id),
    test: (id) => invoke(IPC.events.test, id),
    onChanged: (listener) => on(IPC.events.changed, listener),
    onOpen: (listener) =>
      on(IPC.events.open, () => {
        listener();
      }),
  },
  drop: {
    view: () => invoke(IPC.drop.view),
    pickFolder: () => invoke(IPC.drop.pickFolder),
    setOn: (on) => invoke(IPC.drop.setOn, on),
    importAnyway: (name) => invoke(IPC.drop.importAnyway, name),
    onChanged: (listener) => on(IPC.drop.changed, listener),
    onOpen: (listener) =>
      on(IPC.drop.open, () => {
        listener();
      }),
  },
  music: {
    view: () => invoke(IPC.music.view),
    create: (name) => invoke(IPC.music.create, name),
    rename: (playlistId, name) => invoke(IPC.music.rename, playlistId, name),
    remove: (playlistId) => invoke(IPC.music.remove, playlistId),
    setOptions: (playlistId, options) => invoke(IPC.music.setOptions, playlistId, options),
    addTracks: (playlistId, mediaIds, at) => invoke(IPC.music.addTracks, playlistId, mediaIds, at),
    moveTrack: (trackId, to) => invoke(IPC.music.moveTrack, trackId, to),
    removeTrack: (trackId) => invoke(IPC.music.removeTrack, trackId),
    restore: (playlistId) => invoke(IPC.music.restore, playlistId),
    restoreTrack: (trackId, at) => invoke(IPC.music.restoreTrack, trackId, at),
    play: (playlistId, trackIndex) => invoke(IPC.music.play, playlistId, trackIndex),
    onChanged: (listener) => on(IPC.music.changed, listener),
  },
  updates: {
    view: () => invoke(IPC.updates.view),
    check: () => invoke(IPC.updates.check),
    download: () => invoke(IPC.updates.download),
    cancel: () => invoke(IPC.updates.cancel),
    setInstallOnQuit: (on) => invoke(IPC.updates.setInstallOnQuit, on),
    setAutoCheck: (on) => invoke(IPC.updates.setAutoCheck, on),
    showFile: () => invoke(IPC.updates.showFile),
    onChanged: (listener) => on(IPC.updates.changed, listener),
    onOpen: (listener) =>
      on(IPC.updates.open, () => {
        listener();
      }),
  },
  links: {
    view: () => invoke(IPC.links.view),
    look: (kind, link) => invoke(IPC.links.look, kind, link),
    pickFolder: () => invoke(IPC.links.pickFolder),
    download: (choice) => invoke(IPC.links.download, choice ?? null),
    stop: () => invoke(IPC.links.stop),
    reset: () => invoke(IPC.links.reset),
    addWaiting: () => invoke(IPC.links.addWaiting),
    showSaved: (runId) => invoke(IPC.links.showSaved, runId),
    setMaxHeight: (height) => invoke(IPC.links.setMaxHeight, height),
    setPlaylist: (playlistId) => invoke(IPC.links.setPlaylist, playlistId),
    onChanged: (listener) => on(IPC.links.changed, listener),
    onOpen: (listener) =>
      on(IPC.links.open, () => {
        listener();
      }),
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
    extras: () => invoke(IPC.library.extras),
    setExtras: (on) => invoke(IPC.library.setExtras, on),
    onExtrasChanged: (listener) =>
      on(IPC.library.extrasChanged, ({ on: shown }) => {
        listener(shown);
      }),
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
    firstSlides: (presentationIds) => invoke(IPC.playlists.firstSlides, presentationIds),
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
    smartViews: () => invoke(IPC.playlists.smartViews),
    createSmart: () => invoke(IPC.playlists.createSmart),
    removeMissing: (playlistId) => invoke(IPC.playlists.removeMissing, playlistId),
    createRepeat: (parentId) => invoke(IPC.playlists.createRepeat, parentId),
    setRepeat: (playlistId, settings) => invoke(IPC.playlists.setRepeat, playlistId, settings),
    share: (playlistId, on) => invoke(IPC.playlists.share, playlistId, on),
    onChanged: (listener) =>
      on(IPC.playlists.changed, () => {
        listener();
      }),
    onSmartChanged: (listener) => on(IPC.playlists.smartChanged, listener),
  },
  props: {
    list: () => invoke(IPC.props.list),
    save: (propId, fields) => invoke(IPC.props.save, propId, fields),
    remove: (propId) => invoke(IPC.props.remove, propId),
    getLogo: () => invoke(IPC.props.getLogo),
    setLogo: (propId) => invoke(IPC.props.setLogo, propId),
  },
  appearance: {
    view: () => invoke(IPC.appearance.view),
    choose: (choice) => invoke(IPC.appearance.choose, choice),
    make: (fields) => invoke(IPC.appearance.make, fields),
    remove: (id) => invoke(IPC.appearance.remove, id),
    setMotion: (motion) => invoke(IPC.appearance.setMotion, motion),
    onOpen: (listener) =>
      on(IPC.appearance.open, () => {
        listener();
      }),
    onChanged: (listener) =>
      on(IPC.appearance.changed, () => {
        listener();
      }),
  },
  themes: {
    list: () => invoke(IPC.themes.list),
    save: (themeId, fields) => invoke(IPC.themes.save, themeId, fields),
    remove: (themeId) => invoke(IPC.themes.remove, themeId),
    setDefault: (themeId) => invoke(IPC.themes.setDefault, themeId),
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
    keyframe: (mediaId, startMs) => invoke(IPC.media.keyframe, mediaId, startMs),
    saveTrim: (request) => invoke(IPC.media.saveTrim, request),
    saves: () => invoke(IPC.media.saves),
    onSaves: (listener) => on(IPC.media.savesChanged, listener),
    stopSave: (jobId) => invoke(IPC.media.stopSave, jobId),
    showSave: (jobId) => invoke(IPC.media.showSave, jobId),
    look: (mediaId) => invoke(IPC.media.look, mediaId),
    looks: () => invoke(IPC.media.looks),
    setLook: (mediaId, look) => invoke(IPC.media.setLook, mediaId, look),
    keepLiveZoom: () => invoke(IPC.media.keepLiveZoom),
    onLooks: (listener) => on(IPC.media.looksChanged, listener),
    usage: (mediaIds) => invoke(IPC.media.usage, mediaIds),
    remove: (mediaIds) => invoke(IPC.media.remove, mediaIds),
    restore: (mediaIds) => invoke(IPC.media.restore, mediaIds),
    reportLength: (mediaId, durationMs) => invoke(IPC.media.reportLength, mediaId, durationMs),
    markers: (mediaId) => invoke(IPC.media.markers, mediaId),
    setMarkers: (mediaId, markers) => invoke(IPC.media.setMarkers, mediaId, markers),
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
    setAddFiles: (on) => invoke(IPC.network.setAddFiles, on),
  },
  nodes: {
    status: () => invoke(IPC.nodes.status),
    onChanged: (listener) => on(IPC.nodes.changed, listener),
    onThumbs: (listener) => on(IPC.nodes.thumbs, listener),
    startPairing: () => invoke(IPC.nodes.startPairing),
    cancelPairing: () => invoke(IPC.nodes.cancelPairing),
    rename: (nodeId, name) => invoke(IPC.nodes.rename, nodeId, name),
    remove: (nodeId) => invoke(IPC.nodes.remove, nodeId),
    newIdentity: () => invoke(IPC.nodes.newIdentity),
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
    updateCheck: () => invoke(IPC.node.updateCheck),
    updateDownload: () => invoke(IPC.node.updateDownload),
    updateInstall: () => invoke(IPC.node.updateInstall),
    updateShowFile: () => invoke(IPC.node.updateShowFile),
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
    setInputs: (camera, sound) => invoke(IPC.stream.setInputs, camera, sound),
    removeProfile: (id) => invoke(IPC.stream.removeProfile, id),
    useProfile: (id) => invoke(IPC.stream.useProfile, id),
    setKey: (id, key, place) => invoke(IPC.stream.setKey, id, key, place),
    removeKey: (id, place) => invoke(IPC.stream.removeKey, id, place),
    goLive: (confirm) => invoke(IPC.stream.goLive, confirm),
    end: (confirm) => invoke(IPC.stream.end, confirm),
    startRecording: () => invoke(IPC.stream.startRecording),
    stopRecording: () => invoke(IPC.stream.stopRecording),
    pickFolder: () => invoke(IPC.stream.pickFolder),
    dismissResume: () => invoke(IPC.stream.dismissResume),
    tryAgain: () => invoke(IPC.stream.tryAgain),
    page: {
      context: () => invoke(IPC.stream.pageContext),
      onContext: (listener) => on(IPC.stream.context, listener),
      reportInputs: (inputs) => invoke(IPC.stream.pageInputs, inputs),
    },
  },
  liveWindow: {
    list: () => invoke(IPC.liveWindow.list),
    show: (id) => invoke(IPC.liveWindow.show, id),
    access: () => invoke(IPC.liveWindow.access),
    status: () => invoke(IPC.liveWindow.status),
    onChanged: (listener) => on(IPC.liveWindow.changed, listener),
    ask: (sourceId) => invoke(IPC.liveWindow.ask, sourceId),
    ended: (sourceId) => invoke(IPC.liveWindow.ended, sourceId),
  },
  videoInputs: {
    list: () => invoke(IPC.videoInputs.list),
    onChanged: (listener) => on(IPC.videoInputs.changed, listener),
    add: (fields) => invoke(IPC.videoInputs.add, fields),
    update: (id, fields) => invoke(IPC.videoInputs.update, id, fields),
    remove: (id) => invoke(IPC.videoInputs.remove, id),
    access: () => invoke(IPC.videoInputs.access),
    askAccess: () => invoke(IPC.videoInputs.askAccess),
    openSettings: () => invoke(IPC.videoInputs.openSettings),
    report: (report) => invoke(IPC.videoInputs.report, report),
    status: () => invoke(IPC.videoInputs.status),
    onStatus: (listener) => on(IPC.videoInputs.statusChanged, listener),
  },
  pip: {
    place: () => invoke(IPC.pip.place),
    savePlace: (place) => invoke(IPC.pip.savePlace, place),
  },
  zoom: {
    open: () => invoke(IPC.zoom.open),
    program: () => invoke(IPC.zoom.program),
    onProgram: (listener) => on(IPC.zoom.programChanged, listener),
  },
  setup: {
    state: () => invoke(IPC.setup.state),
    setSeen: () => invoke(IPC.setup.setSeen),
    welcomeSeen: () => invoke(IPC.setup.welcomeSeen),
    identifyDisplays: () => invoke(IPC.setup.identifyDisplays),
    testTone: (device) => invoke(IPC.setup.testTone, device),
    finish: (plan, options) => invoke(IPC.setup.finish, plan, options),
    onOpen: (listener) =>
      on(IPC.setup.open, () => {
        listener();
      }),
  },
  lowerThirds: {
    list: () => invoke(IPC.lowerThirds.list),
    onChanged: (listener) => on(IPC.lowerThirds.changed, listener),
    save: (id, input) => invoke(IPC.lowerThirds.save, id, input),
    remove: (ids) => invoke(IPC.lowerThirds.remove, ids),
    restore: (ids) => invoke(IPC.lowerThirds.restore, ids),
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
    tryAgain: (screenId) => invoke(IPC.screens.tryAgain, screenId),
    pending: () => invoke(IPC.screens.pending),
    onPending: (listener) => on(IPC.screens.pendingChanged, listener),
    keep: () => invoke(IPC.screens.keep),
    goBack: () => invoke(IPC.screens.goBack),
  },
  screenSwitches: {
    get: () => invoke(IPC.screenSwitches.get),
    onChanged: (listener) => on(IPC.screenSwitches.changed, listener),
    turn: (which, isOn) => invoke(IPC.screenSwitches.turn, which, isOn),
    asking: (which) => invoke(IPC.screenSwitches.asking, which),
    onCovered: (listener) =>
      on(IPC.screenSwitches.covered, ({ covered }) => {
        listener(covered);
      }),
    onAnswered: (listener) =>
      on(IPC.screenSwitches.answered, ({ yes }) => {
        listener(yes);
      }),
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
    onGpuRestarted: (listener) =>
      on(IPC.output.gpuRestarted, () => {
        listener();
      }),
    onTestThrow: (listener) =>
      on(IPC.output.testThrow, () => {
        listener();
      }),
    onTestClock: (listener) =>
      on(IPC.output.testClock, ({ at }) => {
        listener(at);
      }),
    onKeepQuestion: (listener) => on(IPC.output.keepQuestion, listener),
    keepAnswer: (keep) => invoke(IPC.output.keepAnswer, keep),
    onSwitchQuestion: (listener) =>
      on(IPC.output.switchQuestion, ({ which }) => {
        listener(which);
      }),
    switchAnswer: (yes) => invoke(IPC.output.switchAnswer, yes),
  },
  pictures: {
    job: () => invoke(IPC.pictures.job),
    page: (page) => invoke(IPC.pictures.page, page),
    done: (done) => invoke(IPC.pictures.done, done),
    asset: (kind, name) => invoke(IPC.pictures.asset, kind, name),
  },
  sharpen: {
    next: () => invoke(IPC.sharpen.next),
    made: (key, bytes) => invoke(IPC.sharpen.made, key, bytes),
  },
};

// Each page gets only its own groups of the bridge (Sessions 31–36, ARCH-7; page-groups.ts), known by its address.
const here = (globalThis as { location?: { href: string } }).location?.href ?? '';
contextBridge.exposeInMainWorld('drashti', bridgeFor(bridge, pageOf(here)));

/*
 * Drashti's own windows draw in their appearance from the start (Sessions 39–40): asked for at once, and set on
 * <html> the moment the page's parser makes it (a preload runs before there is one), before anything is drawn,
 * so no frame shows another colour; then every change, at once. The audience screens, the stream's page and
 * the stage display never take one (body.output keeps its own colours).
 */
const OWN_WINDOWS: readonly (string | null)[] = ['index', 'gallery', 'node'];
/** The page's document and MutationObserver, as far as this needs them (the preload has no DOM types). */
const dom = globalThis as unknown as {
  document: { documentElement: AppearanceRoot | null };
  MutationObserver: new (seen: () => void) => {
    observe(target: unknown, options: { childList: boolean }): void;
    disconnect(): void;
  };
};
if (OWN_WINDOWS.includes(pageOf(here))) {
  let now: AppearanceNow | null = null;
  try {
    now = ipcRenderer.sendSync(IPC.appearance.now) as AppearanceNow | null;
  } catch {
    // Unanswered: the page draws in app.css's own tokens (Black's) until the next change.
  }
  const draw = (next: AppearanceNow) => {
    const root = dom.document.documentElement;
    if (root) drawAppearance(root, next);
  };
  if (now) {
    const first = now;
    if (dom.document.documentElement) draw(first);
    else {
      const made = new dom.MutationObserver(() => {
        if (!dom.document.documentElement) return;
        made.disconnect();
        draw(first);
      });
      made.observe(dom.document, { childList: true });
    }
  }
  // Lively (Session 40): one appearance to the next in a short cross-fade of the whole window, never while the
  // show is changing (a change in the last 800 ms, or one arriving during it, which ends it at once).
  let showChangedAt = 0;
  let fading: { skipTransition(): void } | null = null;
  ipcRenderer.on(IPC.engine.message, () => {
    showChangedAt = Date.now();
    fading?.skipTransition();
  });
  let drawn = now;
  ipcRenderer.on(IPC.appearance.changed, (_event, next: AppearanceNow) => {
    const doc = dom.document as unknown as {
      startViewTransition?: (change: () => void) => { skipTransition(): void; finished: Promise<void> };
    };
    const looksOtherwise = drawn !== null && (drawn.id !== next.id || drawn.base !== next.base);
    drawn = next;
    const quiet = Date.now() - showChangedAt > 800;
    const reduced = (
      globalThis as unknown as { matchMedia?: (q: string) => { matches: boolean } }
    ).matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (looksOtherwise && next.motion === 'lively' && quiet && !reduced && doc.startViewTransition) {
      const fade = doc.startViewTransition(() => {
        draw(next);
        // Session 42: the new band sweeps in once (app.css, data-band-sweep: a and b in turn, so it plays again).
        const root = dom.document.documentElement;
        if (root) root.dataset['bandSweep'] = root.dataset['bandSweep'] === 'a' ? 'b' : 'a';
      });
      fading = fade;
      void fade.finished.finally(() => {
        if (fading === fade) fading = null;
      });
    } else draw(next);
  });
}
