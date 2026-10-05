import type { AudioOutputStatus } from '../shared/audio';
import type { InvokeChannel } from '../shared/ipc';
import { IPC } from '../shared/ipc';
import { SIMPLE_MODE_REFUSAL } from '../shared/mode';

/*
 * What Simple Mode locks. Every request that would change the library, the
 * playlists, props, messages, timers, themes, the screens or the sound is
 * refused in the main process while Simple Mode is on (the window does not
 * offer them either), and so is starting, ending or changing the stream,
 * and turning the local network on or off or changing its devices;
 * backup and restore leave the menu. Running the show
 * (the engine's commands, except switching the Look: see
 * SIMPLE_MODE_REFUSED_COMMANDS), reading the library and saving diagnostics stay.
 */

const refused = () => ({ ok: false as const, message: SIMPLE_MODE_REFUSAL });

export const SIMPLE_MODE_LOCKED: readonly InvokeChannel[] = [
  IPC.library.saveWords,
  IPC.library.newFromWords,
  IPC.library.saveSlides,
  IPC.library.setDefaultTransition,
  IPC.library.restoreRevision,
  IPC.library.importPaths,
  IPC.library.pickImportPaths,
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
  IPC.playlists.addItems,
  IPC.playlists.moveItems,
  IPC.playlists.removeItems,
  IPC.playlists.restoreItems,
  IPC.playlists.fillPlaceholder,
  IPC.playlists.setItemOrder,
  IPC.playlists.renameHeader,
  IPC.playlists.saveAsTemplate,
  IPC.playlists.newFromTemplate,
  IPC.playlists.addSlot,
  IPC.props.save,
  IPC.props.remove,
  IPC.props.setLogo,
  IPC.themes.save,
  IPC.themes.remove,
  IPC.themes.apply,
  IPC.themes.fromPresentation,
  IPC.themes.fromSlide,
  IPC.messages.create,
  IPC.messages.update,
  IPC.messages.remove,
  IPC.timers.create,
  IPC.timers.update,
  IPC.timers.remove,
  // Looks: Simple Mode keeps the live one (the engine refuses setLook) and changes none.
  IPC.looks.create,
  IPC.looks.rename,
  IPC.looks.remove,
  IPC.looks.move,
  IPC.looks.setGroup,
  IPC.stageLayouts.save,
  IPC.masks.save,
  IPC.masks.remove,
  IPC.shastra.setTheme,
  IPC.playlists.editSlot,
  IPC.playlists.setTimers,
  IPC.shastra.remove,
  // The arti: Simple Mode answers the prompt (put up, not now, cancel) and changes no schedule.
  IPC.arti.save,
  IPC.arti.setEnabled,
  IPC.arti.remove,
  // Calendars: loading one is an import (locked above); removing one is locked too.
  IPC.calendar.remove,
  // The idle rotation: Simple Mode changes neither its pictures nor its quotes.
  IPC.idle.saveSettings,
  IPC.idle.saveQuote,
  IPC.idle.removeQuote,
  // Macros: Simple Mode runs none (MIDI mapped to its own actions still works), and changes none.
  IPC.macros.save,
  IPC.macros.remove,
  IPC.macros.run,
  IPC.midi.set,
  IPC.stageLayouts.remove,
  IPC.screens.createGroup,
  IPC.screens.renameGroup,
  IPC.screens.setGroupRole,
  IPC.screens.setGroupLanguages,
  IPC.screens.deleteGroup,
  IPC.screens.assignDisplay,
  IPC.screens.updateScreen,
  IPC.screens.removeScreen,
  IPC.audio.setOutput,
  IPC.setup.finish,
  IPC.setup.setSeen,
  // The stream: Simple Mode shows ON AIR and REC, and can neither start, end nor change it.
  IPC.stream.setLayout,
  IPC.stream.saveProfile,
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
  IPC.media.cancelConversion,
  IPC.media.undoConversion,
  IPC.network.setOn,
  IPC.network.setPort,
  IPC.network.startPairing,
  IPC.network.cancelPairing,
  IPC.network.renameDevice,
  IPC.network.revokeDevice,
  IPC.network.makePoster,
  // Output nodes (Session 13): Simple Mode sees the dashboard and Identify, and changes nothing:
  // no pairing, removing, renaming, assigning, copying everything or reloading an output.
  IPC.nodes.startPairing,
  IPC.nodes.cancelPairing,
  IPC.nodes.rename,
  IPC.nodes.remove,
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
  // Updates (Session 14): Simple Mode never sees them.
  IPC.updates.check,
  IPC.updates.download,
  IPC.updates.cancel,
  IPC.updates.setInstallOnQuit,
  IPC.updates.setAutoCheck,
  IPC.updates.showFile,
  // Roles (Session 14): Simple Mode sets no PIN and unlocks nothing; leaving it takes a PIN (app:set-mode).
  IPC.roles.setPins,
  IPC.roles.changePin,
  IPC.roles.turnOff,
  IPC.roles.unlock,
  // The announcements queue: Simple Mode never approves, edits, rejects or takes one off.
  IPC.announcements.edit,
  IPC.announcements.approve,
  IPC.announcements.reject,
  IPC.announcements.takeOff,
];

/** Each locked channel's answer: a refusal in its own result's shape. */
export function simpleModeRefusals(sound: () => AudioOutputStatus): Map<InvokeChannel, () => unknown> {
  const answers = new Map<InvokeChannel, () => unknown>(SIMPLE_MODE_LOCKED.map((c) => [c, refused]));
  // These answer in shapes of their own: no files picked, and the sound output as it is.
  answers.set(IPC.library.pickImportPaths, () => []);
  answers.set(IPC.audio.setOutput, sound);
  return answers;
}
