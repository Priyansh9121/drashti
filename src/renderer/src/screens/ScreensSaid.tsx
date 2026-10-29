import { useEffect } from 'react';
import { create } from 'zustand';
import type { ScreensSaid } from '../../../shared/screens';
import { Button } from '../ui/Button';
import { Settings } from '../ui/icons';
import { Notice } from '../ui/Notice';

/*
 * Screens that set themselves (Session 55; Priyansh, 29 Oct 2026: a display plugged in had to be set up by hand).
 * A display plugged in is used at once by the main process (outputs/auto-screens.ts), and the window says what it
 * did in one line: "“PLACEHOLDER PJ” shows the audience picture." with Change…, which opens Screens at that display
 * (one click there gives it another job, remembered by the display). Once, too, how to extend when the computer
 * mirrors its screen onto the projector. In Pro Mode and Simple Mode alike (Simple Mode changes no screen: no
 * Change… there). It sits in the window's flow under the header, never over the show controls, until closed or
 * followed by another.
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

/** The line, with Change… where the screens can be changed (Pro Mode: `onChange`). */
export function ScreensSaidNotice({ onChange }: { onChange: ((displayId: number) => void) | null }) {
  const said = useScreensSaid((s) => s.said);
  const closedId = useScreensSaid((s) => s.closedId);
  useEffect(() => {
    connectScreensSaid();
  }, []);
  if (!said || said.id <= closedId) return null;
  const first = said.displayIds[0];
  return (
    <div className="shrink-0 px-3 pt-2" data-testid="screens-said" data-kind={said.kind}>
      <Notice
        tone="info"
        compact
        role="status"
        onDismiss={() => {
          close(said.id);
        }}
      >
        {/* One line: what happened, and Change… beside it (under it only where there is no room). */}
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span data-testid="screens-said-text">{said.text}</span>
          {onChange && said.kind === 'set' && first !== undefined && (
            <Button
              size="sm"
              icon={Settings}
              data-testid="screens-said-change"
              onClick={() => {
                close(said.id);
                onChange(first);
              }}
            >
              Change…
            </Button>
          )}
        </span>
      </Notice>
    </div>
  );
}
