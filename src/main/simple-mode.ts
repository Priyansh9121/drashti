import type { AudioOutputStatus } from '../shared/audio';
import type { InvokeChannel } from '../shared/ipc';
import { IPC } from '../shared/ipc';
import { DROP_REFUSED_VIEW } from '../shared/drop-folder';
import { SIMPLE_MODE_REFUSAL } from '../shared/mode';
import { NO_VIEW } from '../shared/access-list';
import type { SimpleFeature } from '../shared/simple-features';

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
 * Smart Playlist from a Folder…; the window opens any of them (main/simple-playlist.ts follows which). Also since
 * Session 56, Pro Mode's Audio, a row's Trim and When it ends, and Edit slides (SESSION_56_BOUNDED, below). A
 * template, a slot, sharing with phones, Repeat Slides and its settings, Duplicate and a row's timers stay Pro Mode's,
 * and so does everything else. This is the one list for Simple access too (Session 55, Part 19): the mode keeper
 * holds the mode in Simple, and so this lock.
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
  // Writing and saving slides from words are Pro Mode's.
  IPC.library.saveWords,
  IPC.library.newFromWords,
  // Book OCR (alpha.21): New presentation's Read Words from a Page… is part of it (Simple Mode starts no reading, so
  // it has none to stop: its Stop Reading answers that nothing was stopped).
  IPC.library.readWordsChoose,
  IPC.library.readWords,
  IPC.library.stopReadingWords,
  // New › QR code… (Session 55, Part 8): Pro Mode's; so are its window's logo and Download… (Q60-28).
  IPC.library.newQrSlide,
  IPC.library.pickQrLogo,
  IPC.library.keepQrLogo,
  IPC.library.setQrChoices,
  IPC.library.downloadQr,
  // The slide editor's Save a PDF copy… (a copy: Pro Mode's; its save is bounded since Session 56, below).
  IPC.library.exportPdf,
  // A singers' sheet (alpha.22): Print words… and Save words as PDF… are Pro Mode's, in its library's menu.
  IPC.library.printWords,
  IPC.library.saveWordsPdf,
  // Make a slide… (alpha.21): a new presentation from a PDF page, as New › QR code… makes one.
  IPC.slideEditor.makeSlide,
  // Prepare translations (alpha.22): drafting is Pro Mode's, as Translation…'s changes are.
  IPC.slideEditor.translationStatus,
  IPC.slideEditor.translationDraft,
  IPC.slideEditor.translationCancel,
  IPC.library.extractPdfPages,
  IPC.library.showExtractedPdf,
  IPC.library.showExtractedPdfCopy,
  IPC.library.pdfWorkAllowed,
  IPC.library.setDefaultTransition,
  IPC.library.setExtras,
  // The single-letter keys (Session 37): Pro Mode's keys sheet turns them on or off.
  IPC.app.setSingleKeys,
  // Edit › Simple Mode Features… (alpha.22): only Pro Mode chooses the tools Simple Mode has.
  IPC.app.setSimpleFeature,
  // The appearance (Sessions 39–40): Simple Mode shows the one chosen, with no switch.
  IPC.appearance.choose,
  IPC.appearance.make,
  IPC.appearance.remove,
  IPC.appearance.setMotion,
  // Session 60: Moving: On / Off and the favourites, the Appearance window's too.
  IPC.appearance.setMoving,
  IPC.appearance.setFavourite,
  IPC.library.relinkMedia,
  IPC.library.setArrangement,
  IPC.library.removePresentations,
  IPC.library.restorePresentations,
  IPC.kirtans.exportBundle,
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
  IPC.playlists.setPlayOptions,
  IPC.playlists.importM3u,
  IPC.playlists.exportM3u,
  // A playlist's running order (alpha.22): copied, printed or saved as a PDF from its ⋯, Pro Mode's as the M3U is.
  IPC.playlists.copyRunningOrder,
  IPC.playlists.printRunningOrder,
  IPC.playlists.saveRunningOrderPdf,
  IPC.playlists.addSlot,
  IPC.messages.create,
  IPC.messages.update,
  IPC.messages.remove,
  // Session 55 (Part 15): a message put back (Undo), and Countdown to the start, Pro Mode's; since alpha.22 Countdown to
  // the start is Simple Mode's too while Timers is chosen for it in Edit › Simple Mode Features… (SIMPLE_FEATURE_CHANNELS
  // below; the lead's one-minute answer for the owner, 24 Nov 2026), and Pro Mode's alone otherwise.
  IPC.messages.restore,
  IPC.timers.create,
  IPC.timers.update,
  IPC.timers.remove,
  IPC.timers.startCountdown,
  IPC.stageLayouts.save,
  IPC.playlists.editSlot,
  IPC.playlists.setTimers,
  // Session 55, Part 6: a wallpaper's seconds and fade, its editor's (Simple Mode has the wallpapers since Part 18,
  // bounded below, without the editor; a video row's When it ends is bounded since Session 56).
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
  // The Lower Thirds studio (Session 55, Part 16): Pro Mode's; it closes in Simple Mode. (The slide editor's window,
  // Part 17a, is Simple Mode's too since Session 56, bounded below.)
  IPC.lowerThirds.studio,
  IPC.lowerThirds.show,
  IPC.lowerThirds.hide,
  // The MIDI controller: Simple Mode changes none of it (its pads still work Simple Mode's own actions).
  IPC.midi.set,
  // OSC setup is Pro Mode only; enabled senders still obey Simple Mode show bounds.
  IPC.osc.configure,
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
  // Simple Mode can record locally. Going on air, ending a stream and changing its settings are Pro Mode's.
  IPC.stream.setLayout,
  IPC.stream.saveProfile,
  IPC.stream.setInputs,
  IPC.stream.removeProfile,
  IPC.stream.useProfile,
  IPC.stream.setKey,
  IPC.stream.removeKey,
  IPC.stream.goLive,
  IPC.stream.end,
  IPC.stream.pickFolder,
  // Video out (x30): turned on, off or named in Pro Mode only (it keeps sending in Simple Mode).
  IPC.stream.setVideoOut,
  // Scheduling on YouTube (x31): Pro Mode's, as Stream settings are (its status is read in both).
  IPC.youtube.setClient,
  IPC.youtube.removeClient,
  IPC.youtube.signIn,
  IPC.youtube.cancelSignIn,
  IPC.youtube.signOut,
  IPC.youtube.upcoming,
  IPC.youtube.schedule,
  IPC.youtube.useBroadcast,
  IPC.youtube.endBroadcast,
  // Conversions make copies: Pro Mode's (a file's start, end and markers are bounded since Session 56, below).
  IPC.media.convert,
  IPC.media.cancelConversion,
  IPC.media.undoConversion,
  // Exporting a copy with Save as MP4… (Session 26e) is Pro Mode's, as are a
  // picture's look and keeping a live zoom; and Save picture… (Session 55, Part 5). (Session 55, Part 7's Music steps
  // aside, Even loudness and Trim black and silence are bounded since Session 56, below.)
  IPC.media.saveTrim,
  IPC.media.stopSave,
  // Edit Video: exports and manual preparation controls are Pro Mode’s. Status stays readable.
  IPC.media.clipExport,
  IPC.media.stopClipExport,
  IPC.media.stopProxy,
  // Combine videos… (alpha.22): Pro Mode's; its list stays readable.
  IPC.media.combineVideos,
  IPC.media.stopCombine,
  IPC.media.setLook,
  IPC.media.keepLiveZoom,
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
  IPC.nodes.setController,
  IPC.nodes.setControllerAreas,
  IPC.nodes.reload,
  IPC.screens.assignNodeDisplay,
  // A node's own window has no Simple Mode; listed so no change is ever open by mistake.
  IPC.node.action,
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
  IPC.events.copySecret,
  // The drop folder (Session 28): Simple Mode never sees its settings (the folder carries on quietly).
  IPC.drop.view,
  IPC.drop.pickFolder,
  IPC.drop.setOn,
  IPC.drop.importAnyway,
  // Live captions (Session 55, Part 10): set in Pro Mode only; Simple Mode's screens show them as they are.
  IPC.captions.prototypeView,
  IPC.captions.setPrototypeOn,
  IPC.captions.advancePrototype,
  IPC.captions.restartPrototype,
  IPC.captions.correctPrototype,
  IPC.captions.dismissPrototype,
  IPC.captions.view,
  IPC.captions.setOn,
  IPC.captions.setModel,
  IPC.captions.setSettings,
  IPC.captions.retry,
  // A model per language and the live timing (alpha.22): Pro Mode's too.
  IPC.captions.setLanguageModel,
  IPC.captions.checkLanguageModel,
  IPC.captions.setTiming,
  // Caption and translation models (alpha.22, cap-pack): Help › Caption and Translation Models… is Pro Mode's.
  IPC.modelPacks.view,
  IPC.modelPacks.import,
  IPC.modelPacks.cancel,
  IPC.modelPacks.remove,
  IPC.modelPacks.licence,
  // Caption words (alpha.22): kept in Pro Mode only, like the rest of live captions.
  IPC.captionWords.view,
  IPC.captionWords.set,
  IPC.captionWords.import,
  IPC.captionWords.export,
  IPC.captionWords.setHints,
  // A file deleted from the library and put back (the audio playlists' own changes are bounded since Session 56, below).
  IPC.media.remove,
  // Snapshot (alpha.20, the time bar's ⋯) is Pro Mode's (the owner's "Yes, all A" to Q60-39 P6 (j) A).
  IPC.media.snapshot,
  // Sound and picture… (alpha.20) is Pro Mode's (the owner's "Yes, all A" to Q60-39 P6 (j) A).
  IPC.media.videoEdit,
  IPC.media.setVideoEdit,
  IPC.media.setPlayback,
  IPC.media.restore,
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
  // Show a Stream Link… (alpha.20, slice 8) is Pro Mode's; clearing a link (Clear background, Clear all) is not locked.
  IPC.liveLink.show,
  IPC.liveLink.stop,
  IPC.liveLink.last,
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
  // Session 56 (alpha.16): Audio, a row's Trim and Edit slides in Simple Mode. Left out (as in a scope made for a
  // test), each answers no: the lock fails closed.
  /** Whether an audio playlist has this sound (a track of one): Audio's own right-click menu trims and renames it. */
  inMusic?(mediaId: string): boolean;
  /** The presentations an edit kept for Undo covers (main/library/revisions.ts), or null when it is not kept. */
  revisionCovers?(revisionId: string): readonly string[] | null;
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

