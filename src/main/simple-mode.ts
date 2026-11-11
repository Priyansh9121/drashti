import type { AudioOutputStatus } from '../shared/audio';
import type { InvokeChannel } from '../shared/ipc';
import { IPC } from '../shared/ipc';
import { DROP_REFUSED_VIEW } from '../shared/drop-folder';
import { SIMPLE_MODE_REFUSAL } from '../shared/mode';
import { NO_VIEW } from '../shared/access-list';

/*
 * What Simple Mode locks. Every request that would change the library, the
 * playlists, messages, timers, the screens or the sound is
 * refused in the main process while Simple Mode is on (the window does not
 * offer them either), and so is starting, ending or changing the stream,
 * and turning the local network on or off or changing its devices;
 * backup and restore leave the menu. Running the show
 * (the engine's commands, except those SIMPLE_MODE_REFUSED_COMMANDS lists),
 * reading the library and saving diagnostics stay.
 *
 * Since Session 55 (Part 18, Simple Mode for a one-projector sabha) Simple Mode also offers, each only within its
 * bounds (SIMPLE_MODE_BOUNDED): bringing things in (the main process gives Simple Mode's import its own limits: only
 * sounds, videos, pictures, PDFs and decks, and a changed file kept beside the old one, never replacing it), a
 * playlist's rows (added to, moved in, taken out of and put back in), Rename of a file a playlist holds, and From a
 * Link… (since Session 56 whole, as Pro Mode's: the owner's words of 11 Nov 2026, "Import from a Link, whole (YouTube
 * and Dropbox)"). Since Session 56 (the owner's words of 11 Nov 2026: "several playlists on the left,
 * with folders, as in Pro Mode, and smart playlists") the playlists and folders themselves too, as Pro Mode's left
 * column offers them: New playlist and New folder (at the top or in a folder), Rename…, Delete… and its Undo, and
 * Smart Playlist from a Folder…; the window opens any of them (main/simple-playlist.ts follows which). A template, a
 * slot, sharing with phones, Repeat Slides and its settings, Duplicate and a row's timers stay Pro Mode's, and so does
 * everything else. This is the one list for Simple access too (Session 55, Part 19): the mode keeper holds the mode
 * in Simple, and so this lock.
 */

/** The Access List's edits (Session 54, E4). */
const ACCESS_LIST_EDITS: readonly InvokeChannel[] = [
  IPC.accessList.add,
  IPC.accessList.approve,
  IPC.accessList.reject,
  IPC.accessList.revoke,
  IPC.accessList.regrant,
  IPC.accessList.changeLength,
  // How a Gmail may use Drashti (Session 55).
  IPC.accessList.changeMode,
  IPC.accessList.note,
];

