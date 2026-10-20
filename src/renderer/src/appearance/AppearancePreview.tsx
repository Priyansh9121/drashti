import type { CSSProperties } from 'react';
import type { Appearance } from '../../../shared/appearance/appearances';
import { cx } from '../ui/cx';

/*
 * An appearance drawn as a small picture of the operator window (Sessions 39–40), as Themes draws a slide theme:
 * the header, the playlists with the chosen row, the slides with the live one's red border, LIVE above the live
 * picture, and Next in the primary with Back beside it. In the appearance's own colours, whatever the window's
 * is now. Flat colours only (no shadows or gradients: nothing new for the graphics chip to work out), and a
 * picture for screen readers (the choice's name says it). Session 42: the header in its colour with the states'
 * panel on it, the band under it, headings in their colour, and the chosen row marked in the second colour.
 */

function Bar({ colour, width, className }: { colour: string; width: string; className?: string }) {
  return (
    <span className={cx('block h-[3px] rounded-full', className)} style={{ background: colour, width }} />
  );
}

export function AppearancePreview({ appearance, className }: { appearance: Appearance; className?: string }) {
  const c = appearance.colours;
  const d = appearance.decoration;
  const panel: CSSProperties = { background: c.panel, borderColor: c.line };
  return (
    <div
      aria-hidden="true"
      data-a11y-picture=""
      data-testid="appearance-preview"
      className={cx('flex aspect-video w-full flex-col overflow-hidden rounded-md border', className)}
      style={{ background: c.ink, borderColor: c['line-strong'] }}
    >
      <div
        className="flex h-[13%] shrink-0 items-center gap-[4%] border-b px-[4%]"
        style={{ background: d.header, borderColor: c.line }}
      >
        <Bar colour={d['on-header']} width="16%" />
        <span className="block h-[46%] w-[30%] rounded-[2px]" style={{ background: c.panel }} />
        <Bar colour={d['on-header-muted']} width="10%" className="ml-auto" />
      </div>
      {d.band.length > 0 && (
        <div className="flex h-[3px] shrink-0" data-testid="appearance-preview-band">
          {d.band.map((colour, i) => (
            <span key={i} className="block flex-1" style={{ background: colour }} />
          ))}
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-[2.5%] p-[2.5%]">
        <div className="flex w-[24%] flex-col gap-[6%] rounded-[3px] border p-[4%]" style={panel}>
          <Bar colour={d.heading} width="60%" />
          <span
            className="block h-[14%] rounded-[2px] border"
            style={{ background: c['panel-3'], borderColor: d.second }}
          />
          <span className="block h-[14%] rounded-[2px]" style={{ background: c['panel-2'] }} />
          <span className="block h-[14%] rounded-[2px]" style={{ background: c['panel-2'] }} />
        </div>
        <div
          className="grid flex-1 grid-cols-3 content-start gap-[5%] rounded-[3px] border p-[4%]"
          style={panel}
        >
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span
              key={i}
              className="block aspect-video rounded-[2px] border"
              style={{ background: '#000000', borderColor: i === 1 ? c.live : c.line }}
            />
          ))}
        </div>
        <div className="flex w-[30%] flex-col gap-[6%] rounded-[3px] border p-[4%]" style={panel}>
          <Bar colour={d.second} width="40%" />
          <span
            className="self-start rounded-[2px] px-[6%] text-[7px] leading-[11px] font-bold text-white"
            style={{ background: c.live }}
          >
            LIVE
          </span>
          <span
            className="block aspect-video rounded-[2px] border"
            style={{ background: '#000000', borderColor: c.live }}
          />
          <div className="mt-auto flex gap-[6%]">
            <span
              className="block h-[14px] w-[34%] rounded-[3px] border"
              style={{ background: c['panel-2'], borderColor: c.field }}
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
    </div>
  );
}
