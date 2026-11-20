import type { waapi as waapiType } from 'animejs/waapi';
import { useEffect, useRef, useState } from 'react';
import type { MotionKind } from '../../../shared/appearance/appearances';
import { HEADER_MOTIONS, MOTION_KINDS } from '../../../shared/appearance/appearances';
import { movingNow, type MovingNow } from '../../../shared/appearance/moving';
import { useStream } from '../stream/stream-store';
import { duration, easing } from '../ui/motion';

/*
 * A live appearance's moving touch (Session 60, the owner's Q60-36 (3), his motion safety rule "Yes, A" and Q60-45),
 * with Anime.js 4.5.0 in its WAAPI mode (transform and opacity only; loaded the moment a touch first moves, never as
 * the window opens). Two layers, both decoration only (aria-hidden, inert, no pointer events, gone in forced colours):
 * one behind everything in the header (its words, its controls and LIVE's panel stay on top, still), one over the
 * band (which carries no words). The header's touch draws only in the header's colours and the look's touch colour,
 * which rules.ts measures with the header's words and controls (measureMoving), so no word ever loses its contrast.
 * Nothing here is ever on the screens in the hall, the stream, nodes or phones: only the operator window (Pro Mode
 * and Simple Mode) draws it.
 *
 * It moves only when nothing holds it (shared/appearance/moving.ts): Moving: On, interface motion not Off and the
 * computer not set to reduce motion, a graphics chip known to be there, not streaming or recording on a slow
 * computer, the window opened settled and not hidden. Anything that holds it takes the layer away at once and the
 * header and band are as they always were; it comes back by itself, fading in.
 */

/** The touches each kind draws: how many, and where. */
const COUNTS: Readonly<Record<MotionKind, number>> = {
  drift: 1,
  shimmer: 1,
  sparkle: 3,
  glint: 1,
  glow: 1,
  petals: 5,
  puffs: 4,
  rain: 12,
  kites: 3,
  clouds: 3,
};

/**
 * What <html> says (the preload sets it): the look's motions, Moving, interface motion, a slow computer, whether a
 * graphics chip is known to be there (only "yes" lets a touch move: unknown until Chromium has said), opened.
 */
interface RootFacts {
  look: readonly MotionKind[];
  on: boolean;
  interfaceOff: boolean;
  slow: boolean;
  chip: boolean;
  opened: boolean;
}

function rootFacts(): RootFacts {
  const d = document.documentElement.dataset;
  return {
    look: (d['lookMotion'] ?? '')
      .split(' ')
      .filter((k): k is MotionKind => (MOTION_KINDS as readonly string[]).includes(k)),
    on: d['moving'] !== 'off',
    interfaceOff: d['interfaceMotion'] === 'off',
    slow: d['slow'] === 'true',
    chip: d['chip'] === 'yes',
    opened: d['opened'] !== undefined,
  };
}

function useRootFacts(): RootFacts {
  const [facts, setFacts] = useState(rootFacts);
  useEffect(() => {
    const seen = new MutationObserver(() => {
      setFacts((before) => {
        const now = rootFacts();
        return JSON.stringify(now) === JSON.stringify(before) ? before : now;
      });
    });
    seen.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [
        'data-look-motion',
        'data-moving',
        'data-interface-motion',
        'data-chip',
        'data-slow',
        'data-opened',
      ],
    });
    return () => {
      seen.disconnect();
    };
  }, []);
  return facts;
}

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const list = matchMedia(query);
    const changed = () => {
      setMatches(list.matches);
    };
    list.addEventListener('change', changed);
    return () => {
      list.removeEventListener('change', changed);
    };
  }, [query]);
  return matches;
}

function useHidden(): boolean {
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden');
  useEffect(() => {
    const changed = () => {
      setHidden(document.visibilityState === 'hidden');
    };
    document.addEventListener('visibilitychange', changed);
    return () => {
      document.removeEventListener('visibilitychange', changed);
    };
  }, []);
  return hidden;
}

/** Moving now, or what holds the touch still (shared/appearance/moving.ts), with the shown look's motions. */
export function useLookMoving(): { now: MovingNow; look: readonly MotionKind[] } {
  const root = useRootFacts();
  const reduced = useMedia('(prefers-reduced-motion: reduce)');
  const hidden = useHidden();
  const busy = useStream((s) =>
    s.status === null ? false : s.status.live.state !== 'off' || s.status.recording.state !== 'off',
  );
  const now = movingNow({
    look: root.look,
    on: root.on,
    interfaceOff: root.interfaceOff,
    reduced,
    noGpu: !root.chip,
    busy,
    slow: root.slow,
    opened: root.opened,
    hidden,
  });
  return { now, look: root.look };
}

/** Each kind's animations, started on its touches (WAAPI, transform and opacity only). */
type Waapi = typeof waapiType;
type Running = ReturnType<Waapi['animate']>;