export const SIMPLE_MODE_LOCKED: readonly InvokeChannel[] = [
  // Offline helpers are operator choices in Pro Mode, including their background requests.
  IPC.aiSpeech.get,
  IPC.aiSpeech.set,
  IPC.aiSpeech.search,
  IPC.aiSpeech.showBook,
  IPC.aiSpeech.nextVerse,
  IPC.ai.get,
  IPC.ai.set,
  IPC.ai.past,
  IPC.ai.search,
  IPC.ai.lyrics,
  IPC.ai.approveLyrics,
  IPC.ai.playlist,
  IPC.ai.approvePlaylist,
  IPC.ai.cancel,
  IPC.library.saveWords,
  IPC.library.newFromWords,
  // New › QR code… (Session 55, Part 8): Pro Mode's.
  IPC.library.newQrSlide,
  IPC.library.saveSlides,
  IPC.library.exportPdf,
  IPC.library.setDefaultTransition,
  IPC.library.setExtras,
  // The single-letter keys (Session 37): Pro Mode's keys sheet turns them on or off.
  IPC.app.setSingleKeys,
  // The appearance (Sessions 39–40): Simple Mode shows the one chosen, with no switch.
  IPC.appearance.choose,
  IPC.appearance.make,
  IPC.appearance.remove,
  IPC.appearance.setMotion,
  IPC.library.restoreRevision,
  IPC.library.relinkMedia,
  IPC.library.setArrangement,
  IPC.library.removePresentations,
  IPC.library.restorePresentations,
  IPC.kirtans.saveTracks,
  IPC.kirtans.setDetails,
  IPC.kirtans.makeTransliteration,
  IPC.kirtans.setTranslitStyle,
  IPC.kirtans.addCategory,
  // The playlists and folders themselves are Simple Mode's too since Session 56 (bounded below); a slot is not.
  IPC.playlists.fillPlaceholder,
  IPC.playlists.renameHeader,
  IPC.playlists.saveAsTemplate,
  IPC.playlists.newFromTemplate,
  // Session 55 (Parts 4 and 14): Duplicate is Pro Mode's (the one right-click menu's Rename is bounded since Part 18).
  IPC.playlists.duplicate,
  IPC.playlists.addSlot,
  IPC.messages.create,
  IPC.messages.update,
  IPC.messages.remove,
  // Session 55 (Part 15): a message put back (Undo), and Countdown to the start, Pro Mode's.
  IPC.messages.restore,
  IPC.timers.create,
  IPC.timers.update,
  IPC.timers.remove,
  IPC.timers.startCountdown,
  IPC.stageLayouts.save,
  IPC.playlists.editSlot,
  IPC.playlists.setTimers,
  // Session 55, Part 6: a video row's When it ends; and a wallpaper's seconds and fade, its editor's (Simple Mode has the
  // wallpapers since Part 18, bounded below, without the editor).
  IPC.playlists.setWhenEnds,
  IPC.wallpapers.setTiming,
  // Smart playlists (Session 26c): Simple Mode makes one since Session 56 (bounded below); taking a smart playlist's
  // missing items out, its banner's button, stays Pro Mode's (a row's Delete takes one out in either mode).
  IPC.playlists.removeMissing,
  // Repeat Slides (Session 26d): Simple Mode starts and stops it (engine commands), and changes no setting.
  IPC.playlists.createRepeat,
  IPC.playlists.setRepeat,
  IPC.shastra.remove,
  // Calendars: loading one is an import (locked above); removing one is locked too.
  IPC.calendar.remove,
  // Lower Thirds (Session 44): Simple Mode changes none (it has none to show either).
  IPC.lowerThirds.save,
  IPC.lowerThirds.remove,
  IPC.lowerThirds.restore,
  // The Lower Thirds studio (Session 55, Part 16): Pro Mode's; it closes in Simple Mode.
  IPC.lowerThirds.studio,
  // The slide editor's window (Session 55, Part 17a): Pro Mode's (its saves are locked above); it closes in Simple
  // Mode, and what it copies is kept for Pro Mode's next.
  IPC.slideEditor.open,
  IPC.slideEditor.copy,
  IPC.lowerThirds.show,
  IPC.lowerThirds.hide,
  // The MIDI controller: Simple Mode changes none of it (its pads still work Simple Mode's own actions).
  IPC.midi.set,
  IPC.stageLayouts.remove,
  // Session 55: renaming one, putting one back (Undo), and the one every stage screen shows: Pro Mode's setup.
  IPC.stageLayouts.rename,
  IPC.stageLayouts.restore,
  IPC.stageLayouts.choose,
  IPC.screens.createGroup,
  IPC.screens.renameGroup,
  IPC.screens.setGroupRole,
  IPC.screens.setGroupLanguages,
  IPC.screens.deleteGroup,
  IPC.screens.assignDisplay,
  IPC.screens.updateScreen,
  // A display's job (Session 55): Simple Mode changes no screen.
  IPC.screens.setJob,
  IPC.screens.removeScreen,
  IPC.audio.setOutput,
  IPC.setup.finish,
  IPC.setup.setSeen,
  IPC.setup.welcomeSeen,
  // The stream: Simple Mode shows ON AIR and REC, and can neither start, end nor change it.
  IPC.stream.setLayout,
  IPC.stream.saveProfile,
  IPC.stream.setInputs,
  IPC.stream.removeProfile,
  IPC.stream.useProfile,
  IPC.stream.setKey,
  IPC.stream.removeKey,
  IPC.stream.goLive,
  IPC.stream.end,
  IPC.stream.startRecording,
  IPC.stream.stopRecording,
  IPC.stream.pickFolder,
  IPC.media.convert,
  IPC.media.setMarkers,
  IPC.media.cancelConversion,
  IPC.media.undoConversion,
  // Save as MP4… (Session 26e) is Pro Mode's, as are a picture's look and keeping a live zoom; and Save picture…
  // (Session 55, Part 5), from the right-click menu Simple Mode does not have.
  IPC.media.saveTrim,
  IPC.media.stopSave,
  IPC.media.setLook,
  IPC.media.keepLiveZoom,
  // Session 55, Part 7: Audio's Music steps aside, a file's Even loudness, Trim black and silence: Pro Mode's.
  IPC.sound.setStepsAside,
  IPC.sound.setEven,
  IPC.sound.trimEdges,
  IPC.media.savePicture,
  IPC.network.setOn,
  IPC.network.setPort,
  IPC.network.startPairing,
  IPC.network.cancelPairing,
  IPC.network.renameDevice,
  IPC.network.revokeDevice,
  IPC.network.makePoster,
  // Session 54: whether phones may add files, and which playlists they see, are Pro Mode's.
  IPC.network.setAddFiles,
  IPC.playlists.share,
  // Output nodes (Session 13): Simple Mode sees the dashboard and Identify, and changes nothing:
  // no pairing, removing, renaming, assigning, copying everything or reloading an output.
  IPC.nodes.startPairing,
  IPC.nodes.cancelPairing,
  IPC.nodes.rename,
  IPC.nodes.remove,
  IPC.nodes.newIdentity,
  IPC.nodes.everything,
  IPC.nodes.reload,
  IPC.screens.assignNodeDisplay,
  // A node's own window has no Simple Mode; listed so no change is ever open by mistake.
  IPC.node.pair,
  IPC.node.unpair,
  IPC.node.useAsMain,
  IPC.node.updateCheck,
  IPC.node.updateDownload,
  IPC.node.updateInstall,
  IPC.node.updateShowFile,
  // Scheduled backups (Session 14): Simple Mode sees the warning (and can put it away), changes nothing.
  IPC.backups.save,
  IPC.backups.pickFolder,
  IPC.backups.runNow,
  // Events out (Session 28): Simple Mode never sees them.
  IPC.events.view,
  IPC.events.add,
  IPC.events.update,
  IPC.events.remove,
  IPC.events.rotate,
  IPC.events.test,
  // The drop folder (Session 28): Simple Mode never sees its settings (the folder carries on quietly).
  IPC.drop.view,
  IPC.drop.pickFolder,
  IPC.drop.setOn,
  IPC.drop.importAnyway,
  // Live captions (Session 55, Part 10): set in Pro Mode only; Simple Mode's screens show them as they are.
  IPC.captions.view,
  IPC.captions.setOn,
  IPC.captions.setModel,
  IPC.captions.setSettings,
  IPC.captions.retry,
  // Audio playlists (Session 14): Simple Mode plays and pauses one, and changes none.
  IPC.music.create,
  IPC.music.rename,
  IPC.music.remove,
  IPC.music.setOptions,
  IPC.music.addTracks,
  IPC.music.moveTrack,
  IPC.music.removeTrack,
  IPC.music.restore,
  IPC.media.remove,
  IPC.media.restore,
  IPC.music.restoreTrack,
  // Updates (Session 14): Simple Mode never sees them.
  IPC.updates.check,
  IPC.updates.download,
  IPC.updates.cancel,
  IPC.updates.setInstallOnQuit,
  IPC.updates.setAutoCheck,
  IPC.updates.showFile,
  // The announcements queue: Simple Mode never approves, edits, rejects or takes one off.
  IPC.announcements.edit,
  IPC.announcements.approve,
  IPC.announcements.reject,
  IPC.announcements.takeOff,
  // Show a Window… and the window for Zoom (Session 48) are Pro Mode's; clearing a window is not locked.
  IPC.liveWindow.list,
  IPC.liveWindow.show,
  IPC.liveWindow.access,
  IPC.zoom.open,
  // The Access List's edits (Session 54, E4): Pro Mode's, as every change; reading it and saving its CSV are not.
  ...ACCESS_LIST_EDITS,
  // Video inputs and picture in picture (Session 50) are set up in Pro Mode; the Audience and Stage switches and
  // Keep or Go back are not locked (Simple Mode may turn screens on, and go back).
  IPC.videoInputs.add,
  IPC.videoInputs.update,
  IPC.videoInputs.remove,
  // The chosen one (Session 55), as the Stage screen panel chooses it.
  IPC.videoInputs.choose,
  IPC.pip.savePlace,
  // The quick bar (Session 55, Part 8): Pro Mode's; Simple Mode shows none and never changes its pins.
  IPC.quickBar.set,
  // File › Opening… (Session 55): Pro Mode's; the opening itself plays as Drashti starts in either mode.
  IPC.opening.setOn,
  IPC.opening.setChoice,
  IPC.opening.loadPack,
  IPC.opening.saveCopy,
  IPC.opening.removeSound,
];

