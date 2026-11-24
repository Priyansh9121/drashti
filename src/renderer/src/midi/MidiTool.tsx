import { create } from 'zustand';
import { MidiDialog } from './MidiDialog';

/*
 * The MIDI controller's window (Session 44: it was the Macros panel's, and Macros are gone): a pad, a keyboard or a
 * foot switch mapped to Next, Back, Clear all, Black-out and the Wallpaper (the Logo went in Session 55). Its button is
 * in its own section under LIVE (alpha.22; More tools' before), and the menu bar's Tools menu opens it too (Session
 * 60, x36), with that section folded: so the window is the operator window's own (MidiDialogHost), not the section's.
 */

/** Whether the MIDI controller's window is open. */
const useMidiDialog = create<{ open: boolean }>(() => ({ open: false }));

/** Open the MIDI controller's window (its section's button, or Tools › MIDI Controller…). */
export function openMidiDialog(): void {
  useMidiDialog.setState({ open: true });
}

/** The MIDI controller's window, wherever it was asked for. */
export function MidiDialogHost() {
  const open = useMidiDialog((s) => s.open);
  return open ? (
    <MidiDialog
      onClose={() => {
        useMidiDialog.setState({ open: false });
      }}
    />
  ) : null;
}
