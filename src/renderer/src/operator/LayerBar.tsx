import { useWhatIsThis } from '../help/WhatIsThis';
import { isLayerEmpty } from '../../../shared/engine/state';
import type { OperatorAction } from '../../../shared/keymap';
import { shortcutText } from '../../../shared/keymap';
import { practiceKey, useShowState } from '../practice/practice-store';
import { useKeymapNow } from './single-keys-store';
import { dispatch } from './actions';
import type { ClearedLayer } from './layer-clears';
import { LAYER_CLEARS } from './layer-clears';
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
 * when there is nothing to clear. The clears go in the order of their keys,
 * F2 to F8 (Session 51: layer-clears.ts). Every button shows its key at every
 * width (Session 51): a clear's under its word, its icon beside them from
 * 1280 px wide; and below 1440 px Clear all's, the Logo's and Black-out's are
 * under their words too, a size smaller, so the bar fits a 1024-wide window
 * (CI's, and the smallest Drashti allows) in every state, the Logo and
 * Black-out on and Put it back offered; from 1440 px those three have their
 * key beside their words, as before. Right after Clear all, Put it back
 * takes Clear all's place (nothing is left to clear then). Every one changes
 * in the same frame as the screens, with no colour fade (Session 25). Logo
 * and Black-out say they are on in words ("Black-out is on"), read out once:
 * no aria-pressed besides.
 */

const icons: Record<ClearedLayer, Icon> = {
  slide: Type,
  background: Image,
  props: Sticker,
  audio: Music,
  messages: MessageSquare,
  ticker: ScrollText,
  masks: Layers,
};

/** Clear all's, the Logo's and Black-out's size below 1440 px, a size smaller, their keys under their words. */
const SMALLER_BELOW_1440 = 'max-[1440px]:gap-1.5 max-[1440px]:px-3 max-[1440px]:text-sm';

/**
 * A bar button's words with its key under them (Session 51), or, `beside` from 1440 px, after them as before.
 * No key (Black-out with the single-letter keys off), the words alone.
 */
function WordsAndKey({ words, kbd, beside = false }: { words: string; kbd: string; beside?: boolean }) {
  return (
    <span className={cx('flex flex-col items-center', beside && 'min-[1440px]:flex-row min-[1440px]:gap-3')}>
      {words}
      {kbd && <Kbd>{kbd}</Kbd>}
    </span>
  );
}

export function LayerBar({ platform, run }: { platform: string; run: (action: OperatorAction) => void }) {
  // The show, or the practice show while it is on (Session 26g).
  const state = useShowState();
  // The keys on its buttons, as they act now: none for Black-out while B, . and L are off; the Logo keeps F12
  // (Session 50).
  const keymap = useKeymapNow();
  const key = (action: OperatorAction) => shortcutText(action, platform, keymap);
  const layers = state?.layers;
  const blackout = state?.blackout ?? false;
  const logo = state?.logo ?? null;
  const canPutBack = state?.canPutBack ?? false;
  // A lower third up counts too (Session 44), and the picture-in-picture box (Session 50): Clear all takes them
  // off with the rest.
  const anything = layers
    ? LAYER_CLEARS.some((c) => !isLayerEmpty(layers, c.layer)) ||
      layers.lowerThird !== null ||
      layers.pip !== null
    : false;
  // What is this? (Sessions 31–36): its ? in the bar, its words just above it, in the flow (never over a button).
  const help = useWhatIsThis('controls');
  return (
    <>
      {help.card && <div className="shrink-0 border-t border-line pt-2">{help.card}</div>}
      {/* It scrolls sideways only in a window narrower than Drashti allows (larger text): a last guard. */}
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
            className={SMALLER_BELOW_1440}
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
            className={SMALLER_BELOW_1440}
            disabled={!anything}
            onClick={() => {
              run('clearAll');
            }}
          >
            <WordsAndKey words="Clear all" kbd={key('clearAll')} beside />
          </Button>
        )}
        <div role="group" aria-label="Clear one layer" className="flex items-center gap-1.5">
          {LAYER_CLEARS.map((c) => {
            const on = layers ? !isLayerEmpty(layers, c.layer) : false;
            const IconShape = icons[c.layer];
            return (
              <Tooltip
                key={c.layer}
                content={`Clear ${c.label.toLowerCase()}`}
                kbd={key(c.action)}
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
                    // Wide enough that the lit dot keeps clear of the key under the shortest word.
                    'relative inline-flex h-10 min-w-14 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2 text-sm font-medium min-[1280px]:px-3',
                    // Session 44: a lit one's fill and an unlit one's edge in the appearance's own (Black and
                    // White: the raised surface and a divider, as before); lit, LIVE's red edge and dot.
                    on
                      ? 'border-live bg-layer text-fg hover:bg-panel-3'
                      : 'cursor-not-allowed border-layer-edge bg-transparent text-faint',
                  )}
                >
                  <IconShape size={16} aria-hidden="true" className="hidden shrink-0 min-[1280px]:block" />
                  <WordsAndKey words={c.label} kbd={key(c.action)} />
                  {/* Beside its key, in the corner its word leaves free. */}
                  {on && (
                    <span
                      aria-hidden="true"
                      className="absolute right-1 bottom-1 h-2 w-2 rounded-full bg-live"
                    />
                  )}
                </button>
              </Tooltip>
            );
          })}
        </div>
        {/* The ? and the two covers at the far end. */}
        <span className="ml-auto flex">{help.button}</span>
        <Button
          variant={logo ? 'live' : 'secondary'}
          size="lg"
          instant
          icon={Stamp}
          className={SMALLER_BELOW_1440}
          onClick={() => {
            run('toggleLogo');
          }}
          data-testid="logo-button"
        >
          <WordsAndKey words={logo ? 'Logo is on' : 'Logo'} kbd={key('toggleLogo')} beside />
        </Button>
        <Button
          variant={blackout ? 'live' : 'secondary'}
          size="lg"
          instant
          icon={BlackOut}
          className={SMALLER_BELOW_1440}
          onClick={() => {
            run('toggleBlackout');
          }}
          data-testid="blackout-button"
        >
          <WordsAndKey
            words={blackout ? 'Black-out is on' : 'Black-out'}
            kbd={key('toggleBlackout')}
            beside
          />
        </Button>
      </section>
    </>
  );
}
