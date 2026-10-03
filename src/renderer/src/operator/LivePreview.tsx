import { useEffect } from 'react';
import { useEngine } from '../engine/engine-store';
import { preloadFonts } from '../render/fonts';
import { PlacedInParent } from '../render/Placed';
import { Scene } from '../render/Scene';
import { useFirstGroupLook, useScreens } from '../screens/screens-store';
import { LANG_NAMES } from '../../../shared/themes';
import { Badge, LiveBadge } from '../ui/Badge';
import { cx } from '../ui/cx';
import { Timer } from '../ui/icons';
import { useNow } from '../render/useNow';

/**
 * What the audience sees, drawn by the same Scene component the outputs use,
 * on the canvas of the first screen (1920 x 1080 when none is set up). The
 * picture is for the eyes; the header and the window's title say it in words.
 * A kirtan's slide shows the languages of the first audience group, and
 * says so under the picture (each group can show its own).
 */
export function LivePreview() {
  const state = useEngine((s) => s.state);
  // As the first audience group shows it in the live Look (its layers, languages and slide style).
  const audience = useFirstGroupLook('audience');
  const shownAs = audience?.look.languages
    ? { name: audience.name, languages: audience.look.languages }
    : null;
  const first = useScreens((s) => s.snapshot?.groups.flatMap((g) => g.screens)[0]);
  useEffect(() => {
    void preloadFonts();
  }, []);
  const canvas = { width: first?.canvasWidth ?? 1920, height: first?.canvasHeight ?? 1080 };
  const scaling = first?.scaling ?? 'fit';
  const blackout = state?.blackout ?? false;
  const somethingUp = state
    ? state.layers.slide !== null || state.layers.background !== null || state.layers.props.length > 0
    : false;
  return (
    <section aria-labelledby="live-preview-title" className="space-y-2 px-3 pt-3">
      <div className="flex h-6 items-center gap-2">
        <h2 id="live-preview-title" className="flex-1 text-2xs font-bold tracking-wider text-muted uppercase">
          On the screens now
        </h2>
        {blackout ? <Badge tone="live">Black-out</Badge> : somethingUp ? <LiveBadge /> : null}
      </div>
      <div
        className={cx(
          'overflow-hidden rounded-lg border-2 bg-black',
          somethingUp && !blackout ? 'border-live' : 'border-line-strong',
        )}
        data-testid="live-preview"
        data-a11y-picture
        aria-hidden="true"
      >
        <PlacedInParent content={canvas} mode="fit" className="relative aspect-video w-full">
          {state && (
            <Scene
              state={state}
              canvas={canvas}
              scaling={scaling}
              annotate
              {...(audience ? { look: audience.look } : {})}
            />
          )}
        </PlacedInParent>
      </div>
      {shownAs && state?.layers.slide?.slide.kirtan && (
        <p className="text-xs text-muted" data-testid="preview-languages">
          As “{shownAs.name}” shows it: {shownAs.languages.map((l) => LANG_NAMES[l]).join(', ')}
        </p>
      )}
      {state?.autoAdvance && <TimeLeft count={state.autoAdvance} />}
    </section>
  );
}

/** The slide moves on by itself: how long it has left, in words and as a bar. */
function TimeLeft({ count }: { count: { startedAt: number; durationMs: number } }) {
  const now = useNow(250);
  const left = Math.max(0, count.startedAt + count.durationMs - now);
  const seconds = Math.ceil(left / 1000);
  const done = Math.min(1, Math.max(0, 1 - left / count.durationMs));
  return (
    <div
      role="timer"
      data-testid="auto-advance"
      data-left={seconds}
      aria-label={`Moves on by itself in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`}
      className="space-y-1"
    >
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Timer size={13} aria-hidden="true" />
        Moves on by itself in <span className="font-bold text-fg tabular-nums">{formatSeconds(seconds)}</span>
      </p>
      <div className="h-1 overflow-hidden rounded-full bg-panel-3" aria-hidden="true">
        <div className="h-full bg-accent" style={{ width: `${done * 100}%` }} />
      </div>
    </div>
  );
}

/** 0:07, 1:30. */
const formatSeconds = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
