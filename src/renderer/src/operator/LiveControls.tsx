import type { LayerName } from '../../../shared/engine/state';
import { isLayerEmpty } from '../../../shared/engine/state';
import { useEngine } from '../engine/engine-store';
import { Button } from '../ui/Button';
import type { OperatorAction } from './keymap';
import { shortcutText } from './keymap';

const clears: { action: OperatorAction; layer: LayerName; label: string }[] = [
  { action: 'clearSlide', layer: 'slide', label: 'Slide' },
  { action: 'clearBackground', layer: 'background', label: 'Background' },
  { action: 'clearProps', layer: 'props', label: 'Props' },
  { action: 'clearMessages', layer: 'messages', label: 'Messages' },
  { action: 'clearAudio', layer: 'audio', label: 'Audio' },
  { action: 'clearMasks', layer: 'masks', label: 'Masks' },
];

function Kbd({ children }: { children: string }) {
  // Inherits the button's text colour, so it stays readable on every button tone.
  return <kbd className="ml-2 rounded border border-current px-1 text-[10px] opacity-60">{children}</kbd>;
}

export function LiveControls({ platform, run }: { platform: string; run: (action: OperatorAction) => void }) {
  const layers = useEngine((s) => s.state?.layers);
  const blackout = useEngine((s) => s.state?.blackout ?? false);
  const anything = layers ? clears.some((c) => !isLayerEmpty(layers, c.layer)) : false;
  return (
    <div className="space-y-3">
      <Button
        tone={blackout ? 'live' : 'default'}
        aria-pressed={blackout}
        onClick={() => {
          run('toggleBlackout');
        }}
        className="w-full py-3 text-base"
        data-testid="blackout-button"
      >
        {blackout ? 'Black-out is ON (screens black)' : 'Black-out'}
        <Kbd>{shortcutText('toggleBlackout', platform)}</Kbd>
      </Button>
      <Button
        tone="primary"
        className="w-full py-2.5"
        disabled={!anything}
        onClick={() => {
          run('clearAll');
        }}
      >
        Clear all
        <Kbd>{shortcutText('clearAll', platform)}</Kbd>
      </Button>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Clear one layer">
        {clears.map((c) => (
          <Button
            key={c.layer}
            disabled={!layers || isLayerEmpty(layers, c.layer)}
            onClick={() => {
              run(c.action);
            }}
            aria-label={`Clear ${c.label.toLowerCase()}`}
          >
            {c.label}
            <Kbd>{shortcutText(c.action, platform)}</Kbd>
          </Button>
        ))}
      </div>
    </div>
  );
}