/*
 * Session 56 (alpha.16), the owner: Simple Mode's right column and bottom bar from Pro Mode's own parts, each let
 * through here within its bounds (a phone or Companion, with none of the arguments, is still refused).
 * - Audio as Pro Mode has it (the owner: "build nothing new for it, just make it reachable"): the audio playlists made,
 *   renamed, deleted and put back, their sounds added, moved, taken out and put back, going round or shuffled, and
 *   Music steps aside. Audio playlists belong to no playlist: nothing bounds them but what they are.
 * - A row's Trim (start, end and markers), Trim black and silence and Even loudness, of a file a playlist holds (or a
 *   track of an audio playlist, from Audio's own right-click menu). Since Session 57, trimming a video row
 *   makes a copy for that row. Exporting with Save as MP4 and converting stay Pro Mode's.
 * - Edit slides (Pro's slide editor, its window): opened on a presentation a playlist holds, its save, what it copies
 *   for its next window, and its save's Undo when every presentation that edit kept is one a playlist holds.
 */

/** A file a playlist holds (never only a template), or a track of an audio playlist. */
const itsFile = (scope: SimpleScope, id: unknown): boolean =>
  aPlaylistsMedia(scope, id) || (typeof id === 'string' && (scope.inMusic?.(id) ?? false));

