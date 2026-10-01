import type { LayerName } from '../../../shared/engine/state';
import { isLayerEmpty } from '../../../shared/engine/state';
import type { OperatorAction } from '../../../shared/keymap';
import { shortcutText } from '../../../shared/keymap';
import { useEngine } from '../engine/engine-store';
import { dispatch } from './actions';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import type { Icon } from '../ui/icons';
import {
  Eraser,
  Image,
  Layers,
  MessageSquare,
  Music,
  RotateCcw,
  Stamp,
  Sticker,
  Square,
  Type,
} from '../ui/icons';
import { Kbd } from '../ui/Kbd';

/*
 * Along the bottom: Clear all, a clear for each layer, and black-out. A
 * layer's clear is lit while that layer has something on the screens (a
 * dot, its edge in the live colour, and "on screen" read out) and dimmed
 * when there is nothing to clear.
 */

const clears: { action: OperatorAction; layer: LayerName; label: string; icon: Icon }[] = [
  { action: 'clearSlide', layer: 'slide', label: 'Slide', icon: Type },
  { action: 'clearBackground', layer: 'background', label: 'Background', icon: Image },
  { action: 'clearProps', layer: 'props', label: 'Props', icon: Sticker },
  { action: 'clearMessages', layer: 'messages', label: 'Messages', icon: MessageSquare },
  { action: 'clearAudio', layer: 'audio', label: 'Audio', icon: Music },
  { action: 'clearMasks', layer: 'masks', label: 'Masks', icon: Layers },
];

export function LayerBar({ platform, run }: { platform: string; run: (action: OperatorAction) => void }) {
  const layers = useEngine((s) => s.state?.layers);
  const blackout = useEngine((s) => s.state?.blackout ?? false);
  const logo = useEngine((s) => s.state?.logo ?? null);
  const canPutBack = useEngine((s) => s.state?.canPutBack ?? false);
  const anything = layers ? clears.some((c) => !isLayerEmpty(layers, c.layer)) : false;
  return (
    <div
      className="flex shrink-0 items-center gap-2 overflow-x-auto border-t border-line bg-panel px-3 py-2"
      data-testid="layer-bar"
    >
      <Button
        variant="primary"
        size="lg"
        icon={Eraser}
        kbd={shortcutText('clearAll', platform)}
        disabled={!anything}
        onClick={() => {
          run('clearAll');
        }}
      >
        Clear all
      </Button>
      {canPutBack && (
        <Button
          variant="warning"
          size="lg"
          icon={RotateCcw}
          data-testid="put-back"
          onClick={() => void dispatch({ type: 'putBack' })}
        >
          Put it back
        </Button>
      )}
      <div role="group" aria-label="Clear one layer" className="flex items-center gap-1.5">
        {clears.map((c) => {
          const on = layers ? !isLayerEmpty(layers, c.layer) : false;
          const IconShape = c.icon;
          return (
            <button
              key={c.layer}
              type="button"
              disabled={!on}
              data-lit={on ? 'true' : undefined}
              onClick={() => {
                run(c.action);
              }}
              aria-label={`Clear ${c.label.toLowerCase()}${on ? ' (on screen)' : ''}`}
              className={cx(
                'relative inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors',
                on
                  ? 'border-live bg-panel-2 text-fg hover:bg-panel-3'
                  : 'cursor-not-allowed border-line bg-transparent text-faint',
              )}
            >
              <IconShape size={16} aria-hidden="true" />
              {c.label}
              <Kbd>{shortcutText(c.action, platform)}</Kbd>
              {on && (
                <span aria-hidden="true" className="absolute top-1 right-1 h-2 w-2 rounded-full bg-live" />
              )}
            </button>
          );
        })}
      </div>
      <span className="flex-1" />
      <Button
        variant={logo ? 'live' : 'secondary'}
        size="lg"
        icon={Stamp}
        aria-pressed={logo !== null}
        kbd={shortcutText('toggleLogo', platform)}
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
        icon={Square}
        aria-pressed={blackout}
        kbd={shortcutText('toggleBlackout', platform)}
        onClick={() => {
          run('toggleBlackout');
        }}
        data-testid="blackout-button"
      >
        {blackout ? 'Black-out is on' : 'Black-out'}
      </Button>
    </div>
  );
}
