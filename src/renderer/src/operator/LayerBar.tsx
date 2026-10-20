import { useWhatIsThis } from '../help/WhatIsThis';
import type { LayerName } from '../../../shared/engine/state';
import { isLayerEmpty } from '../../../shared/engine/state';
import type { OperatorAction } from '../../../shared/keymap';
import { shortcutText } from '../../../shared/keymap';
import { practiceKey, useShowState } from '../practice/practice-store';
import { useKeymapNow } from './single-keys-store';
import { dispatch } from './actions';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import type { Icon } from '../ui/icons';
import {
  BlackOut,
  Eraser,
  Image,
  Layers,
  MessageSquare,
  Music,
  RotateCcw,
  ScrollText,
  Stamp,
  Sticker,
  Type,
} from '../ui/icons';
import { Kbd } from '../ui/Kbd';
import { Tooltip } from '../ui/Tooltip';

/*
 * Along the bottom: Clear all, a clear for each layer, and black-out. A
 * layer's clear is lit while that layer has something on the screens (a
 * dot, its edge in the live colour, and "on screen" read out) and dimmed
 * when there is nothing to clear. Its key (F2 to F8) is on the button from
 * 1440 px wide, and in its tooltip at any width. Right after Clear all,
 * Put it back takes Clear all's place (nothing is left to clear then), so
 * the bar keeps its width and fits at 1280 px. Every one changes in the same
 * frame as the screens, with no colour fade (Session 25). Logo and
 * Black-out say they are on in words ("Black-out is on"), read out once:
 * no aria-pressed besides.
 */

const clears: { action: OperatorAction; layer: LayerName; label: string; icon: Icon }[] = [
  { action: 'clearSlide', layer: 'slide', label: 'Slide', icon: Type },
  { action: 'clearBackground', layer: 'background', label: 'Background', icon: Image },
  { action: 'clearProps', layer: 'props', label: 'Props', icon: Sticker },
  { action: 'clearMessages', layer: 'messages', label: 'Messages', icon: MessageSquare },
  { action: 'clearTicker', layer: 'ticker', label: 'Ticker', icon: ScrollText },
  { action: 'clearAudio', layer: 'audio', label: 'Audio', icon: Music },
  { action: 'clearMasks', layer: 'masks', label: 'Masks', icon: Layers },
];

export function LayerBar({ platform, run }: { platform: string; run: (action: OperatorAction) => void }) {
  // The show, or the practice show while it is on (Session 26g).
  const state = useShowState();
  // The keys beside its buttons, as they act now: none for Black-out or the Logo while B, . and L are off.
  const keymap = useKeymapNow();
  const layers = state?.layers;
  const blackout = state?.blackout ?? false;
  const logo = state?.logo ?? null;
  const canPutBack = state?.canPutBack ?? false;
  // A lower third up counts too (Session 44): Clear all takes it off with the rest.
  const anything = layers
    ? clears.some((c) => !isLayerEmpty(layers, c.layer)) || layers.lowerThird !== null
    : false;
  // What is this? (Sessions 31–36): its ? in the bar, its words just above it, in the flow (never over a button).
  const help = useWhatIsThis('controls');
  return (
    <>
      {help.card && <div className="shrink-0 border-t border-line pt-2">{help.card}</div>}
      <section
        aria-label="Show controls"
        className="flex shrink-0 items-center gap-2 overflow-x-auto border-t border-line bg-panel px-3 py-2"
        data-testid="layer-bar"
        data-zone="bar"
      >
        {/* Put it back takes Clear all's place while it is offered: right after Clear all, with nothing left to clear. */}
        {canPutBack ? (
          <Button
            variant="warning"
            size="lg"
            instant
            icon={RotateCcw}
            data-testid="put-back"
            onClick={() => {
              if (!practiceKey('putBack')) void dispatch({ type: 'putBack' });
            }}
          >
            Put it back
          </Button>
        ) : (
          // A strong secondary (Session 26g): in a show the one primary is Next, under LIVE.
          <Button
            variant="strong"
            size="lg"
            instant
            icon={Eraser}
            kbd={shortcutText('clearAll', platform, keymap)}
            disabled={!anything}
            onClick={() => {
              run('clearAll');
            }}
          >
            Clear all
          </Button>
        )}
        <div role="group" aria-label="Clear one layer" className="flex items-center gap-1.5">
          {clears.map((c) => {
            const on = layers ? !isLayerEmpty(layers, c.layer) : false;
            const IconShape = c.icon;
            return (
              <Tooltip
                key={c.layer}
                content={`Clear ${c.label.toLowerCase()}`}
                kbd={shortcutText(c.action, platform, keymap)}
                describes={false}
              >
                <button
                  type="button"
                  disabled={!on}
                  data-lit={on ? 'true' : undefined}
                  data-show-control
                  onClick={() => {
                    run(c.action);
                  }}
                  aria-label={`Clear ${c.label.toLowerCase()}${on ? ' (on screen)' : ''}`}
                  className={cx(
                    'relative inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium',
                    // Session 44: a lit one's fill and an unlit one's edge in the appearance's own (Black and
                    // White: the raised surface and a divider, as before); lit, LIVE's red edge and dot.
                    on
                      ? 'border-live bg-layer text-fg hover:bg-panel-3'
                      : 'cursor-not-allowed border-layer-edge bg-transparent text-faint',
                  )}
                >
                  <IconShape size={16} aria-hidden="true" />
                  {c.label}
                  <span className="hidden min-[1440px]:contents">
                    <Kbd>{shortcutText(c.action, platform, keymap)}</Kbd>
                  </span>
                  {on && (
                    <span
                      aria-hidden="true"
                      className="absolute top-1 right-1 h-2 w-2 rounded-full bg-live"
                    />
                  )}
                </button>
              </Tooltip>
            );
          })}
        </div>
        <span className="flex-1" />
        {help.button}
        <Button
          variant={logo ? 'live' : 'secondary'}
          size="lg"
          instant
          icon={Stamp}
          kbd={shortcutText('toggleLogo', platform, keymap)}
          onClick={() => {
            run('toggleLogo');
          }}
          data-testid="logo-button"
        >
          {logo ? 'Logo is on' : 'Logo'}
        </Button>
        <Button
          variant={blackout ? 'live' : 'secondary'}
          size="lg"
          instant
          icon={BlackOut}
          kbd={shortcutText('toggleBlackout', platform, keymap)}
          onClick={() => {
            run('toggleBlackout');
          }}
          data-testid="blackout-button"
        >
          {blackout ? 'Black-out is on' : 'Black-out'}
        </Button>
      </section>
    </>
  );
}
