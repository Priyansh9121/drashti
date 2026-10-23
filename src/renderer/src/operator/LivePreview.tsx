import { useCallback, useEffect, useState } from 'react';
import { usePractice, useShowRev, useShowState } from '../practice/practice-store';
import { preloadFonts } from '../render/fonts';
import { PlacedInParent } from '../render/Placed';
import { Scene } from '../render/Scene';
import { SceneBoundary } from '../render/SceneBoundary';
import { WarmUp } from '../render/WarmUp';
import { useFirstGroupLook, useScreens } from '../screens/screens-store';
import { LANG_NAMES } from '../../../shared/themes';
import type { EngineState, RepeatRun, TimerShow } from '../../../shared/engine/state';
import { LOWER_THIRD_MAX_LINES, lowerThirdOf } from '../../../shared/program';
import { useStream } from '../stream/stream-store';
import { missingFontsOf } from '../render/font-probe';
import { stopRepeat } from '../playlists/repeat-actions';
import { Badge, LiveBadge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { Eraser, Repeat2, Square, Timer } from '../ui/icons';
import { dispatch } from './actions';
import { LiveZoomControls, ZoomablePreview } from './LiveZoom';
import { useNow } from '../render/useNow';
import { useWhatIsThis } from '../help/WhatIsThis';
import { HOLD_WARM_UP, SKIP_WARM_UP } from '../render/warm-up-mode';
import { DEFAULT_LIVE_GROUP_LOOK } from '../../../shared/looks';
import { PipDragHandle, PipLiveStrip } from './PipLive';
import { useInputNamed } from '../video-inputs/video-inputs-store';

/**
 * What the audience sees, drawn by the same Scene component the outputs use,
 * on the canvas of the first screen (1920 x 1080 when none is set up). The
 * picture is for the eyes; the header and the window's title say it in words.
 * A kirtan's slide shows the languages of the first audience group, and
 * says so under the picture (each group can show its own).
 */
/**
 * How many of the live slide's lines a lower third shows, where one is drawn now (the stream's Camera and
 * words, or a group whose Look draws slides as a lower third), when it is fewer than the slide has
 * (Sessions 31–36, SLD-8: "Lower third shows 6 of 8 lines").
 */
function useLowerThirdShort(state: EngineState | null): { shown: number; total: number } | null {
  const groups = useScreens((s) => s.snapshot?.groups);
  const stream = useStream((s) => s.status);
  const slide = state?.layers.slide?.slide;
  if (!state || !slide) return null;
  const places = (groups ?? []).flatMap((g) => {
    const look = state.look.groups[g.id];
    if (g.role === 'stream')
      return stream?.programOn && stream.layout === 'camera' ? [look?.languages ?? null] : [];
    return look?.slides === 'lowerThird' ? [look.languages] : [];
  });
  const total = Math.max(0, ...places.map((languages) => lowerThirdOf(slide, languages).total));
  return total > LOWER_THIRD_MAX_LINES ? { shown: LOWER_THIRD_MAX_LINES, total } : null;
}

export function LivePreview() {
  // The show, or the practice show while it is on (Session 26g: drawn here, never on a screen).
  const state = useShowState();
  const lowerThirdShort = useLowerThirdShort(state);
  // Fonts the live slide names that this computer does not have (Sessions 31–36, I18N-1).
  const live = state?.layers.slide?.slide;
  const missingFonts = live
    ? [
        ...new Set(
          live.elements.flatMap((e) => (e.kind === 'text' && e.text.trim() !== '' ? missingFontsOf(e) : [])),
        ),
      ]
    : [];
  // The live slide's background cue named a video input this computer had none of (Session 51): said while Media
  // still has none of that name, never after one is added or named so (the slide's word stays until its cues run
  // again), and not before the window has read the list.
  const inputMissing = state?.layers.slide?.inputMissing ?? null;
  const stillMissing = useInputNamed(inputMissing) === null && inputMissing !== null;
  // Its background cue's file was missing as it went up (Session 52), named as the library names it: said while the
  // slide is up, until its cues run again.
  const fileMissing = state?.layers.slide?.fileMissing ?? null;
  const rev = useShowRev();
  const practising = usePractice((s) => s.on);
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
  // The picture-in-picture box alone is something on the screens too (Session 50).
  const somethingUp = state
    ? state.layers.slide !== null ||
      state.layers.background !== null ||
      state.layers.props.length > 0 ||
      state.layers.pip !== null
    : false;
  // The GPU warmed up, unseen, in the LIVE picture while it would be black (Session 27, render/WarmUp.tsx):
  // anything up, or put back after a restart, shows at once instead.
  const drawsSomething =
    state !== null &&
    (somethingUp ||
      state.layers.messages.length > 0 ||
      state.layers.ticker !== null ||
      state.layers.masks !== null ||
      state.logo !== null ||
      state.idle.startedAt !== null);
  const [warmed, setWarmed] = useState(SKIP_WARM_UP);
  const warmedUp = useCallback(() => {
    setWarmed(true);
  }, []);
  // Once something has been drawn, it never warms up again.
  if (drawsSomething && !warmed) setWarmed(true);
  const warming = !warmed && !drawsSomething && !practising;
  const picture = (
    <>
      {/* The same scene as the outputs: if it fails as it draws, the preview is black (the rest of
            the window carries on) and tries again with the next change (Session 23). */}
      <SceneBoundary resetKey={rev} fallbackClassName="aspect-video w-full bg-black">
        <PlacedInParent content={canvas} mode="fit" className="relative aspect-video w-full">
          {warming && (
            <WarmUp page="live" canvas={canvas} scaling={scaling} hold={HOLD_WARM_UP} onDone={warmedUp} />
          )}
          {state && !warming && (
            <Scene
              state={state}
              canvas={canvas}
              scaling={scaling}
              annotate
              {...(audience ? { look: audience.look } : {})}
            />
          )}
          {/* The picture-in-picture box, to drag anywhere on the screen (Session 50): the show's, never practice's. */}
          {state && !warming && !practising && (
            <PipDragHandle state={state} canvas={canvas} look={audience?.look ?? DEFAULT_LIVE_GROUP_LOOK} />
          )}
        </PlacedInParent>
      </SceneBoundary>
    </>
  );
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
      {state?.layers.slide?.timer && <TimerAlone shown={state.layers.slide.timer} />}
      <div
        className={cx(
          // The live border and its red underglow come and go in the same frame as the screens: no fade.
          'overflow-hidden rounded-lg border-2 bg-black',
          somethingUp && !blackout ? 'border-live shadow-live' : 'border-line-strong shadow-card',
        )}
        data-testid="live-preview"
        data-show-control
        data-a11y-picture
        aria-hidden="true"
      >
        {practising ? picture : <ZoomablePreview>{picture}</ZoomablePreview>}
      </div>
      <PipLiveStrip />
      {shownAs && state?.layers.slide?.slide.kirtan && (
        <p className="text-xs text-muted" data-testid="preview-languages">
          As “{shownAs.name}” shows it: {shownAs.languages.map((l) => LANG_NAMES[l]).join(', ')}
        </p>
      )}
      {missingFonts.length > 0 && (
        <p className="text-xs text-warning-fg" data-testid="live-missing-font">
          Font not on this computer: {missingFonts.join(', ')}
        </p>
      )}
      {/* The live slide named a video input this computer has none of (Session 51). */}
      {stillMissing && (
        <p className="text-xs text-warning-fg" data-testid="live-input-missing">
          Video input not on this computer: “{inputMissing}”. The background stays as it was.
        </p>
      )}
      {/* The live slide's background file is missing (Session 52): not found at import, or deleted from the library. */}
      {fileMissing !== null && (
        <p className="text-xs text-warning-fg" data-testid="live-file-missing">
          File missing: “{fileMissing}”. The background stays as it was.
        </p>
      )}
      {lowerThirdShort && (
        <p className="text-xs text-warning-fg" data-testid="preview-lower-third">
          Lower third shows {lowerThirdShort.shown} of {lowerThirdShort.total} lines
        </p>
      )}
      {state?.autoAdvance && <TimeLeft count={state.autoAdvance} />}
      {/* Zooming a live picture is the show's: not in the practice show, which has no pictures. */}
      {!practising && <LiveZoomControls />}
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

/** A timer shown alone in the slide's place (Session 50): which, and Take off (Clear slide does the same). */
function TimerAlone({ shown }: { shown: TimerShow }) {
  return (
    <div
      role="status"
      data-testid="live-timer"
      className="flex min-h-9 items-center gap-2 rounded-md border border-line bg-panel-2 py-1 pr-1 pl-2 text-xs"
    >
      <Timer size={14} aria-hidden="true" className="shrink-0 text-muted" />
      <span className="min-w-0 flex-1 truncate" title={shown.name}>
        <span className="font-bold">Timer</span> · {shown.name}
      </span>
      <Button
        size="sm"
        icon={Eraser}
        data-testid="live-timer-off"
        onClick={() => void dispatch({ type: 'clearLayer', layer: 'slide' })}
      >
        Take off
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