/** What an id names among the playlists (Session 56), as the lock reads it: a template is Pro Mode's. */
export type ListKind = 'playlist' | 'folder' | 'template' | null;

/**
 * The playlist open in Simple Mode's window and what it holds, as the lock reads them (index.ts, from the library): what
 * a phone in Simple Mode works on (simple-mode-phones.ts).
 */
export interface SimpleOpenPlaylist {
  /**
   * The playlist open in Simple Mode's window, or null when none is (before Simple Mode needed one, or its open one
   * deleted). Session 55 (Part 18) kept it to one playlist; since Session 56 it is whichever the window opened
   * (simple-playlist.ts).
   */
  playlistId: string | null;
  /** The playlist an item is in (one taken out too), or null. */
  playlistOf(itemId: string): string | null;
  /** Whether the open playlist has a row of this picture, video or sound. */
  holdsMedia(mediaId: string): boolean;
  /** Whether the open playlist has a row of this presentation (a PDF's or a deck's too). */
  holdsPresentation(presentationId: string): boolean;
}

/**
 * Simple Mode as the lock reads it for the bounds of what its window offers (index.ts, from the library, as each
 * request comes): since Session 56 every playlist and folder, as Pro Mode's left column offers them, never a template.
 */
export interface SimpleScope extends SimpleOpenPlaylist {
  /** What an id names among the playlists, a deleted one too (for its Undo); null when it names none. */
  kindOf(id: string): ListKind;
  /** Whether a playlist (never a template) has a row of this picture, video or sound. */
  listsMedia(mediaId: string): boolean;
  /** Whether a playlist (never a template) has a row of this presentation (a PDF's or a deck's too). */
  listsPresentation(presentationId: string): boolean;
}