const isId = (value: unknown): boolean => typeof value === 'string' && value !== '';

const SESSION_56_BOUNDED: readonly [InvokeChannel, SimpleBound][] = [
  // Audio (Pro Mode's panel: music/MusicPanel.tsx).
  [IPC.music.create, ([name]) => typeof name === 'string'],
  [IPC.music.rename, ([id, name]) => isId(id) && typeof name === 'string'],
  [IPC.music.remove, ([id]) => isId(id)],
  [IPC.music.restore, ([id]) => isId(id)],
  [IPC.music.setOptions, ([id, options]) => isId(id) && typeof options === 'object' && options !== null],
  [IPC.music.addTracks, ([id, mediaIds]) => isId(id) && Array.isArray(mediaIds) && mediaIds.every(isId)],
  [IPC.music.moveTrack, ([id, to]) => isId(id) && typeof to === 'number'],
  [IPC.music.removeTrack, ([id]) => isId(id)],
  [IPC.music.restoreTrack, ([id, at]) => isId(id) && typeof at === 'number'],
  [IPC.sound.setStepsAside, ([on]) => typeof on === 'boolean'],
  // A row's Trim, Trim black and silence and Even loudness (Rename… of a file is bounded above, a track's too).
  [IPC.media.setMarkers, ([id], scope) => itsFile(scope, id)],
  [IPC.videoCaptions.select, ([id], scope) => itsFile(scope, id)],
  [IPC.videoCaptions.add, ([id], scope) => itsFile(scope, id)],
  [IPC.media.rowTrim, ([itemId], scope) => aPlaylistsItem(scope, itemId)],
  [IPC.media.applyRowTrim, ([itemId], scope) => aPlaylistsItem(scope, itemId)],
  [IPC.media.resetRowTrim, ([itemId], scope) => aPlaylistsItem(scope, itemId)],
  [IPC.media.stopRowTrim, ([itemId], scope) => aPlaylistsItem(scope, itemId)],
  [IPC.sound.trimEdges, ([id], scope) => itsFile(scope, id)],
  [IPC.sound.setEven, ([id], scope) => itsFile(scope, id)],
  // When it ends (Session 55, Part 6), in a video row's menu.
  [IPC.playlists.setWhenEnds, ([itemId], scope) => aPlaylistsItem(scope, itemId)],
  // Edit slides: Pro's slide editor's window, its save, and its save's Undo.
  [IPC.slideEditor.open, ([id], scope) => aPlaylistsPresentation(scope, id)],
  [IPC.slideEditor.copy, ([copied]) => typeof copied === 'object' && copied !== null],
  [IPC.slideEditor.addPicture, ([id], scope) => aPlaylistsPresentation(scope, id)],
  [IPC.library.saveSlides, ([id], scope) => aPlaylistsPresentation(scope, id)],
  [
    IPC.library.restoreRevision,
    ([id], scope) => {
      const covers = typeof id === 'string' ? (scope.revisionCovers?.(id) ?? null) : null;
      return covers !== null && covers.length > 0 && covers.every((p) => aPlaylistsPresentation(scope, p));
    },
  ],
];

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
  // Main checks that this is a failed automatic conversion that can be tried again.
  [IPC.media.retryConversion, ([id]) => isId(id)],
  // Main only stops the background conversion of a linked video.
  [IPC.media.cancelLinkConversion, ([id]) => isId(id)],
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
  // Rename… on a row: a file a playlist holds (since Session 56 a track's sound too, from Audio's own menu).
  [IPC.library.renamePresentation, ([id], scope) => aPlaylistsPresentation(scope, id)],
  [IPC.media.rename, ([id], scope) => itsFile(scope, id)],
  // From a Link… (YouTube and Dropbox), whole since Session 56 (the owner's words of 11 Nov 2026: "Import from a Link,
  // whole"): Pro Mode's dialog, into the playlist chosen (or a new one), a Dropbox folder a playlist of its own. The
  // link service keeps its own limits (a quality it offers, nothing changed while a download goes, only what it saved
  // shown); the playlist a download went into is a playlist, never a template or a folder.
  [IPC.links.start, anything],
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
  ...SESSION_56_BOUNDED,
]);

