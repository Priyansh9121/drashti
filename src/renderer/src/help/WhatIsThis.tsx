import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { PanelHelpId } from '../../../shared/panel-help';
import { PANEL_HELP } from '../../../shared/panel-help';
import { useMode } from '../operator/mode-store';
import { Button } from '../ui/Button';

/*
 * "What is this?" (Session 25): a small ? on a panel's heading opens two or three plain sentences
 * under it, in the panel's own space, so it never covers the show controls (and never takes the
 * show's keys: it is a button, a paragraph and Got it). The words are in shared/panel-help.ts.
 */

/** The ? for a heading, and the words it opens under it (both null without a topic). */
export function useWhatIsThis(topic: PanelHelpId | null): { button: ReactNode; card: ReactNode } {
  const [open, setOpen] = useState(false);
  const id = useId();
  const opener = useRef<HTMLButtonElement>(null);
  // Pro Mode's: Simple Mode (which shows the live picture too) keeps to its big buttons.
  const simple = useMode((s) => s.mode === 'simple');
  if (topic === null || simple) return { button: null, card: null };
  const help = PANEL_HELP[topic];
  const close = () => {
    setOpen(false);
    opener.current?.focus();
  };
  const button = (
    <button
      ref={opener}
      type="button"
      aria-label={`What is this? ${help.title}`}
      title={`What is this? ${help.title}`}
      aria-expanded={open}
      aria-controls={open ? id : undefined}
      data-testid={`what-is-this-${topic}`}
      onClick={() => {
        setOpen(!open);
      }}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-field text-xs font-bold text-muted hover:border-muted hover:text-fg"
    >
      ?
    </button>
  );
  const card = open && (
    <div
      id={id}
      role="note"
      aria-label={`What is this? ${help.title}`}
      data-testid="what-is-this"
      className="mx-3 mb-2 rounded-md border border-line-strong bg-panel-2 px-3 py-2 text-sm text-fg"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        close();
      }}
    >
      <p id={`${id}-text`}>{help.text}</p>
      <div className="mt-2 flex justify-end">
        <Button size="sm" autoFocus aria-describedby={`${id}-text`} onClick={close}>
          Got it
        </Button>
      </div>
    </div>
  );
  return { button, card };
}