/** Whether a request on a bounded channel, with its arguments as sent, stays within Simple Mode's bounds. */
export type SimpleBound = (args: readonly unknown[], scope: SimpleScope) => boolean;

const anything: SimpleBound = () => true;
/**
 * A playlist (a smart, Repeat Slides or folder playlist too, a deleted one for its Undo), never a folder of playlists
 * or a template: the bounds of a request on a playlist's rows (Session 56).
 */
export const aPlaylist = (scope: SimpleScope, id: unknown): boolean =>
  typeof id === 'string' && scope.kindOf(id) === 'playlist';
/** A playlist or a folder of playlists (a deleted one too, for its Undo), never a template. */
export const aPlaylistOrFolder = (scope: SimpleScope, id: unknown): boolean => {
  if (typeof id !== 'string') return false;
  const kind = scope.kindOf(id);
  return kind === 'playlist' || kind === 'folder';
};
/** A folder of playlists, for something new made in it (New playlist here, New folder here). */
const aFolder = (scope: SimpleScope, id: unknown): boolean =>
  typeof id === 'string' && scope.kindOf(id) === 'folder';
/** A playlist's item (one taken out too, for its Undo), never a template's. */
export const aPlaylistsItem = (scope: SimpleScope, itemId: unknown): boolean =>
  typeof itemId === 'string' && aPlaylist(scope, scope.playlistOf(itemId));
/** Items, every one a playlist's (as aPlaylistsItem), at least one. */
export const playlistsItems = (scope: SimpleScope, ids: unknown): boolean =>
  Array.isArray(ids) && ids.length > 0 && ids.every((id) => aPlaylistsItem(scope, id));
/** A picture, video or sound a playlist has a row of (never only a template). */
export const aPlaylistsMedia = (scope: SimpleScope, mediaId: unknown): boolean =>
  typeof mediaId === 'string' && scope.listsMedia(mediaId);
/** A presentation (a PDF's or a deck's too) a playlist has a row of (never only a template). */
export const aPlaylistsPresentation = (scope: SimpleScope, presentationId: unknown): boolean =>
  typeof presentationId === 'string' && scope.listsPresentation(presentationId);