/**
 * Whether Simple Mode refuses a request on this channel that comes with none of its arguments (a phone's or Companion's,
 * as the network asks refusedNow): every locked channel, and every bounded one (its bounds are the window's).
 */
export function simpleModeRefusesWhole(channel: InvokeChannel): boolean {
  return SIMPLE_MODE_LOCKED.includes(channel) || SIMPLE_MODE_BOUNDED.has(channel);
}

/*
 * Simple Mode Features (alpha.22; the owner, 24 Nov 2026: "the features can be brought to simple mode, only 1-2 and max
 * 3", shared/simple-features.ts): while a tool is chosen in Pro Mode's Edit › Simple Mode Features…, Simple Mode's
 * window may make exactly its operate requests, each locked above for Pro Mode until then; its settings stay locked
 * (a message's or a timer's making and changing, a lower third's studio, a stage layout, adding a video input, the
 * quick bar's pins). Asked with none of the arguments (a phone's or Companion's), each is refused whole as before: a
 * chosen tool is the window's. Messages, Lower Thirds and the Stage screen's message and timers run through engine
 * commands Simple Mode never refused (their section is what changes); Picture in Picture's box and the video input's
 * one press are engine commands the engine lets through for a chosen tool (shared/mode.ts SIMPLE_FEATURE_COMMANDS).
 */
export const SIMPLE_FEATURE_CHANNELS: Readonly<Record<SimpleFeature, readonly InvokeChannel[]>> = {
  stage: [],
  messages: [],
  // Countdown to the start: the sabha's time over the wallpaper, its one timer made or changed to that time, shown (the
  // lead's one-minute answer for the owner, 24 Nov 2026: allowed while Timers is chosen, Pro Mode's otherwise).
  timers: [IPC.timers.startCountdown],
  'lower-thirds': [],
  // The windows to choose from, one shown as the background, and the Mac's screen recording permission it asks for.
  'show-a-window': [IPC.liveWindow.list, IPC.liveWindow.show, IPC.liveWindow.access],
  // A stream's link shown as the background, stopped, and the last one offered again.
  'show-a-stream-link': [IPC.liveLink.show, IPC.liveLink.stop, IPC.liveLink.last],
  // Which video input LIVE's one press puts up (adding, changing and removing one stay Pro Mode's).
  'video-inputs': [IPC.videoInputs.choose],
  // Where the box goes and how it looks, kept for the next box; and its window choice, from Show a Window…'s list.
  'picture-in-picture': [IPC.pip.savePlace, IPC.liveWindow.list, IPC.liveWindow.access],
};

