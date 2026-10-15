import { useId } from 'react';
import { cx } from './cx';

/*
 * Drashti's mark, the lamp (Session 26g): the flame on its plum tile, drawn from build/icon.svg,
 * the one source every icon is made from (src/main/mark.test.ts keeps these the same). Beside the
 * name in the header, Simple Mode and the phone pages; lit once on the first start; and unlit, with
 * one wisp of smoke on arrival, in empty places. Decoration only: hidden from screen readers.
 */

/** The drawing's parts, as in build/icon.svg (the tile's rect is drawn as a rect). */
export const MARK = {
  tile: { x: 100, y: 100, width: 824, height: 824, rx: 185 },
  flame: 'M512 172C566 288 690 414 690 552A178 178 0 0 1 334 552C334 414 458 288 512 172Z',
  core: 'M512 404C538 458 594 512 594 584A82 82 0 0 1 430 584C430 512 486 458 512 404Z',
  bowl: 'M262 690H762C750 792 644 852 512 852C380 852 274 792 262 690Z',
  colours: {
    tile: ['#5e1b52', '#2a0b27'],
    flame: ['#ff7a2f', '#ffc23d'],
    core: '#fff3c4',
    bowl: ['#ffd36b', '#ef9b33'],
    bowlEdge: '#370f32',
  },
} as const;

/** The gradients, with ids of their own so two marks on a page never share them. */
function Paints({ id }: { id: string }) {
  const c = MARK.colours;
  return (
    <defs>
      <linearGradient id={`${id}-tile`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={c.tile[0]} />
        <stop offset="1" stopColor={c.tile[1]} />
      </linearGradient>
      <linearGradient id={`${id}-flame`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={c.flame[0]} />
        <stop offset="1" stopColor={c.flame[1]} />
      </linearGradient>
      <linearGradient id={`${id}-bowl`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={c.bowl[0]} />
        <stop offset="1" stopColor={c.bowl[1]} />
      </linearGradient>
      <radialGradient id={`${id}-halo`} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#ffb070" stopOpacity="0.4" />
        <stop offset="0.45" stopColor="#ff8a50" stopOpacity="0.18" />
        <stop offset="1" stopColor="#ff8a50" stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

/** The mark: the flame on its plum tile, with the lamp's light softly behind it. */
export function Mark({ size = 24, className }: { size?: number; className?: string }) {
  const id = useId();
  return (
    <span
      className={cx('mark-halo relative inline-grid shrink-0 place-items-center', className)}
      aria-hidden="true"
    >
      <svg width={size} height={size} viewBox="100 100 824 824" className="relative block" data-mark="">
        <Paints id={id} />
        <rect {...MARK.tile} fill={`url(#${id}-tile)`} />
        <path d={MARK.flame} fill={`url(#${id}-flame)`} />
        <path d={MARK.core} fill={MARK.colours.core} />
        <path
          d={MARK.bowl}
          fill={`url(#${id}-bowl)`}
          stroke={MARK.colours.bowlEdge}
          strokeWidth={30}
          paintOrder="stroke"
        />
      </svg>
    </span>
  );
}

/** The name with the mark beside it, as headers show it. */
export function WordMark({ children = 'Drashti', size = 24 }: { children?: string; size?: number }) {
  return (
    <span className="flex items-center gap-2.5">
      <Mark size={size} />
      <span>{children}</span>
    </span>
  );
}

/**
 * The lamp lit on the first start, in parts that light in turn (the bowl, a spark, the flame from
 * the wick, its core, the halo): `lamp-lights` in app.css moves them once, over --dur-light; with
 * reduced motion it is simply lit.
 */
export function LitLamp({ size = 96, className }: { size?: number; className?: string }) {
  const id = useId();
  return (
    <svg
      width={size * 1.7}
      height={size * 1.25}
      viewBox="-60 40 1144 1000"
      aria-hidden="true"
      className={cx('lamp-lit overflow-visible', className)}
      data-testid="lit-lamp"
    >
      <Paints id={id} />
      <circle className="lamp-halo" cx="512" cy="470" r="470" fill={`url(#${id}-halo)`} />
      <rect className="lamp-bowl" {...MARK.tile} fill={`url(#${id}-tile)`} />
      <path className="lamp-flame" d={MARK.flame} fill={`url(#${id}-flame)`} />
      <path className="lamp-core" d={MARK.core} fill={MARK.colours.core} />
      <circle className="lamp-spark" cx="512" cy="640" r="26" fill={MARK.colours.core} />
      <path
        className="lamp-bowl"
        d={MARK.bowl}
        fill={`url(#${id}-bowl)`}
        stroke={MARK.colours.bowlEdge}
        strokeWidth={30}
        paintOrder="stroke"
      />
    </svg>
  );
}

/**
 * The unlit lamp of an empty place: the bowl and its wick, and one wisp of smoke as it arrives (`wisp`:
 * it is arriving; a place there since the window opened has no smoke).
 */
export function UnlitLamp({
  size = 64,
  className,
  wisp = true,
}: {
  size?: number;
  className?: string;
  wisp?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="240 470 544 410"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={22}
      strokeLinejoin="round"
      strokeLinecap="round"
      className={cx('text-faint', className)}
      data-testid="unlit-lamp"
    >
      <path d={MARK.bowl} />
      <path d="M512 690V626" />
      {wisp && <path className="lamp-wisp" d="M512 600c-22-24 22-40 0-70" strokeWidth={14} opacity={0.6} />}
    </svg>
  );
}
