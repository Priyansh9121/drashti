import { useEffect, useState } from 'react';
import { SCREEN_RECORDING_STEPS, type OfferedWindow } from '../../../shared/live-window';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { Dialog } from '../ui/Dialog';
import { AppWindow, RotateCw, Settings } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { radioKeys, radioTabIndex } from '../ui/radio';
import { EmptyState } from '../ui/States';
import { Truncate } from '../ui/Truncate';
import { closeWindowPicker, refreshWindows, useLiveWindowUi } from './live-window-store';

/*
 * Show a Window… (Session 48): another app's open windows, each by name with a small live picture, to show
 * one live on the hall's screens (a Zoom meeting's, say). Never a whole display, never Drashti's own (the
 * main process lists only the others), and nothing goes up until Show on the screens. On a Mac that has
 * not let Drashti see the screen, it says why first and opens System Settings at Screen Recording.
 */

/** How often the small pictures are taken again while the picker is open. */
const PICTURES_MS = 2000;

function WindowChoice({
  window: w,
  chosen,
  index,
  anyChosen,
  choose,
}: {
  window: OfferedWindow;
  chosen: boolean;
  index: number;
  anyChosen: boolean;
  choose: (id: string) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={chosen}
      tabIndex={radioTabIndex(chosen, index, anyChosen)}
      data-testid="window-choice"
      data-name={w.name}
      onClick={() => {
        choose(w.id);
      }}
      className={cx(
        'flex min-w-0 flex-col gap-1.5 rounded-lg border p-1.5 text-left text-sm',
        chosen ? 'border-accent bg-panel-3 font-bold text-fg' : 'border-line bg-panel-2 text-muted',
      )}
    >
      <span
        className="relative block aspect-video w-full overflow-hidden rounded-md bg-black"
        data-a11y-picture
      >
        {w.picture && (
          <img src={w.picture} alt="" className="absolute inset-0 h-full w-full object-contain" />
        )}
      </span>
      <Truncate text={w.name} className="min-w-0 px-0.5" />
    </button>
  );
}

export function WindowPicker() {
  const picking = useLiveWindowUi((s) => s.picking);
  const list = useLiveWindowUi((s) => s.list);
  const [chosen, setChosen] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const windows = list?.ok ? list.windows : null;
  // The pictures stay live while it is open (and the list follows windows opened and closed meanwhile).
  useEffect(() => {
    if (!picking) return;
    const timer = setInterval(() => {
      void refreshWindows();
    }, PICTURES_MS);
    return () => {
      clearInterval(timer);
    };
  }, [picking]);
  if (!picking) return null;
  const close = () => {
    setChosen(null);
    setProblem(null);
    closeWindowPicker();
  };
  const ids = windows?.map((w) => w.id) ?? [];
  const current = chosen !== null && ids.includes(chosen) ? chosen : null;
  const show = async () => {
    if (current === null) return;
    const result = await window.drashti.liveWindow.show(current);
    if (result.ok) close();
    else setProblem(result.message);
  };
  return (
    <Dialog
      title="Show a Window"
      subtitle="Another app’s window, live on the hall’s screens and the stream: a Zoom meeting, say. Nothing goes up until you press Show on the screens."
      onClose={close}
      closeLabel="Close Show a Window"
      size="lg"
      testId="window-picker"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            icon={AppWindow}
            data-testid="window-show"
            disabled={current === null}
            onClick={() => void show()}
          >
            Show on the screens
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {problem && (
          <Notice tone="danger" compact>
            {problem}
          </Notice>
        )}
        {list === null ? (
          <p className="text-sm text-muted">Looking for open windows…</p>
        ) : !list.ok && list.reason === 'permission' ? (
          <Notice
            tone="info"
            title="Let Drashti see other apps’ windows"
            data-testid="window-permission"
            actions={
              <>
                <Button
                  variant="primary"
                  size="sm"
                  icon={Settings}
                  data-testid="window-open-settings"
                  onClick={() => void window.drashti.liveWindow.access()}
                >
                  Open System Settings
                </Button>
                <Button size="sm" icon={RotateCw} onClick={() => void refreshWindows()}>
                  Look again
                </Button>
              </>
            }
          >
            {list.message} {SCREEN_RECORDING_STEPS}
          </Notice>
        ) : !list.ok ? (
          <Notice tone="warning" compact>
            {list.message}
          </Notice>
        ) : list.windows.length === 0 ? (
          <EmptyState
            icon={AppWindow}
            title="No other app has a window open"
            compact
            data-testid="window-none"
            action={
              <Button size="sm" icon={RotateCw} onClick={() => void refreshWindows()}>
                Look again
              </Button>
            }
          >
            Open it first (in Zoom, join the meeting), then look again.
          </EmptyState>
        ) : (
          <div
            role="radiogroup"
            aria-label="Open windows"
            className="grid grid-cols-3 gap-2"
            onKeyDown={radioKeys(ids, current ?? ids[0] ?? '', setChosen)}
          >
            {list.windows.map((w, i) => (
              <WindowChoice
                key={w.id}
                window={w}
                chosen={w.id === current}
                index={i}
                anyChosen={current !== null}
                choose={setChosen}
              />
            ))}
          </div>
        )}
        <p className="text-xs text-muted">
          Drashti sends no sound from it: the meeting’s sound reaches the hall through the mixer, as now.
        </p>
      </div>
    </Dialog>
  );
}