function animateKind(waapi: Waapi, kind: MotionKind, touches: HTMLElement[]): Running[] {
  const fade = duration('dur-look-fade');
  const calm = easing('ease-look');
  const steady = easing('ease-look-steady');
  const stagger = duration('stagger-look');
  const all: Running[] = [];
  const each = (f: (el: HTMLElement, i: number) => Running) => {
    touches.forEach((el, i) => all.push(f(el, i)));
  };
  switch (kind) {
    case 'drift':
      // The header's colours drift by one period (the header's width), round and round, after fading in.
      each((el) => waapi.animate(el, { opacity: [0, 1], duration: fade, ease: calm }));
      each((el) =>
        waapi.animate(el, {
          translateX: ['0%', '-33.333%'],
          duration: duration('dur-look-drift'),
          ease: steady,
          loop: true,
        }),
      );
      break;
    case 'shimmer':
    case 'glint':
      // A light passes along the band, then rests: the first quarter of each turn sweeps, the rest waits.
      each((el) =>
        waapi.animate(el, {
          translateX: ['-100%', '700%', '700%', '700%', '700%'],
          opacity: [0, 1, 0, 0, 0],
          duration: duration(kind === 'shimmer' ? 'dur-look-shimmer' : 'dur-look-glint'),
          ease: calm,
          loop: true,
        }),
      );
      break;
    case 'sparkle':
      each((el, i) =>
        waapi.animate(el, {
          opacity: [0, 1, 0, 0],
          scale: [0.6, 1, 0.6, 0.6],
          duration: duration('dur-look-sparkle'),
          delay: i * stagger,
          ease: calm,
          loop: true,
        }),
      );
      break;
    case 'glow':
      each((el) =>
        waapi.animate(el, {
          opacity: [0.35, 0.95, 0.35],
          duration: duration('dur-look-glow'),
          ease: calm,
          loop: true,
        }),
      );
      break;
    case 'petals':
      each((el, i) =>
        waapi.animate(el, {
          translateY: ['-24px', '64px'],
          translateX: ['0px', '48px'],
          rotate: ['0deg', '160deg'],
          opacity: [0, 0.9, 0.9, 0],
          duration: duration('dur-look-petal'),
          delay: i * stagger,
          ease: steady,
          loop: true,
        }),
      );
      break;
    case 'puffs':
      each((el, i) =>
        waapi.animate(el, {
          translateX: ['-10vw', '30vw'],
          opacity: [0, 0.8, 0],
          scale: [0.7, 1.1],
          duration: duration('dur-look-puff'),
          delay: i * stagger,
          ease: calm,
          loop: true,
        }),
      );
      break;
    case 'rain':
      each((el, i) =>
        waapi.animate(el, {
          translateY: ['-24px', '64px'],
          opacity: [0, 0.7, 0],
          duration: duration('dur-look-rain'),
          delay: (i * stagger) / 6,
          ease: steady,
          loop: true,
        }),
      );
      break;
    case 'kites':
      each((el, i) =>
        waapi.animate(el, {
          translateX: ['-8vw', '108vw'],
          translateY: ['0px', '-5px', '0px', '5px', '0px'],
          duration: duration('dur-look-kite'),
          delay: i * stagger * 3,
          ease: steady,
          loop: true,
        }),
      );
      break;
    case 'clouds':
      each((el, i) =>
        waapi.animate(el, {
          translateX: ['-20vw', '110vw'],
          opacity: [0, 0.85, 0.85, 0],
          duration: duration('dur-look-cloud'),
          delay: i * stagger * 6,
          ease: steady,
          loop: true,
        }),
      );
      break;
  }
  return all;
}

/** The layer's touches, started as it mounts and taken away (reverted) as it goes. */
function Layer({ where, kinds }: { where: 'header' | 'band'; kinds: readonly MotionKind[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const key = kinds.join(' ');
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let gone = false;
    const running: Running[] = [];
    void import('animejs/waapi').then(({ waapi }) => {
      if (gone) return;
      for (const kind of key.split(' ') as MotionKind[]) {
        const touches = [...el.querySelectorAll<HTMLElement>(`[data-look-touch="${kind}"]`)];
        running.push(...animateKind(waapi, kind, touches));
      }
    });
    return () => {
      gone = true;
      for (const a of running) a.revert();
    };
  }, [key]);
  const layer = (
    <div
      ref={ref}
      aria-hidden="true"
      inert
      data-look-motion={where}
      data-testid={`look-motion-${where}`}
      className="look-layer"
    >
      {kinds.flatMap((kind) =>
        Array.from({ length: COUNTS[kind] }, (_, i) => (
          <span
            key={`${kind}-${String(i)}`}
            data-look-touch={kind}
            className={`look-${kind}`}
            style={{ '--n': i } as never}
          />
        )),
      )}
    </div>
  );
  return where === 'header' ? layer : <div className="look-band-place">{layer}</div>;
}

/**
 * The moving touch for `where`: the header's (placed first inside the header, behind everything in it) or the band's
 * (placed just after the band). Nothing at all while it does not move.
 */
export function LookMotion({ where }: { where: 'header' | 'band' }) {
  const { now, look } = useLookMoving();
  const kinds = look.filter((k) => HEADER_MOTIONS.includes(k) === (where === 'header'));
  if (now !== 'moving' || kinds.length === 0) return null;
  return <Layer where={where} kinds={kinds} />;
}
