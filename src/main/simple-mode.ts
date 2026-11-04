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
 * sounds, videos, pictures, PDFs and decks, and a changed file kept beside the old one, never replacing it), its one
 * playlist's rows (added to, moved in, taken out of and put back in that playlist only: main/simple-playlist.ts says
 * which), Rename of a file that playlist holds, and From a Link… into it. Everything else stays locked. This is the
 * one list for Simple access too (Session 55, Part 19): the mode keeper holds the mode in Simple, and so this lock.
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
  IPC.playlists.create,
  IPC.playlists.rename,
  IPC.playlists.remove,
  IPC.playlists.restore,
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
  // Smart playlists (Session 26c): Simple Mode sees what their folders bring, and changes no setup.
  IPC.playlists.createSmart,
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
  // Import from a Link (Session 25b): Simple Mode downloads into its one playlist since Session 55 (bounded below);
  // where downloads are saved and the highest video quality stay Pro Mode's, and so does showing a saved one.
  IPC.links.pickFolder,
  IPC.links.showSaved,
  IPC.links.setMaxHeight,
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
];

/**
 * Simple Mode's one playlist and what it holds, as the lock reads them (index.ts, from the library), for the bounds of
 * what Simple Mode offers.
 */
export interface SimpleScope {
  /** The one playlist (Session 55, Part 18), or null before Simple Mode has needed one. */
  playlistId: string | null;
  /** The playlist an item is in (one taken out too), or null. */
  playlistOf(itemId: string): string | null;
  /** Whether the one playlist has a row of this picture, video or sound. */
  holdsMedia(mediaId: string): boolean;
  /** Whether the one playlist has a row of this presentation (a PDF's or a deck's too). */
  holdsPresentation(presentationId: string): boolean;
}

/** Whether a request on a bounded channel, with its arguments as sent, stays within Simple Mode's bounds. */
export type SimpleBound = (args: readonly unknown[], scope: SimpleScope) => boolean;

const anything: SimpleBound = () => true;
const theOne = (scope: SimpleScope, playlistId: unknown): boolean =>
  scope.playlistId !== null && playlistId === scope.playlistId;
/** Every one an item of the one playlist (one taken out too, for its Undo). */
const itsItems = (scope: SimpleScope, ids: unknown): boolean =>
  scope.playlistId !== null &&
  Array.isArray(ids) &&
  ids.length > 0 &&
  ids.every((id) => typeof id === 'string' && scope.playlistOf(id) === scope.playlistId);
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
 * refusedNow) is outside them: a phone changes no playlist in Simple Mode, as before.
 */
export const SIMPLE_MODE_BOUNDED: ReadonlyMap<InvokeChannel, SimpleBound> = new Map<
  InvokeChannel,
  SimpleBound
>([
  // Bringing things in: Add files… and files dropped. The main process gives Simple Mode's import its own limits.
  [IPC.library.importPaths, anything],
  [IPC.library.pickImportPaths, anything],
  // The one playlist's rows: what its imports made added to it, dragged about, taken out (Delete) and put back (Undo).
  [IPC.playlists.addItems, ([playlistId, , items], scope) => theOne(scope, playlistId) && itsAdds(items)],
  [IPC.playlists.moveItems, ([playlistId], scope) => theOne(scope, playlistId)],
  [IPC.playlists.removeItems, ([ids], scope) => itsItems(scope, ids)],
  [IPC.playlists.restoreItems, ([ids], scope) => itsItems(scope, ids)],
  // A slide's row dragged within its deck or out of it (Part 4b), and its Undo: the one playlist's items.
  [IPC.playlists.setItemOrder, ([itemId], scope) => itsItems(scope, [itemId])],
  [IPC.playlists.splitItem, ([itemId], scope) => itsItems(scope, [itemId])],
  [IPC.playlists.undoSplit, ([itemId, , madeId], scope) => itsItems(scope, [itemId, madeId])],
  // Rename… on a row: a file the one playlist holds.
  [
    IPC.library.renamePresentation,
    ([id], scope) => scope.playlistId !== null && typeof id === 'string' && scope.holdsPresentation(id),
  ],
  [
    IPC.media.rename,
    ([id], scope) => scope.playlistId !== null && typeof id === 'string' && scope.holdsMedia(id),
  ],
  // From a Link… (YouTube and Dropbox), into the one playlist; a Dropbox folder too (index.ts adds its files there).
  [IPC.links.look, anything],
  [IPC.links.download, anything],
  [IPC.links.stop, anything],
  [IPC.links.reset, anything],
  [IPC.links.addWaiting, anything],
  [IPC.links.setPlaylist, ([playlistId], scope) => theOne(scope, playlistId)],
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
 * its bounds, the one playlist read as each request comes (`scope`).
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
