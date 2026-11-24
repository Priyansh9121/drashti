import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import type { LowerThirdLayer } from '../../../../shared/engine/state';
import { animationById, animationLength } from '../../../../shared/lower-third-animations';
import type { LowerThirdInput } from '../../../../shared/lower-thirds';
import { engineNow } from '../../render/clock';
import { LowerThirdView, outAnimationOf, unitCount } from '../../render/LowerThirdView';
import { ScreenPictures } from '../../render/picture-looks';
import { useElementSize } from '../../render/useElementSize';
import { WallpaperView } from '../../render/WallpaperView';
import { cx } from '../../ui/cx';
import type { Backdrop, BackdropDraw } from './backdrop';

/*
 * The studio's live preview (Session 55, Part 16): the lower third being made, drawn by the very component the
 * screens use, over its backdrop (./backdrop.ts, alpha.22: the hall's wallpaper as the screens draw it, Live's still
 * of what the screens show now, or plain), at 16:9 and as wide as the window gives it. It plays in, holds
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

const FULL: CSSProperties = { position: 'absolute', inset: 0 };

/** The hall's wallpaper, with its pictures' looks as the screens have them (render/NothingUp.tsx draws it so). */
function WallpaperBehind({ draw }: { draw: Extract<BackdropDraw, { kind: 'wallpaper' }> }) {
  const looks = useMemo(() => ({ pictures: draw.pictures, liveZoom: null }), [draw.pictures]);
  return (
    <div data-testid="studio-backdrop-wallpaper" style={FULL}>
      <ScreenPictures.Provider value={looks}>
        <WallpaperView wallpaper={draw.wallpaper} />
      </ScreenPictures.Provider>
    </div>
  );
}

/** What is behind the lower third. */
function Behind({ draw }: { draw: BackdropDraw }) {
  switch (draw.kind) {
    case 'wallpaper':
      return <WallpaperBehind draw={draw} />;
    case 'live':
      return (
        <img
          data-testid="studio-live-picture"
          data-live-source={draw.picture.source}
          src={draw.picture.url}
          alt=""
          draggable={false}
          style={{ ...FULL, width: '100%', height: '100%', objectFit: 'contain' }}
        />
      );
    case 'plain':
      return draw.words === undefined ? null : (
        <p
          data-testid="studio-backdrop-words"
          className="absolute inset-x-0 top-[12%] px-4 text-center text-sm"
          style={{ color: '#d1d5db' }}
        >
          {draw.words}
        </p>
      );
  }
}

export function StudioPreview({
  input,
  play,
  backdrop,
  backdropName,
  className,
  thumbnail,
  paused = false,
}: {
  input: LowerThirdInput;
  play: number;
  backdrop: BackdropDraw;
  /** The backdrop chosen (Behind the preview), said by the preview for tests. */
  backdropName?: Backdrop;
  className?: string;
  /** A template tile is still until hovered or focused, then plays once. */
  thumbnail?: 'play' | 'still';
  paused?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(box);
  const canvas = { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round((width * 9) / 16)) };
  const [layer, setLayer] = useState<LowerThirdLayer | null>(null);
  const [off, setOff] = useState<{ layer: LowerThirdLayer; at: number } | null>(null);
  const [round, setRound] = useState(0);
  const [played, setPlayed] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const lines = input.lines.some((l) => l.trim() !== '') ? input.lines : SAMPLE;
  // Asked to play (`play` changed), or round again: up from now. Typing a line or changing a colour changes it in place.
  const pausedOrIdle = paused || thumbnail === 'still';
  const key = pausedOrIdle ? null : String(play) + '/' + String(round);
  if (played !== key) {
    setPlayed(key);
    setOff(null);
    setFinished(false);
    setLayer(key === null ? null : { id: 'preview', ...input, lines, shownAt: engineNow() });
  }
  // Held a moment once in, then out; then round again.
  useEffect(() => {
    if (!layer) return;
    const a = animationById(layer.animation);
    let hold = HOLD_MS;
    if (thumbnail === 'play') hold = 700;
    else if ((layer.look.motion ?? 'none') !== 'none') hold = HOLD_MOVING_MS;
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
  }, [layer, thumbnail]);
  useEffect(() => {
    if (!off) return;
    const a = outAnimationOf(off.layer);
    const again = window.setTimeout(
      () => {
        if (thumbnail === 'play') setFinished(true);
        else setRound((n) => n + 1);
      },
      animationLength(a, 'out', unitCount(off.layer.lines, a)) + (thumbnail === 'play' ? 0 : GAP_MS),
    );
    return () => {
      window.clearTimeout(again);
    };
  }, [off, thumbnail]);
  // The words and look as they are now, while it is up.
  const still = pausedOrIdle || finished;
  const animation = animationById(input.animation);
  const frozenAt = still ? animationLength(animation, 'in', unitCount(lines, animation)) + 700 : undefined;
  const now = still ? { id: 'preview', ...input, lines, shownAt: 0 } : layer && { ...layer, ...input, lines };
  const going = !still && off ? { ...off, layer: { ...off.layer, ...input, lines } } : null;
  return (
    <div
      ref={box}
      aria-hidden="true"
      data-a11y-picture
      data-testid={thumbnail ? undefined : 'lower-third-preview'}
      data-playing={!thumbnail && (layer || off) ? 'true' : undefined}
      data-template-preview={thumbnail ? '' : undefined}
      data-preview-playing={thumbnail === 'play' && !finished ? 'true' : undefined}
      data-backdrop={backdropName}
      className={cx(
        'relative w-full overflow-hidden',
        !thumbnail && 'rounded-md border border-line',
        className,
      )}
      style={{ aspectRatio: '16 / 9', background: backdrop.kind === 'plain' ? backdrop.colour : '#000000' }}
    >
      <Behind draw={backdrop} />
      {width > 0 && (
        <LowerThirdView
          layer={now}
          off={going}
          frozenAt={frozenAt}
          canvas={canvas}
          place={input.where === 'stream' ? 'stream' : 'hall'}
        />
      )}
    </div>
  );
}