/** What Simple Mode's imports add: a presentation (a PDF's or a deck's), a picture, video or sound, a folder's part. */
const SIMPLE_ADDS: ReadonlySet<unknown> = new Set(['presentation', 'media', 'header']);
const itsAdds = (items: unknown): boolean =>
  Array.isArray(items) &&
  items.length > 0 &&
  items.every((i) => typeof i === 'object' && i !== null && SIMPLE_ADDS.has((i as { kind?: unknown }).kind));

/**
 * What Simple Mode offers since Session 55 (Part 18), each with its bounds. Never also in SIMPLE_MODE_LOCKED. Each has
 * a refusal as a locked channel has (simpleModeRefusals), so the lock fails closed: a request runs only when its bounds
 * say it is within them (simpleModeBounds); one with none of its arguments (the phones' and Companion's API asks
 * refusedNow) is outside them: a phone makes, renames or deletes no playlist in Simple Mode, as before.
 */
export const SIMPLE_MODE_BOUNDED: ReadonlyMap<InvokeChannel, SimpleBound> = new Map<
  InvokeChannel,
  SimpleBound
>([
  // Bringing things in: Add files… and files dropped. The main process gives Simple Mode's import its own limits.
  [IPC.library.importPaths, anything],
  [IPC.library.pickImportPaths, anything],
  // The playlists and folders (Session 56), as Pro Mode's left column offers them: New playlist and New folder, at the
  // top or in a folder (New playlist here, New folder here); Rename…; Delete… (several chosen together too) and its
  // Undo. Never a template.
  [
    IPC.playlists.create,
    ([, parentId, isFolder], scope) =>
      typeof isFolder === 'boolean' && (parentId === null || aFolder(scope, parentId)),
  ],
  [IPC.playlists.rename, ([id], scope) => aPlaylistOrFolder(scope, id)],
  [
    IPC.playlists.remove,
    ([ids], scope) => Array.isArray(ids) && ids.length > 0 && ids.every((id) => aPlaylistOrFolder(scope, id)),
  ],
  [
    IPC.playlists.restore,
    ([ids], scope) => Array.isArray(ids) && ids.length > 0 && ids.every((id) => aPlaylistOrFolder(scope, id)),
  ],
  // Smart Playlist from a Folder… (Session 56): the folder chosen in the system's dialog, which the main process asks;
  // and (the owner's item 5) a folder dropped, a smart playlist at once, nothing asked (the main process looks at
  // what was dropped; the files among it come back to go through Simple Mode's import, as files dropped do).
  [IPC.playlists.createSmart, anything],
  [IPC.playlists.createSmartFrom, anything],
  // A playlist's rows (Session 56: whichever is open; another too, as Pro Mode's own parts do: files dropped on its row
  // in the list, an import that ends after another was opened, an Undo there): what its imports made added to it,
  // dragged about, taken out (Delete) and put back (Undo). Never a template's.
  [IPC.playlists.addItems, ([playlistId, , items], scope) => aPlaylist(scope, playlistId) && itsAdds(items)],
  [IPC.playlists.moveItems, ([playlistId], scope) => aPlaylist(scope, playlistId)],
  [IPC.playlists.removeItems, ([ids], scope) => playlistsItems(scope, ids)],
  [IPC.playlists.restoreItems, ([ids], scope) => playlistsItems(scope, ids)],
  // A slide's row dragged within its deck or out of it (Part 4b), and its Undo: a playlist's items.
  [IPC.playlists.setItemOrder, ([itemId], scope) => aPlaylistsItem(scope, itemId)],
  [IPC.playlists.splitItem, ([itemId], scope) => aPlaylistsItem(scope, itemId)],
  [IPC.playlists.undoSplit, ([itemId, , madeId], scope) => playlistsItems(scope, [itemId, madeId])],
  // Rename… on a row: a file a playlist holds.
  [IPC.library.renamePresentation, ([id], scope) => aPlaylistsPresentation(scope, id)],
  [IPC.media.rename, ([id], scope) => aPlaylistsMedia(scope, id)],
  // From a Link… (YouTube and Dropbox), whole since Session 56 (the owner's words of 11 Nov 2026: "Import from a Link,
  // whole"): Pro Mode's dialog, into the playlist chosen (or a new one), a Dropbox folder a playlist of its own. The
  // link service keeps its own limits (a quality it offers, nothing changed while a download goes, only what it saved
  // shown); the playlist a download went into is a playlist, never a template or a folder.
  [IPC.links.look, anything],
  [IPC.links.download, anything],
  [IPC.links.stop, anything],
  [IPC.links.reset, anything],
  [IPC.links.addWaiting, anything],
  [IPC.links.setPlaylist, ([playlistId], scope) => aPlaylist(scope, playlistId)],
  // Its settings and its way to the files (Pro Mode's until Session 56): the highest video quality, the folder to save
  // in (the system's dialog), and Show in Finder (Explorer) of what a download saved.
  [IPC.links.setMaxHeight, anything],
  [IPC.links.pickFolder, anything],
  [IPC.links.showSaved, anything],
  // The wallpapers (Part 6): added (Import…, or pictures dropped), chosen, renamed, deleted and put back (Undo), and
  // pictures dropped on one to go round. They belong to no playlist: nothing bounds them but what they are.
  [IPC.wallpapers.add, anything],
  [IPC.wallpapers.pickFiles, anything],
  [IPC.wallpapers.rename, anything],
  [IPC.wallpapers.setPictures, anything],
  [IPC.wallpapers.remove, anything],
  [IPC.wallpapers.restore, anything],
  [IPC.wallpapers.choose, anything],
]);

