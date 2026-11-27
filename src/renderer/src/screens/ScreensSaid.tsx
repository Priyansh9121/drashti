import { useEffect } from 'react';
import { create } from 'zustand';
import { SET_UP_STAGE } from '../../../shared/screen-switches';
import { useScreenSwitches } from '../operator/screen-switches-store';
import type { ScreensSaid } from '../../../shared/screens';
import { saidShort } from '../../../shared/screens';
import { saidTips } from '../../../shared/screens-said';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { Info, Monitor, MonitorOff, Settings, Tv, X } from '../ui/icons';
import { Tooltip } from '../ui/Tooltip';

/*
 * Screens that set themselves (Session 55; Priyansh, 29 Oct 2026: a display plugged in had to be set up by hand).
 * A display plugged in is used at once by the main process (outputs/auto-screens.ts), and the window says what it
 * did in one line: "“PLACEHOLDER PJ” shows the audience picture." with Change…, which opens Screens at that display
 * (one click there gives it another job, remembered by the display). Once, too, how to extend when the computer
 * mirrors its screen onto the projector. In Pro Mode and Simple Mode alike (Simple Mode changes no screen: no
 * Change… there). Since alpha.22 it also says when Stage goes on with no screen set to Stage, with Set up Stage
 * screen… (Pro Mode), which opens Screens at the first display that could take the job. It stays until closed or
 * followed by another.
 *
 * In the status bar (alpha.24, lead 2's screensaid; the release lead's rules), just before the access line's place:
 * until then it came in the window's flow under the top bar, and the whole window under it, the LIVE picture, Back,
 * Next, Oops and every column, moved some 50 px down as it came. In the status bar it takes its room only from the
 * bar's passing news, so nothing in the window or the bar moves as it comes or goes, and it is never over a control.
 * Its words in sight are a few, whole (saidShort), so that it and the access line ("No access list") both show at
 * 1024 × 645; it never shrinks (the bar's other words do first: a missing screen matters more during a show). The
 * whole line is the tooltip of its words and icon, and what a screen reader reads, politely, as it comes (its place is
 * a status region, there always); each button has its own tooltip, on the mouse or keyboard focus (saidTips: the
 * action button says what it does, the X "Dismiss: " and the line; alpha.25 item 40, done in saidwords).
 *
 * After the release lead's review (27 Nov 2026): Stage's line says Stage is on with no Stage screen, so it closes as
 * Stage goes off (it had stayed, beside Stage off saying the opposite, and at 1024 × 645 with Audience off too the bar
 * ran some 30 px past the window's edge). And with Audience off, whose item takes the most room in the bar, the line's
 * words give way in a window under 1280 px wide (its icon and buttons stay; the whole line is still its tooltip and
 * read out), so the bar's items fit in every mix of Audience, Stage, the line and the access line (the sweep in
 * screens-said-still.spec.ts): on the lines that keep an action button (Pro Mode's Stage line and set lines, whose
 * button still says what to do) and on Simple Mode's set lines (news only: the screens set themselves up). Stage's line
 * in Simple Mode and mirroring in both modes keep their words (saidwords, lead 2's (C)): the warnings that matter, an
 * icon and an X alone saying nothing; measured, they fit at 1024 × 645 with Audience off.
 */

interface SaidView {
  said: ScreensSaid | null;
  /** The last one closed (or followed by Change…), so a window that reads it again shows it no more. */
  closedId: number;
}

export const useScreensSaid = create<SaidView>(() => ({ said: null, closedId: 0 }));

let started = false;

/** Follow what the screens say (once per page): what was said before the window opened, then each new one. */
export function connectScreensSaid(): void {
  if (started) return;
  started = true;
  let heard = false;
  window.drashti.screens.onSaid((said) => {
    heard = true;
    useScreensSaid.setState({ said });
  });
  void window.drashti.screens.lastSaid().then((said) => {
    if (!heard && said) useScreensSaid.setState({ said });
  });
}

function close(id: number): void {
  useScreensSaid.setState({ said: null, closedId: id });
  // Not said again as the window opens again (a reload).
  void window.drashti.screens.saidClosed(id);
}

/**
 * The line's place in the status bar, with the line while there is one; Change… and Set up Stage screen… where the
 * screens can be changed (Pro Mode: `onChange`).
 */