/**
 * Each bounded channel's test as the lock asks it (ipc/handle.ts): whether a request, its arguments as sent, is within
 * its bounds, the playlists read as each request comes (`scope`); and (alpha.22) each chosen tool's operate requests,
 * the tools read as each request comes (`chosen`), so turning one off ends them at once.
 */
export function simpleModeBounds(
  scope: () => SimpleScope,
  chosen: () => readonly SimpleFeature[] = () => [],
): Map<InvokeChannel, (args: readonly unknown[]) => boolean> {
  const bounds = new Map(
    [...SIMPLE_MODE_BOUNDED].map(
      ([channel, bound]): [InvokeChannel, (args: readonly unknown[]) => boolean] => [
        channel,
        (args) => bound(args, scope()),
      ],
    ),
  );
  const toolsOf = new Map<InvokeChannel, SimpleFeature[]>();
  for (const [feature, channels] of Object.entries(SIMPLE_FEATURE_CHANNELS) as [
    SimpleFeature,
    InvokeChannel[],
  ][])
    for (const channel of channels) toolsOf.set(channel, [...(toolsOf.get(channel) ?? []), feature]);
  for (const [channel, tools] of toolsOf)
    bounds.set(channel, () => {
      const now = chosen();
      return tools.some((t) => now.includes(t));
    });
  return bounds;
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
  answers.set(IPC.media.rowTrim, () => null);
  answers.set(IPC.library.pickImportPaths, () => []);
  answers.set(IPC.library.stopReadingWords, () => false);
  answers.set(IPC.library.pdfWorkAllowed, () => false);
  answers.set(IPC.library.showExtractedPdf, () => false);
  answers.set(IPC.library.showExtractedPdfCopy, () => false);
  answers.set(IPC.wallpapers.pickFiles, () => []);
  // Nothing made from what was dropped, saying why.
  answers.set(IPC.playlists.createSmartFrom, () => ({ made: [], files: [], problems: [words()] }));
  answers.set(IPC.audio.setOutput, sound);
  answers.set(IPC.events.view, () => ({ available: false, message: words(), addresses: [] }));
  // Nothing copied (alpha.20: the new secret's Copy, whose window Simple Mode never opens).
  answers.set(IPC.events.copySecret, () => false);
  // Nothing printed (a singers' sheet, alpha.22): said as Print words… and Save words as PDF… say why not.
  for (const channel of [IPC.library.printWords, IPC.library.saveWordsPdf])
    answers.set(channel, () => ({ ok: false as const, cancelled: false as const, message: words() }));
  answers.set(IPC.media.stopClipExport, () => false);
  answers.set(IPC.media.stopCombine, () => false);
  answers.set(IPC.media.stopProxy, () => false);
  answers.set(IPC.modelPacks.cancel, () => false);
  answers.set(IPC.slideEditor.translationStatus, () => ({
    installed: false,
    available: false,
    message: words(),
  }));
  answers.set(IPC.slideEditor.translationCancel, () => false);
  answers.set(IPC.drop.view, () => ({ ...DROP_REFUSED_VIEW }));
  answers.set(IPC.drop.pickFolder, () => null);
  // The Access List's: what happened, with no list (its window keeps the one it shows).
  for (const c of ACCESS_LIST_EDITS) answers.set(c, () => ({ ...refused(), view: NO_VIEW }));
  answers.set(IPC.liveWindow.list, () => ({ ok: false, reason: 'unlisted', message: words() }));
  answers.set(IPC.liveWindow.access, () => null);
  answers.set(IPC.liveLink.stop, () => null);
  answers.set(IPC.liveLink.last, () => null);
  answers.set(IPC.zoom.open, () => null);
  // A running order's printing (alpha.22) answers as the manual's does: not cancelled, in words.
  for (const c of [IPC.playlists.printRunningOrder, IPC.playlists.saveRunningOrderPdf])
    answers.set(c, () => ({ ...refused(), cancelled: false }));
  return answers;
}
