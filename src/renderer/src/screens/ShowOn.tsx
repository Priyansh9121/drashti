import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { describeDisplay } from '../../../shared/display-match';
import type { DisplayInfo } from '../../../shared/screens';
import { displayToOffer } from '../../../shared/setup';
import { useNotice } from '../operator/actions';
import { Button } from '../ui/Button';
import { Monitor } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { connectScreens, useScreens } from './screens-store';

/*
 * One obvious action for the hall's screen (Session 44; Priyansh: "creating a screen shouldnt take this long,
 * make obvious stuff obvious"). While no screen shows the hall's picture yet and a display other than the
 * controls' is connected, the window offers "Show on <its name>": one click makes it the hall's screen with
 * the setup's own defaults (an "Audience" group in the live Look, every language, the screen named after the
 * display), as Set Up Screens… would, and puts the test slide up for a few seconds. "Not now" puts the offer
 * away until the displays change. It sits in the window's flow under the header, never over the show
 * controls, and Start here and the first start's welcome offer the same.
 */

interface OfferState {
  /** The display the controls are on (never offered). */
  controls: number | null;
  /** Offered in this window at all (Pro Mode; tests only when they ask). */
  offer: boolean;
  known: boolean;
  /** The display put away with Not now, until the displays change. */
  notNow: number | null;
}

const useOffer = create<OfferState>(() => ({ controls: null, offer: false, known: false, notNow: null }));

async function readOffer(): Promise<void> {
  const state = await window.drashti.setup.state();
  // The displays changed: what Not now put away is offered again.
  useOffer.setState({ controls: state.controlsDisplayId, offer: state.offer, known: true, notNow: null });
}

/** A display's name, as the offer says it: its own name, or its number when it has none. */
export const displayName = (d: DisplayInfo): string => d.label.trim() || describeDisplay(d);

/** The display offered now (null for none), followed as displays come and go. */
export function useDisplayOffer(): DisplayInfo | null {
  const snapshot = useScreens((s) => s.snapshot);
  const { controls, offer, known } = useOffer();
  const displays = snapshot?.displays.map((d) => String(d.id)).join(' ') ?? '';
  useEffect(() => {
    connectScreens();
    void readOffer();
  }, [displays]);
  if (!snapshot || !known || !offer) return null;
  return displayToOffer(snapshot, controls);
}

/**
 * The display the controls are on (Session 50: Screens marks it where it offers displays), read as Screens opens
 * and again as displays come and go. Not now stays as it was.
 */
export function useControlsDisplay(): number | null {
  const snapshot = useScreens((s) => s.snapshot);
  const controls = useOffer((s) => s.controls);
  const displays = snapshot?.displays.map((d) => String(d.id)).join(' ') ?? '';
  useEffect(() => {
    void window.drashti.setup.state().then((state) => {
      useOffer.setState({ controls: state.controlsDisplayId });
    });
  }, [displays]);
  return controls;
}

/** Show on <display>: it becomes the hall's screen. True when it did. */
export async function showOn(display: DisplayInfo): Promise<boolean> {
  const result = await window.drashti.setup.finish(
    { outputs: [{ displayId: display.id, use: 'audience', languages: null }], sound: 'skip', themeId: null },
    {},
  );
  if (!result.ok) {
    useNotice.setState({ text: result.message });
    return false;
  }
  useScreens.setState({ snapshot: result.snapshot });
  useNotice.setState({
    text: `The hall’s picture now shows on ${displayName(display)}, with a test slide for a few seconds.`,
  });
  return true;
}

/**
 * Show on <its name>: the primary of the offer and the welcome; a secondary in Start here, whose one primary is
 * step 1's Import….
 */
export function ShowOnButton({
  display,
  onShown,
  size = 'md',
  first = false,
  variant = 'primary',
}: {
  display: DisplayInfo;
  onShown?: () => void;
  size?: 'sm' | 'md' | 'lg';
  /** The keyboard starts here (the welcome's one primary). */
  first?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={variant}
      size={size}
      icon={Monitor}
      disabled={busy}
      data-autofocus={first ? true : undefined}
      data-testid="show-on"
      onClick={() => {
        setBusy(true);
        void showOn(display).then((shown) => {
          setBusy(false);
          if (shown) onShown?.();
        });
      }}
    >
      Show on {displayName(display)}
    </Button>
  );
}

/** The offer under the header. */
export function ShowOnOffer() {
  const display = useDisplayOffer();
  const notNow = useOffer((s) => s.notNow);
  if (!display || notNow === display.id) return null;
  return (
    <div className="shrink-0 px-3 pt-2" data-testid="show-on-offer">
      <Notice
        tone="info"
        compact
        role="status"
        actions={
          <>
            <ShowOnButton display={display} />
            <Button
              variant="ghost"
              data-testid="show-on-not-now"
              onClick={() => {
                useOffer.setState({ notNow: display.id });
              }}
            >
              Not now
            </Button>
          </>
        }
      >
        A display is connected ({describeDisplay(display)}), and no screen shows the hall’s picture yet.
      </Notice>
    </div>
  );
}
