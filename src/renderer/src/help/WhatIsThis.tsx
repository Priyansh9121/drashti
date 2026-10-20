import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { passagesHolding } from '../../../shared/guides';
import { parseMarkdown, passagesOf } from '../../../shared/markdown';
import type { PanelHelp, PanelHelpId } from '../../../shared/panel-help';
import { PANEL_HELP } from '../../../shared/panel-help';
import { useMode } from '../operator/mode-store';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { showGuides } from './guides-store';

/*
 * "What is this?" (Session 25): a small ? on a panel's heading opens two or three plain sentences
 * under it, in the panel's own space, so it never covers the show controls (and never takes the
 * show's keys: it is a button, a paragraph, Read more and Got it). The words are in shared/panel-help.ts.
 * Read more (Sessions 31–36) opens Help › Guides at the passage they follow, marked; Esc closes the
 * guides, and the show's keys work again at once.
 */

/** Open the guides at the passage a card follows (or at its guide's start, if the passage is gone). */
async function readMore(help: PanelHelp): Promise<void> {
  const read = await window.drashti.guides.read(help.doc);
  const passage = read.ok
    ? (passagesHolding(passagesOf(parseMarkdown(read.text)), help.guide)[0]?.id ?? null)
    : null;
  showGuides({ guide: help.doc, passage });
}

/** The ? for a heading, and the words it opens under it (both null without a topic). */
export function useWhatIsThis(
  topic: PanelHelpId | null,
  /** A smaller ? (the header's, where room is short). */
  { compact = false }: { compact?: boolean } = {},
): { button: ReactNode; card: ReactNode } {
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
      data-what-is-this=""
      onClick={() => {
        setOpen(!open);
      }}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full border border-field font-bold text-muted hover:border-muted hover:text-fg',
        compact ? 'h-5 w-5 text-[11px]' : 'h-6 w-6 text-xs',
      )}
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
      // Opened by a click, so always arriving (the window has settled by then: ui/motion.ts).
      data-motion="pop"
      className="mx-3 mb-2 rounded-md border border-line-strong bg-panel-2 px-3 py-2 text-sm text-fg"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        close();
      }}
    >
      <p id={`${id}-text`}>{help.text}</p>
      <div className="mt-2 flex justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          data-testid="what-is-this-read-more"
          onClick={() => {
            void readMore(help);
          }}
        >
          Read more
        </Button>
        <Button size="sm" autoFocus aria-describedby={`${id}-text`} onClick={close}>
          Got it
        </Button>
      </div>
    </div>
  );
  return { button, card };
}
