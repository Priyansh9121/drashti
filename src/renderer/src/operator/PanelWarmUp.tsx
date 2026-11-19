import { Button, IconButton } from '../ui/Button';
import { Mic, Radio, ScreenShare, Settings, X } from '../ui/icons';
import { SectionTitle } from '../ui/Panel';
import { Loading } from '../ui/States';

/*
 * The Stream panel's own drawing, warmed unseen with the LIVE picture's warm-up (Session 60, X21's second part; the
 * lead's ask after the owner's question Q60-4). Opened mid-show, the panel's first drawing in the operator window
 * made kinds of drawing this window had not drawn at that start (traced on CI's Mac, x21-1119-152307-74195 and
 * -74205): the primary button's gradient (Tailwind's three stops, mixed in oklab) under its rounded corners beside its
 * icon, see-through fills plain and under rounded corners, a shadow. A graphics chip makes each kind of drawing the
 * first time it is asked for it, and every window waits meanwhile: on a new CI Mac the gradient's first use held the
 * GPU, and the hall's screens with it, 357-461 ms. So while the LIVE picture warms up at the start (render/WarmUp.tsx,
 * which the opening waits for), this draws the panel as it arrives, black under brightness(0) inside the LIVE
 * picture's black box: the dim over the window fading in, the sheet sliding in with its shadow, its header's buttons,
 * the Program box with its spinner, the sound meter and Go live. It goes with the warm-up. Nothing in it can be
 * reached (inert) or read out (aria-hidden), and nothing in it asks Main for anything.
 */
export function PanelWarmUp() {
  return (
    <div
      aria-hidden="true"
      inert
      data-testid="panel-warm-up"
      className="pointer-events-none absolute inset-0 overflow-hidden [filter:brightness(0)]"
    >
      {/* As ui/Dialog.tsx draws a sheet along the right edge: the dim, then the panel. */}
      <div data-motion="scrim" className="absolute inset-0 flex justify-end bg-black/60">
        <div
          data-motion="sheet"
          className="flex h-full w-[min(56rem,100%)] flex-col border-l border-line-strong bg-panel text-fg shadow-overlay"
        >
          <header className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-3">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg leading-snug font-bold">Stream</h2>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button icon={ScreenShare} tabIndex={-1}>
                Window for Zoom…
              </Button>
              <Button icon={Settings} tabIndex={-1}>
                Stream settings
              </Button>
            </div>
            <IconButton icon={X} label="Close stream" tabIndex={-1} />
          </header>
          <div className="min-h-0 flex-1 space-y-5 px-5 py-4">
            <section className="space-y-2">
              <SectionTitle>Program</SectionTitle>
              <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-line-strong bg-black">
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loading label="Starting the stream’s picture…" immediate />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Mic size={14} aria-hidden="true" className="shrink-0 text-muted" />
                <div className="relative h-2.5 flex-1 overflow-hidden rounded-full border border-line-strong bg-panel-3">
                  <div className="h-full w-1/2 bg-success" />
                </div>
                <span className="w-16 text-right text-xs text-muted">Quiet</span>
              </div>
            </section>
            <section className="space-y-2">
              <SectionTitle>On air</SectionTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" size="lg" icon={Radio} tabIndex={-1}>
                  Go live…
                </Button>
                <span className="text-sm text-muted">Off air</span>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
