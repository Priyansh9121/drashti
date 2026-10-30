import { useEffect, useRef, useState } from 'react';
import type { LowerThirdLayer } from '../../../../shared/engine/state';
import { animationById, animationLength } from '../../../../shared/lower-third-animations';
import type { LowerThirdInput } from '../../../../shared/lower-thirds';
import { engineNow } from '../../render/clock';
import { LowerThirdView, outAnimationOf, unitCount } from '../../render/LowerThirdView';
import { useElementSize } from '../../render/useElementSize';
import { cx } from '../../ui/cx';

/*
 * The studio's live preview (Session 55, Part 16): the lower third being made, drawn by the very component the
 * screens use, over a backdrop like the hall's picture, at 16:9 and as wide as the window gives it. It plays in, holds
 * a moment (longer with a moving background, which moves meanwhile), plays out, and comes round again; a change of
 * words or look shows at once, and choosing an animation plays it from the start (`play`). Hidden from screen
 * readers: the choices beside it say what it shows. A picture of the screens: its colours are the lower third's own.
 */

/** How long it stays up between its in and its out; with a moving background, long enough to see it move. */
const HOLD_MS = 1500;
const HOLD_MOVING_MS = 3500;
/** The pause before it comes round again. */
const GAP_MS = 700;

/** Words for a lower third with none yet. */
const SAMPLE = ['Placeholder name', 'Placeholder title', 'Placeholder place'];

export type Backdrop = 'dark' | 'light' | 'picture';
export const BACKDROPS: readonly Backdrop[] = ['dark', 'light', 'picture'];
export const BACKDROP_NAMES: Record<Backdrop, string> = { dark: 'Dark', light: 'Light', picture: 'Picture' };
const BACKDROP_CSS: Record<Backdrop, string> = {
  dark: '#1f2937',
  light: '#e5e7eb',
  picture: 'linear-gradient(160deg, #1e3a5f 0%, #6b4f2a 55%, #c2410c 100%)',
};

export function StudioPreview({
  input,
  play,
  backdrop,
  className,
}: {
  input: LowerThirdInput;
  play: number;
  backdrop: Backdrop;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(box);
  const canvas = { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round((width * 9) / 16)) };
  const [layer, setLayer] = useState<LowerThirdLayer | null>(null);
  const [off, setOff] = useState<{ layer: LowerThirdLayer; at: number } | null>(null);
  const [round, setRound] = useState(0);
  const [played, setPlayed] = useState<string | null>(null);
  const lines = input.lines.some((l) => l.trim() !== '') ? input.lines : SAMPLE;
  // Asked to play (`play` changed), or round again: up from now. Typing a line or changing a colour changes it in place.
  const key = `${String(play)}/${String(round)}`;
  if (played !== key) {
    setPlayed(key);
    setOff(null);
    setLayer({ id: 'preview', ...input, lines, shownAt: engineNow() });
  }
  // Held a moment once in, then out; then round again.
  useEffect(() => {
    if (!layer) return;
    const a = animationById(layer.animation);
    const hold = (layer.look.motion ?? 'none') === 'none' ? HOLD_MS : HOLD_MOVING_MS;
    const out = window.setTimeout(
      () => {
        setLayer(null);
        setOff({ layer, at: engineNow() });
      },
      animationLength(a, 'in', unitCount(layer.lines, a)) + hold,
    );
    return () => {
      window.clearTimeout(out);
    };
  }, [layer]);
  useEffect(() => {
    if (!off) return;
    const a = outAnimationOf(off.layer);
    const again = window.setTimeout(
      () => {
        setRound((n) => n + 1);
      },
      animationLength(a, 'out', unitCount(off.layer.lines, a)) + GAP_MS,
    );
    return () => {
      window.clearTimeout(again);
    };
  }, [off]);
  // The words and look as they are now, while it is up.
  const now = layer ? { ...layer, ...input, lines } : null;
  const going = off ? { ...off, layer: { ...off.layer, ...input, lines } } : null;
  return (
    <div
      ref={box}
      aria-hidden="true"
      data-a11y-picture
      data-testid="lower-third-preview"
      data-playing={layer || off ? 'true' : undefined}
      className={cx('relative w-full overflow-hidden rounded-md border border-line', className)}
      style={{ aspectRatio: '16 / 9', background: BACKDROP_CSS[backdrop] }}
    >
      {width > 0 && (
        <LowerThirdView
          layer={now}
          off={going}
          canvas={canvas}
          place={input.where === 'stream' ? 'stream' : 'hall'}
        />
      )}
    </div>
  );
}