export function ScreensSaidNotice({ onChange }: { onChange: ((displayId: number) => void) | null }) {
  const said = useScreensSaid((s) => s.said);
  const closedId = useScreensSaid((s) => s.closedId);
  // Stage off, once the main process has said which are on.
  const stageOff = useScreenSwitches((s) => s.known && !s.switches.stage);
  useEffect(() => {
    connectScreensSaid();
  }, []);
  // Stage's line no longer true with Stage off: not shown, and closed (so a reload does not bring it back).
  const untrue = said?.kind === 'no-stage' && stageOff;
  const shown = said && said.id > closedId && !untrue ? said : null;
  useEffect(() => {
    if (said && untrue && said.id > closedId) close(said.id);
  }, [said, untrue, closedId]);
  return (
    // With nothing said it takes no room (its gap is the line's own margin).
    <div role="status" className="flex shrink-0 items-center" data-testid="screens-said-place">
      {shown && <SaidLine said={shown} onChange={onChange} />}
    </div>
  );
}

/** Each kind's icon: Stage's as the bar's Stage off has it. */
const ICONS = { 'no-stage': MonitorOff, set: Monitor, mirroring: Info } as const;

function SaidLine({ said, onChange }: { said: ScreensSaid; onChange: ((displayId: number) => void) | null }) {
  const first = said.displayIds[0];
  // Audience off (its item the bar's widest): below 1280 px wide the words give way to the icon and buttons, on a set
  // line and on Pro Mode's Stage line (with Set up Stage screen…); Simple's Stage line and mirroring keep them.
  const audienceOff = useScreenSwitches((s) => s.known && !s.switches.audience);
  const givesWay =
    said.kind === 'set' || (said.kind === 'no-stage' && onChange !== null && first !== undefined);
  // No Stage screen in the bar's warning look, as Stage off's beside it; a display set up or mirroring as news.
  const warning = said.kind === 'no-stage';
  const IconShape = ICONS[said.kind];
  const changeTo = (id: number) => {
    close(said.id);
    onChange?.(id);
  };
  // Each part its own tooltip (alpha.25 item 40, done in saidwords): the words the whole line, each button what it does,
  // the X Dismiss with the line. Their words are in the line already for screen readers: the tooltips only show them.
  const tips = saidTips(said);
  return (
    <div
      data-testid="screens-said"
      data-kind={said.kind}
      className={cx(
        'mr-3 flex h-6 shrink-0 items-center gap-1.5 rounded-sm pl-1.5 whitespace-nowrap',
        warning ? 'bg-warning-bg text-warning-fg' : 'bg-panel-2 text-fg',
      )}
    >
      {/* The icon and, in sight, the short words (the icon alone where they give way); read out, the whole line. */}
      <Tooltip content={tips.words} describes={false}>
        <span className="flex items-center gap-1.5">
          <IconShape size={13} aria-hidden="true" className={cx('shrink-0', !warning && 'text-accent')} />
          <span
            aria-hidden="true"
            className={cx(audienceOff && givesWay && 'max-[1280px]:hidden')}
            data-testid="screens-said-short"
          >
            {saidShort(said)}
          </span>
        </span>
      </Tooltip>
      <span className="sr-only" data-testid="screens-said-text">
        {said.text}
      </span>
      {onChange && said.kind === 'set' && first !== undefined && (
        <Tooltip content={tips.action} describes={false}>
          <Button
            size="sm"
            icon={Settings}
            className="h-6!"
            data-testid="screens-said-change"
            onClick={() => {
              changeTo(first);
            }}
          >
            Change…
          </Button>
        </Tooltip>
      )}
      {onChange && said.kind === 'no-stage' && first !== undefined && (
        <Tooltip content={tips.action} describes={false}>
          <Button
            size="sm"
            icon={Tv}
            className="h-6!"
            data-testid="screens-said-set-up-stage"
            onClick={() => {
              changeTo(first);
            }}
          >
            {SET_UP_STAGE}
          </Button>
        </Tooltip>
      )}
      {/* 24 × 24 (WCAG 2.5.8), as the notices' own. */}
      <Tooltip content={tips.dismiss} describes={false}>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => {
            close(said.id);
          }}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm hover:bg-black/20"
        >
          <X size={13} aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
  );
}
