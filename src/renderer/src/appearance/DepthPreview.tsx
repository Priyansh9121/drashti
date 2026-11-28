import type { CSSProperties } from 'react';
import type { Appearance, AppearanceBase } from '../../../shared/appearance/appearances';
import { cx } from '../ui/cx';

/*
 * Follow the computer's picture in the Appearance window (the alpha.25 list's item 9): the operator window as B · Depth
 * draws it (styles/look-depth.css), in Black's or White's colours, as AppearancePreview draws an appearance chosen by
 * name: the columns as rounded panels a gap apart on the darker ground, each with its 1 px light along the top and no
 * edge, the side columns one surface up and what is raised in them one more, the top bar and the bar of clears on the
 * ground with no line, and LIVE's red frame with its light red ring round the live picture. Flat colours only (no
 * gradient, no blur), and a picture for screen readers (the choice's name says it).
 */

/** Depth's own colours, look-depth.css's (follow-preview.test.ts holds them to the file): the ground, a panel's light, LIVE's ring. */
export const DEPTH_COLOURS: Readonly<
  Record<AppearanceBase, { ground: string; light: string; ring: string }>
> = {
  dark: { ground: '#030304', light: '#ffffff17', ring: '#d42a314b' },
  light: { ground: '#d6d9dd', light: '#ffffff', ring: '#d42a314b' },
};

function Bar({ colour, width, className }: { colour: string; width: string; className?: string }) {
  return (
    <span className={cx('block h-[3px] rounded-full', className)} style={{ background: colour, width }} />
  );
}

export function DepthPreview({ appearance }: { appearance: Appearance }) {
  const c = appearance.colours;
  const d = appearance.decoration;
  const depth = DEPTH_COLOURS[appearance.base];
  // What is raised in a side column (look-depth.css: dark one surface up, panel-3; light a shade under it, the panel).
  const raised = appearance.base === 'dark' ? c['panel-3'] : c.panel;
  const panel = (background: string): CSSProperties => ({
    background,
    boxShadow: `inset 0 1px 0 ${depth.light}`,
  });
  return (
    <div
      aria-hidden="true"
      data-a11y-picture=""
      data-testid="appearance-preview"
      data-look="depth"
      className="flex aspect-video w-full flex-col overflow-hidden rounded-md border"
      style={{ background: depth.ground, borderColor: c['line-strong'] }}
    >
      <div className="flex h-[13%] shrink-0 items-center gap-[4%] px-[4%]" data-part="header">
        <Bar colour={d['on-header']} width="16%" />
        <span className="block h-[46%] w-[30%] rounded-[2px]" style={{ background: c.panel }} />
        <Bar colour={d['on-header-muted']} width="10%" className="ml-auto" />
      </div>
      <div className="flex min-h-0 flex-1 gap-[2%] px-[1%]">
        <div
          className="flex w-[24%] flex-col gap-[6%] overflow-hidden rounded-[4px] p-[4%]"
          data-part="left"
          style={panel(c['panel-2'])}
        >
          <Bar colour={d.heading} width="60%" />
          <span
            className="block h-[14%] rounded-[2px] border"
            style={{ background: c['panel-3'], borderColor: d.second }}
          />
          <span className="block h-[14%] rounded-[2px]" style={{ background: raised }} />
          <span className="block h-[14%] rounded-[2px]" style={{ background: raised }} />
        </div>
        <div
          className="flex flex-1 flex-col gap-[5%] overflow-hidden rounded-[4px] p-[4%]"
          data-part="middle"
          style={panel(c.panel)}
        >
          <Bar colour={d.heading} width="30%" />
          <div className="grid grid-cols-3 content-start gap-[5%]">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span
                key={i}
                className="block aspect-video rounded-[2px] border"
                style={{ background: '#000000', borderColor: i === 1 ? c['live-edge'] : c['panel-3'] }}
              />
            ))}
          </div>
        </div>
        <div
          className="flex w-[30%] flex-col gap-[6%] overflow-hidden rounded-[4px] p-[4%]"
          data-part="right"
          style={panel(c['panel-2'])}
        >
          <Bar colour={d.second} width="40%" />
          <span
            className="self-start rounded-[2px] px-[6%] text-[7px] leading-[11px] font-bold text-white"
            style={{ background: c.live }}
          >
            LIVE
          </span>
          <span
            className="block aspect-video rounded-[2px] border"
            data-part="live"
            style={{
              background: '#000000',
              borderColor: c['live-edge'],
              boxShadow: `0 0 0 1px ${depth.ring}`,
            }}
          />
          <div className="mt-auto flex gap-[6%]">
            <span
              className="block h-[14px] w-[34%] rounded-[3px] border"
              style={{ background: raised, borderColor: c.field }}
            />
            <span
              className="flex h-[14px] flex-1 items-center justify-center rounded-[3px] text-[7px] font-bold"
              style={{ background: c.primary, color: c['on-primary'] }}
            >
              Next
            </span>
          </div>
        </div>
      </div>
      {/* The bar of clears on the ground: a lit layer button (LIVE's edge) and two unlit ones. */}
      <div className="flex h-[10%] shrink-0 items-center gap-[2%] px-[2.5%]" data-part="bar">
        <span
          className="block h-[60%] w-[10%] rounded-[2px] border"
          style={{ background: d.layer, borderColor: c['live-edge'] }}
        />
        <span
          className="block h-[60%] w-[10%] rounded-[2px] border"
          style={{ borderColor: d['layer-edge'] }}
        />
        <span
          className="block h-[60%] w-[10%] rounded-[2px] border"
          style={{ borderColor: d['layer-edge'] }}
        />
      </div>
    </div>
  );
}
