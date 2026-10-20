import { useState } from 'react';
import { Button } from '../ui/Button';
import { KeyboardMusic } from '../ui/icons';
import { MidiDialog } from './MidiDialog';

/*
 * The MIDI controller's way in, in More tools (Session 44: it was the Macros panel's, and Macros are gone): a pad,
 * a keyboard or a foot switch mapped to Next, Back, Clear all, Black-out and the Logo.
 */
export function MidiTool() {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-6 pt-1 pb-3">
      <Button
        variant="secondary"
        size="sm"
        icon={KeyboardMusic}
        data-testid="open-midi"
        onClick={() => {
          setOpen(true);
        }}
      >
        MIDI controller…
      </Button>
      {open && (
        <MidiDialog
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
