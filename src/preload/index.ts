import { contextBridge, ipcRenderer, type IpcRendererEvent, webUtils } from 'electron';
import type { DrashtiBridge } from '../shared/bridge';
import type { EventChannel, EventContract, InvokeArgs, InvokeChannel, InvokeResult } from '../shared/ipc';
import { IPC } from '../shared/ipc';

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
    listPresentations: () => invoke(IPC.library.listPresentations),
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
    identify: () => invoke(IPC.screens.identify),
    uncoverOperator: () => invoke(IPC.screens.uncoverOperator),
  },
  output: {
    getContext: () => invoke(IPC.output.getContext),
    onContext: (listener) => on(IPC.output.context, listener),
    onIdentify: (listener) => on(IPC.output.identify, listener),
  },
};

contextBridge.exposeInMainWorld('drashti', bridge);