/**
 * Whether Simple Mode refuses a request on this channel that comes with none of its arguments (a phone's or Companion's,
 * as the network asks refusedNow): every locked channel, and every bounded one (its bounds are the window's).
 */
export function simpleModeRefusesWhole(channel: InvokeChannel): boolean {
  return SIMPLE_MODE_LOCKED.includes(channel) || SIMPLE_MODE_BOUNDED.has(channel);
}

/**
 * Each bounded channel's test as the lock asks it (ipc/handle.ts): whether a request, its arguments as sent, is within
 * its bounds, the playlists read as each request comes (`scope`).
 */
export function simpleModeBounds(
  scope: () => SimpleScope,
): Map<InvokeChannel, (args: readonly unknown[]) => boolean> {
  return new Map(
    [...SIMPLE_MODE_BOUNDED].map(
      ([channel, bound]): [InvokeChannel, (args: readonly unknown[]) => boolean] => [
        channel,
        (args) => bound(args, scope()),
      ],
    ),
  );
}

/**
 * Each locked channel's answer, and each bounded one's outside its bounds: a refusal in its own result's shape, in
 * `words` (Session 55: true for this computer's access, so Simple access is never told of a way to Pro Mode).
 */
export function simpleModeRefusals(
  sound: () => AudioOutputStatus,
  words: () => string = () => SIMPLE_MODE_REFUSAL,
): Map<InvokeChannel, () => unknown> {
  const refused = () => ({ ok: false as const, message: words() });
  const answers = new Map<InvokeChannel, () => unknown>(
    [...SIMPLE_MODE_LOCKED, ...SIMPLE_MODE_BOUNDED.keys()].map((c) => [c, refused]),
  );
  // These answer in shapes of their own: no files picked, and the sound output as it is.
  answers.set(IPC.library.pickImportPaths, () => []);
  answers.set(IPC.wallpapers.pickFiles, () => []);
  // Nothing made from what was dropped, saying why.
  answers.set(IPC.playlists.createSmartFrom, () => ({ made: [], files: [], problems: [words()] }));
  answers.set(IPC.audio.setOutput, sound);
  answers.set(IPC.events.view, () => ({ available: false, message: words(), addresses: [] }));
  answers.set(IPC.drop.view, () => ({ ...DROP_REFUSED_VIEW }));
  answers.set(IPC.drop.pickFolder, () => null);
  // The Access List's: what happened, with no list (its window keeps the one it shows).
  for (const c of ACCESS_LIST_EDITS) answers.set(c, () => ({ ...refused(), view: NO_VIEW }));
  answers.set(IPC.liveWindow.list, () => ({ ok: false, reason: 'unlisted', message: words() }));
  answers.set(IPC.liveWindow.access, () => null);
  answers.set(IPC.zoom.open, () => null);
  answers.set(IPC.ai.cancel, () => null);
  return answers;
}
