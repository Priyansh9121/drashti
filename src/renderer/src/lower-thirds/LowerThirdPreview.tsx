import { useEffect, useState } from 'react';
import type { LowerThirdLayer } from '../../../shared/engine/state';
import { animationById, animationLength } from '../../../shared/lower-third-animations';
import type { LowerThirdInput } from '../../../shared/lower-thirds';
import { engineNow } from '../render/clock';
import { LowerThirdView, unitCount } from '../render/LowerThirdView';

/*
 * A small picture of a lower third playing its animation (Session 44): in, held a moment, then out, drawn by the
 * very component the screens use. It plays again whenever `play` changes (an animation chosen, or Play again).
 * Hidden from screen readers: the animation's name says what it does. A picture of the screens (as slide
 * previews are): its colours are the lower third's own, and part-way through a move its words are faint.
 */

const CANVAS = { width: 320, height: 180 } as const;
/** How long it stays up between its in and its out. */
const HOLD_MS = 1200;

/** A lower third's words with none: the preview shows these. */
const SAMPLE = ['Placeholder name', 'Placeholder title', 'Placeholder place'];

export function LowerThirdPreview({ input, play }: { input: LowerThirdInput; play: number }) {
  const [layer, setLayer] = useState<LowerThirdLayer | null>(null);
  const [off, setOff] = useState<{ layer: LowerThirdLayer; at: number } | null>(null);
  const [played, setPlayed] = useState<number | null>(null);
  const lines = input.lines.some((l) => l.trim() !== '') ? input.lines : SAMPLE;
  // Asked to play (`play` changed): up from now. Typing a line or changing a colour changes it in place.
  if (played !== play) {
    setPlayed(play);
    setOff(null);
    setLayer({ id: 'preview', ...input, lines, shownAt: engineNow() });
  }
  // Held a moment once in, then out.
  useEffect(() => {
    if (!layer) return;
    const a = animationById(layer.animation);
    const hide = window.setTimeout(
      () => {
        setLayer(null);
        setOff({ layer, at: engineNow() });
      },
      animationLength(a, 'in', unitCount(layer.lines, a)) + HOLD_MS,
    );
    return () => {
      window.clearTimeout(hide);
    };
  }, [layer]);
  // The words and look as they are now, while it is up.
  const now = layer ? { ...layer, ...input, lines } : null;
  return (
    <div
      aria-hidden="true"
      data-a11y-picture
      data-testid="lower-third-preview"
      data-playing={layer || off ? 'true' : undefined}
      className="relative overflow-hidden rounded-md border border-line"
      style={{ width: CANVAS.width, height: CANVAS.height, background: '#1f2937' }}
    >
      <LowerThirdView
        layer={now}
        off={off}
        canvas={CANVAS}
        place={input.where === 'stream' ? 'stream' : 'hall'}
      />
    </div>
  );
}
