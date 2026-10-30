import type { ReactNode } from 'react';
import { useWhatIsThis } from '../help/WhatIsThis';
import { isLayerEmpty } from '../../../shared/engine/state';
import type { OperatorAction } from '../../../shared/keymap';
import { shortcutText, SIMPLE_KEYMAP } from '../../../shared/keymap';
import { practiceKey, useShowState } from '../practice/practice-store';
import { useKeymapNow } from './single-keys-store';
import { dispatch } from './actions';
import type { ClearedLayer } from './layer-clears';
import { LAYER_CLEARS } from './layer-clears';
import { cx } from '../ui/cx';
import type { Icon } from '../ui/icons';
import {
  BlackOut,
  Eraser,
  Image,
  MessageSquare,
  Music,
  RotateCcw,
  ScrollText,
  Type,
  Wallpaper,
} from '../ui/icons';
import { Kbd } from '../ui/Kbd';
import { Tooltip } from '../ui/Tooltip';

/*
 * Along the bottom (Session 55, Part 13: smaller, one row): Clear all F1, a clear for each layer in the order of
 * their keys (Slide F2, Background F3, Audio F5, Messages F6, Ticker F7: layer-clears.ts; F4 and F8 went with Props
 * and Masks and do nothing), then the Wallpaper F12 (in the Logo's place: the chosen wallpaper up instead of the
 * picture, black with none chosen: Part 6's wallpapers, under the playlists) and Black-out B. Each button is one line, its words with its key
 * beside them, 32 px tall, so the bar fits one row from 1008 px wide (Windows' smallest; CI's window is 1024 × 645) in
 * every state, both covers on and Put it back offered, and Part 8's quick bar has room above it. Its icons, and a
 * little more room, show from 1280 px wide. What is up shows at a glance: a clear is lit while its layer has something
 * on the screens (LIVE's red edge and a dot, and "on screen" read out) and dimmed, not pressable, while it has nothing;
 * the Wallpaper and Black-out turn LIVE's red while on, saying so in words ("Black-out is on", read out once, no
 * aria-pressed besides), and are dimmed while off, pressable all the same. Right after Clear all, Put it back takes
 * Clear all's place (nothing is left to clear then). Every one changes in the same frame as the screens, with no colour
 * fade (Session 25).
 *
 * Simple Mode's (Session 55, Part 18: Pro Mode's window with only what a one-projector sabha needs) is the same bar
 * with Clear all (and Put it back after it), the Wallpaper and Black-out alone; its dimmed Clear all stays a stop of
 * the Tab key's (Part 13's answer: a volunteer's Tab order never changes).
 */

const icons: Record<ClearedLayer, Icon> = {
  slide: Type,
  background: Image,
  audio: Music,
  messages: MessageSquare,
  ticker: ScrollText,
};

/** A button's words with its key beside them, in one line; no key (turned off) shows the words alone. */
function WordsAndKey({ words, keyText }: { words: string; keyText: string }) {
  return (
    <>
      <span>{words}</span>
      {keyText !== '' && <Kbd>{keyText}</Kbd>}
    </>
  );
}

/** The bar's buttons' one shape: 32 px tall, its icon (and a little more room) from 1280 px wide. */
const BAR_BUTTON =
  'relative inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-md border px-2 text-sm font-medium whitespace-nowrap min-[1280px]:gap-1.5 min-[1280px]:px-2.5';
/** Nothing of it up: dimmed (Session 55), its edge the appearance's own (Session 44: Black and White's divider). */
const DIMMED = 'border-layer-edge bg-transparent text-faint';
/** Its layer up: lit, as LIVE's edge. */
const LIT = 'border-live bg-layer text-fg hover:bg-panel-3';
/** A cover on (the Wallpaper, Black-out): LIVE's red. */
const ON = 'border-live bg-live text-white hover:brightness-110';

function BarIcon({ shape }: { shape: Icon }) {
  const IconShape = shape;
  return <IconShape size={15} aria-hidden="true" className="hidden shrink-0 min-[1280px]:block" />;
}

/** The Wallpaper or Black-out: on in LIVE's red, saying so in words; off, dimmed and pressable. */
function CoverButton({
  on,
  words,
  onWords,
  keyText,
  icon,
  testId,
  onClick,
}: {
  on: boolean;
  words: string;
  onWords: string;
  keyText: string;
  icon: Icon;
  testId: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-show-control
      data-testid={testId}
      data-lit={on ? 'true' : undefined}
      data-dimmed={on ? undefined : 'true'}
      onClick={onClick}
      className={cx(BAR_BUTTON, on ? ON : cx(DIMMED, 'hover:bg-panel-2 hover:text-fg'))}
    >
      <BarIcon shape={icon} />
      <WordsAndKey words={on ? onWords : words} keyText={keyText} />
    </button>
  );
}

