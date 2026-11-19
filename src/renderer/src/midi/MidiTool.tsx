import { create } from 'zustand';
import { Button } from '../ui/Button';
import { KeyboardMusic } from '../ui/icons';
import { MidiDialog } from './MidiDialog';

/*
 * The MIDI controller's way in, in More tools (Session 44: it was the Macros panel's, and Macros are gone): a pad,
 * a keyboard or a foot switch mapped to Next, Back, Clear all and Black-out (the Logo went in Session 55). Its window
 * opens from the menu bar's Tools menu too (Session 60, x36), with More tools folded: so the window is the operator
 * window's own (MidiDialogHost), not More tools'.
 */

/** Whether the MIDI controller's window is open. */
const useMidiDialog = create<{ open: boolean }>(() => ({ open: false }));

/** Open the MIDI controller's window (More tools' button, or Tools › MIDI Controller…). */
export function openMidiDialog(): void {
  useMidiDialog.setState({ open: true });
}

export function MidiTool() {
  return (
    <div className="px-6 pt-1 pb-3">
      <Button
        variant="secondary"
        size="sm"
        icon={KeyboardMusic}
        data-testid="open-midi"
        onClick={openMidiDialog}
      >
        MIDI controller…
      </Button>
    </div>
  );
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
