import type { AudioOutputStatus } from '../shared/audio';
import type { InvokeChannel } from '../shared/ipc';
import { IPC } from '../shared/ipc';
import { SIMPLE_MODE_REFUSAL } from '../shared/mode';

/*
 * What Simple Mode locks. Every request that would change the library, the
 * playlists, props, messages, timers, themes, the screens or the sound is
 * refused in the main process while Simple Mode is on (the window does not
 * offer them either); backup and restore leave the menu. Running the show
 * (the engine's commands), reading the library and saving diagnostics stay.
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
  IPC.screens.createGroup,
  IPC.screens.renameGroup,
  IPC.screens.setGroupRole,
  IPC.screens.setGroupLanguages,
  IPC.screens.deleteGroup,
  IPC.screens.assignDisplay,
  IPC.screens.updateScreen,
  IPC.screens.removeScreen,
  IPC.audio.setOutput,
];

/** Each locked channel's answer: a refusal in its own result's shape. */
export function simpleModeRefusals(sound: () => AudioOutputStatus): Map<InvokeChannel, () => unknown> {
  const answers = new Map<InvokeChannel, () => unknown>(SIMPLE_MODE_LOCKED.map((c) => [c, refused]));
  // These answer in shapes of their own: no files picked, and the sound output as it is.
  answers.set(IPC.library.pickImportPaths, () => []);
  answers.set(IPC.audio.setOutput, sound);
  return answers;
}
