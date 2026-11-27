import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { parseMarkdown, passagesOf } from '../../../shared/markdown';
import type { PanelHelp, PanelHelpId } from '../../../shared/panel-help';
import { PANEL_HELP } from '../../../shared/panel-help';
import { useMode } from '../operator/mode-store';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { useHelp } from './help-store';
import { showManual } from './manual-store';

/*
 * "What is this?" (Session 25): a small ? on a panel's heading opens two or three plain sentences
 * under it, in the panel's own space, so it never covers the show controls (and never takes the
 * show's keys: it is a button, a paragraph, Open the manual and Got it). The words are in shared/panel-help.ts.
 * Open the manual (x37, Session 60: the owner's "Yes, A" to Q60-25; Read more, which opened Help › Guides, until
 * then) opens the Drashti Manual at the panel's chapter, its feature marked; Esc closes the manual, and the show's
 * keys work again at once. Since alpha.24 (help-store.ts, the owner's "non-congusted UI") every ? is drawn only while
 * the status bar's Help switch is on: off, there is none at all, so none is a Tab stop either.
 */

/** Open the manual at the chapter a card names, at its feature (or the chapter's start, if the feature is gone). */
async function openManual(help: PanelHelp): Promise<void> {
  const read = await window.drashti.manual.read();
  const text = read.ok ? read.chapters.find((c) => c.id === help.chapter)?.text : undefined;
  const passage =
    text === undefined
      ? null
      : (passagesOf(parseMarkdown(text)).find((p) => p.heading && p.text === help.feature)?.id ?? null);
  showManual({ chapter: help.chapter, passage });
}

/** The ?'s size: the header's smaller (`compact`), every other 24 px. Its room, held with Help off, is the same. */
const askSize = (compact: boolean) => (compact ? 'h-5 w-5' : 'h-6 w-6');

/**
 * The ? for a heading, and the words it opens under it (both null without a topic, in Simple Mode or with Help off).
 * `keepRoom` (a panel's heading, ui/Panel.tsx): with Help off, an empty box of the ?'s size holds its place, never a
 * button or a Tab stop and hidden from screen readers, so a heading that wraps with the ? wraps the same without it,
 * and turning Help on or off moves nothing under it (the release lead's decision after lead 2's helpmenu hands-on:
 * the Timers heading's ? sent Calendar and New timer to a second row, and every section below moved).
 */
export function useWhatIsThis(
  topic: PanelHelpId | null,
  {
    compact = false,
    keepRoom = false,
  }: {
    /** A smaller ? (the header's, where room is short). */
    compact?: boolean;
    /** Hold the ?'s room while Help is off (Pro Mode only, as the ? is). */
    keepRoom?: boolean;
  } = {},
): { button: ReactNode; card: ReactNode } {
  // Open in the turning on of Help it was opened in (its count, help-store.ts): Help off and on again finds it shut.
  const [openIn, setOpenIn] = useState<number | null>(null);
  const id = useId();
  const opener = useRef<HTMLButtonElement>(null);
  // Pro Mode's: Simple Mode (Pro Mode's window with less in it, Session 55, Part 18) has no ? of its own.
  const simple = useMode((s) => s.mode === 'simple');
  const on = useHelp((s) => s.on);
  const round = useHelp((s) => s.round);
  if (topic === null || simple) return { button: null, card: null };
  if (!on)
    return {
      button: keepRoom ? (
        <span
          aria-hidden="true"
          data-what-is-this-room=""
          className={cx('inline-block shrink-0', askSize(compact))}
        />
      ) : null,
      card: null,
    };
  const help = PANEL_HELP[topic];
  const open = openIn === round;
  const setOpen = (now: boolean) => {
    setOpenIn(now ? round : null);
  };
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
        askSize(compact),
        compact ? 'text-[11px]' : 'text-xs',
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
          data-testid="what-is-this-manual"
          onClick={() => {
            void openManual(help);
          }}
        >
          Open the manual
        </Button>
        <Button size="sm" autoFocus aria-describedby={`${id}-text`} onClick={close}>
          Got it
        </Button>
      </div>
    </div>
  );
  return { button, card };
}
