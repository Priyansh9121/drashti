import { useEffect } from 'react';
import { useEngine } from '../engine/engine-store';
import { preloadFonts } from '../render/fonts';
import { PlacedInParent } from '../render/Placed';
import { Scene } from '../render/Scene';
import { SceneBoundary } from '../render/SceneBoundary';
import { useFirstGroupLook, useScreens } from '../screens/screens-store';
import { LANG_NAMES } from '../../../shared/themes';
import type { RepeatRun } from '../../../shared/engine/state';
import { stopRepeat } from '../playlists/repeat-actions';
import { Badge, LiveBadge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { Repeat2, Square, Timer } from '../ui/icons';
import { LiveZoomControls, ZoomablePreview } from './LiveZoom';
import { useNow } from '../render/useNow';
import { useWhatIsThis } from '../help/WhatIsThis';

/**
 * What the audience sees, drawn by the same Scene component the outputs use,
 * on the canvas of the first screen (1920 x 1080 when none is set up). The
 * picture is for the eyes; the header and the window's title say it in words.
 * A kirtan's slide shows the languages of the first audience group, and
 * says so under the picture (each group can show its own).
 */
export function LivePreview() {
  const state = useEngine((s) => s.state);
  const rev = useEngine((s) => s.rev);
  const help = useWhatIsThis('live');
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
        {/* LIVE (Session 26a: it said "On the screens now", with a Next preview under it). */}
        <h2 id="live-preview-title" className="flex-1 text-2xs font-bold tracking-wider text-muted uppercase">
          LIVE
        </h2>
        {blackout ? <Badge tone="live">Black-out</Badge> : somethingUp ? <LiveBadge /> : null}
        {help.button}
      </div>
      {help.card && <div className="-mx-3">{help.card}</div>}
      {state?.repeat && <Repeating run={state.repeat} />}
      <div
        className={cx(
          'overflow-hidden rounded-lg border-2 bg-black',
          somethingUp && !blackout ? 'border-live' : 'border-line-strong',
        )}
        data-testid="live-preview"
        data-a11y-picture
        aria-hidden="true"
      >
        <ZoomablePreview>
          {/* The same scene as the outputs: if it fails as it draws, the preview is black (the rest of
            the window carries on) and tries again with the next change (Session 23). */}
          <SceneBoundary resetKey={rev} fallbackClassName="aspect-video w-full bg-black">
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
          </SceneBoundary>
        </ZoomablePreview>
      </div>
      {shownAs && state?.layers.slide?.slide.kirtan && (
        <p className="text-xs text-muted" data-testid="preview-languages">
          As “{shownAs.name}” shows it: {shownAs.languages.map((l) => LANG_NAMES[l]).join(', ')}
        </p>
      )}
      {state?.autoAdvance && <TimeLeft count={state.autoAdvance} />}
      <LiveZoomControls />
    </section>
  );
}

/** Repeat Slides going round (Session 26d): which, and Stop (Esc does the same), the slide staying up. */
function Repeating({ run }: { run: RepeatRun }) {
  return (
    <div
      role="status"
      data-testid="live-repeating"
      className="flex min-h-9 items-center gap-2 rounded-md border border-line bg-panel-2 py-1 pr-1 pl-2 text-xs"
    >
      <Repeat2 size={14} aria-hidden="true" className="shrink-0 text-muted" />
      <span className="min-w-0 flex-1 truncate" title={run.name}>
        <span className="font-bold">Repeating</span> · {run.name}
      </span>
      <Button size="sm" icon={Square} data-testid="live-repeat-stop" onClick={() => void stopRepeat()}>
        Stop (Esc)
      </Button>
    </div>
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