export function LayerBar({
  platform,
  run,
  simple = false,
}: {
  platform: string;
  run: (action: OperatorAction) => void;
  /** Simple Mode's: Clear all, the Wallpaper and Black-out only, with its own test ids. */
  simple?: boolean;
}) {
  // The show, or the practice show while it is on (Session 26g).
  const state = useShowState();
  // The keys on its buttons, as they act now: none for Black-out while B, . and ? are off; the Wallpaper keeps F12.
  const keymap = useKeymapNow(simple ? SIMPLE_KEYMAP : undefined);
  const key = (action: OperatorAction) => shortcutText(action, platform, keymap);
  const layers = state?.layers;
  const blackout = state?.blackout ?? false;
  const wallpaper = state?.wallpaper ?? false;
  const canPutBack = state?.canPutBack ?? false;
  // A lower third up counts too (Session 44), and the picture-in-picture box (Session 50), and a timer for the
  // audience (Session 55): Clear all takes them off with the rest.
  const anything = layers
    ? LAYER_CLEARS.some((c) => !isLayerEmpty(layers, c.layer)) ||
      layers.lowerThird !== null ||
      layers.pip !== null ||
      (layers.timer ?? null) !== null
    : false;
  // What is this? (Sessions 31–36): its ? in the bar, its words just above it, in the flow (never over a button).
  const help = useWhatIsThis('controls');
  const clearAll: ReactNode = canPutBack ? (
    // Put it back takes Clear all's place while it is offered: right after Clear all, with nothing left to clear.
    <button
      type="button"
      data-show-control
      data-testid={simple ? 'simple-put-back' : 'put-back'}
      data-variant="warning"
      onClick={() => {
        if (!practiceKey('putBack')) void dispatch({ type: 'putBack' });
      }}
      className={cx(BAR_BUTTON, 'border-warning bg-warning-bg text-warning-fg hover:border-warning-fg')}
    >
      <RotateCcw size={15} aria-hidden="true" className="shrink-0" />
      <span>Put it back</span>
    </button>
  ) : (
    // A strong secondary (Session 26g): in a show the one primary is Next, under LIVE. Dimmed with nothing up.
    <button
      type="button"
      data-show-control
      data-variant="strong"
      data-testid={simple ? 'simple-clear-all' : undefined}
      // Simple Mode's stays a Tab stop, dimmed (Part 13's answer); Pro Mode's is not pressable.
      disabled={!simple && !anything}
      aria-disabled={simple && !anything ? true : undefined}
      data-dimmed={anything ? undefined : 'true'}
      onClick={() => {
        if (anything) run('clearAll');
      }}
      className={cx(
        BAR_BUTTON,
        anything
          ? 'border-primary-edge bg-panel-2 font-semibold text-fg hover:bg-panel-3'
          : cx(DIMMED, 'cursor-not-allowed'),
      )}
    >
      <BarIcon shape={Eraser} />
      <WordsAndKey words="Clear all" keyText={key('clearAll')} />
    </button>
  );
  return (
    <>
      {help.card && <div className="shrink-0 border-t border-line pt-2">{help.card}</div>}
      {/* It scrolls sideways only in a window narrower than Drashti allows (larger text): a last guard. */}
      <section
        aria-label="Show controls"
        className="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-line bg-panel px-3 py-1 min-[1280px]:gap-1.5"
        data-testid={simple ? 'simple-buttons' : 'layer-bar'}
        data-zone="bar"
      >
        {clearAll}
        {!simple && (
          <div
            role="group"
            aria-label="Clear one layer"
            className="flex items-center gap-1 min-[1280px]:gap-1.5"
          >
            {LAYER_CLEARS.map((c) => {
              const on = layers ? !isLayerEmpty(layers, c.layer) : false;
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
                    // Wide enough that the lit dot keeps clear of its key.
                    className={cx(BAR_BUTTON, 'pr-3.5', on ? LIT : cx(DIMMED, 'cursor-not-allowed'))}
                  >
                    <BarIcon shape={icons[c.layer]} />
                    <WordsAndKey words={c.label} keyText={key(c.action)} />
                    {/* In the corner beside its key. */}
                    {on && (
                      <span
                        aria-hidden="true"
                        className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-live"
                      />
                    )}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        )}
        {/* The ? and the two covers at the far end. */}
        <span className="ml-auto flex">{help.button}</span>
        <CoverButton
          on={wallpaper}
          words="Wallpaper"
          onWords="Wallpaper is on"
          keyText={key('toggleWallpaper')}
          icon={Wallpaper}
          testId={simple ? 'simple-wallpaper' : 'wallpaper-button'}
          onClick={() => {
            run('toggleWallpaper');
          }}
        />
        <CoverButton
          on={blackout}
          words="Black-out"
          onWords="Black-out is on"
          keyText={key('toggleBlackout')}
          icon={BlackOut}
          testId={simple ? 'simple-blackout' : 'blackout-button'}
          onClick={() => {
            run('toggleBlackout');
          }}
        />
      </section>
    </>
  );
}
