import type { CSSProperties } from 'react';
import type { Rect } from '../../../shared/model';
import { ACTION_SAFE, MESSAGE_BAND, TICKER_HEIGHT, TITLE_SAFE } from '../../../shared/safe-areas';
import { bottomBand, cropLines, type Size } from '../../../shared/scaling';
import type { ScreenGroupConfig } from '../../../shared/screens';
import { useEngine } from '../engine/engine-store';
import { useScreens } from '../screens/screens-store';
import { useSafeAreas } from './safe-areas-store';

/*
 * Where words are safe on a slide (Sessions 31–36, SLD-2), drawn over the slide editor's slide while View ›
 * Show Safe Areas is on: action-safe (93%) and title-safe (90%), the ticker's band along the bottom (7.5%)
 * and a message's band above it, and a line where each screen group's canvas, or its Fill, cuts the slide
 * off. Whether a box's words sit in the ticker's band on a group that shows the ticker is the inspector's
 * warning, on or off.
 */

/** The groups that draw the hall's picture: they show the slide, and the ticker when their Look has it. */
const HALL_ROLES = new Set(['audience', 'keyfill']);

/** Each group's screens' ways of placing a slide, once each: their canvas and scaling. */
function placements(
  group: ScreenGroupConfig,
): { canvas: Size; scaling: ScreenGroupConfig['screens'][number]['scaling'] }[] {
  const seen = new Map<string, { canvas: Size; scaling: ScreenGroupConfig['screens'][number]['scaling'] }>();
  for (const s of group.screens) {
    if (!s.enabled) continue;
    seen.set(`${String(s.canvasWidth)}x${String(s.canvasHeight)} ${s.scaling}`, {
      canvas: { width: s.canvasWidth, height: s.canvasHeight },
      scaling: s.scaling,
    });
  }
  return [...seen.values()];
}

/** The groups whose screens show this box's words where the ticker runs (their live Look shows the ticker). */
export function useTickerOver(frame: Rect, slide: Size): string[] {
  const groups = useScreens((s) => s.snapshot?.groups);
  const looks = useEngine((s) => s.state?.look.groups);
  if (!groups) return [];
  return groups.flatMap((g) => {
    if (!HALL_ROLES.has(g.role)) return [];
    const layers = looks?.[g.id]?.layers;
    if (layers && (!layers.includes('ticker') || !layers.includes('slide'))) return [];
    const under = placements(g).some(({ canvas, scaling }) => {
      const band = bottomBand(slide, canvas, scaling, TICKER_HEIGHT);
      return band !== null && frame.y + frame.height > band.top + 0.5 && frame.y < band.bottom - 0.5;
    });
    return under ? [g.name] : [];
  });
}

const label = (scale: number): CSSProperties => ({
  position: 'absolute',
  fontSize: 12 / scale,
  lineHeight: 1.2,
  padding: `${String(1 / scale)}px ${String(4 / scale)}px`,
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
});

export function SafeAreas({ slide, scale }: { slide: Size; scale: number }) {
  const on = useSafeAreas((s) => s.on);
  const groups = useScreens((s) => s.snapshot?.groups);
  if (!on) return null;
  const px = 1 / scale;
  const { width: w, height: h } = slide;
  const inset = (share: number): CSSProperties => ({
    position: 'absolute',
    left: (w * (1 - share)) / 2,
    top: (h * (1 - share)) / 2,
    width: w * share,
    height: h * share,
    pointerEvents: 'none',
  });
  const tickerTop = h * (1 - TICKER_HEIGHT);
  const messageTop = h * (1 - TICKER_HEIGHT - MESSAGE_BAND);
  const cuts = (groups ?? []).flatMap((g) =>
    g.role === 'stage'
      ? []
      : placements(g).flatMap(({ canvas, scaling }) => {
          const lines = cropLines(slide, canvas, scaling);
          return [
            ...lines.across.map((y) => ({ group: g.name, y, x: null })),
            ...lines.down.map((x) => ({ group: g.name, x, y: null })),
          ];
        }),
  );
  return (
    <div
      data-testid="safe-areas"
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      <div
        data-testid="safe-action"
        style={{ ...inset(ACTION_SAFE), border: `${String(px)}px dashed var(--color-guide)` }}
      />
      <div
        data-testid="safe-title"
        style={{ ...inset(TITLE_SAFE), border: `${String(px)}px dashed var(--color-accent)` }}
      >
        <span style={{ ...label(scale), left: 0, top: 0, color: 'var(--color-accent)' }}>
          Words inside here
        </span>
      </div>
      <div
        data-testid="guide-message"
        data-y={Math.round(messageTop)}
        style={{
          position: 'absolute',
          left: 0,
          width: w,
          top: messageTop,
          height: tickerTop - messageTop,
          borderTop: `${String(px)}px dashed var(--color-warning)`,
        }}
      >
        <span style={{ ...label(scale), right: 0, top: 0, color: 'var(--color-warning)' }}>A message</span>
      </div>
      <div
        data-testid="guide-ticker"
        data-y={Math.round(tickerTop)}
        style={{
          position: 'absolute',
          left: 0,
          width: w,
          top: tickerTop,
          height: h - tickerTop,
          borderTop: `${String(px)}px solid var(--color-warning)`,
          background: 'color-mix(in srgb, var(--color-warning) 18%, transparent)',
        }}
      >
        <span style={{ ...label(scale), right: 0, top: 0, color: 'var(--color-warning)' }}>The ticker</span>
      </div>
      {cuts.map((c) => (
        <div
          key={`${c.group} ${String(c.x ?? '')} ${String(c.y ?? '')}`}
          data-testid="guide-crop"
          data-group={c.group}
          data-y={c.y === null ? undefined : Math.round(c.y)}
          data-x={c.x === null ? undefined : Math.round(c.x)}
          style={{
            position: 'absolute',
            background: 'var(--color-danger)',
            ...(c.y === null
              ? { left: c.x - px / 2, top: 0, width: px, height: h }
              : { top: c.y - px / 2, left: 0, height: px, width: w }),
          }}
        >
          <span style={{ ...label(scale), left: 0, top: 0, color: 'var(--color-danger)' }}>
            Cut on “{c.group}”
          </span>
        </div>
      ))}
    </div>
  );
}
