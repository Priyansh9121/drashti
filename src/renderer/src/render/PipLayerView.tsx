import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PipLayer, PipSource } from '../../../shared/engine/state';
import type { Movement } from '../../../shared/looks';
import type { MediaElement } from '../../../shared/model';
import type { Size } from '../../../shared/scaling';
import { engineNow, onClockJump } from './clock';
import { LiveWindowView } from './LiveWindowView';
import { type PipPicture, pipPlaces, pipPose, pipRect, type PipRun, pipRunAt, poseTransform } from './pip';
import { useInputStream } from './pip-input';
import { ElementView } from './SlideView';

/*
 * The picture-in-picture box on a screen (Session 50, render/pip.ts): a 16:9 box over the props and under the
 * lower third, messages and the ticker, with a thin border and rounded corners when chosen (a border-radius
 * clipping it and a border over it: no shadow, no filter). It comes in from when it went up, swaps and moves
 * from its last change, and goes out from when it was taken off, each frame worked out from the engine's clock;
 * only its opacity and transform move. Black-out and the logo cover it, as they cover the slide. A video in it
 * plays muted from when it went up; a video input and a window are opened as every picture of them is
 * (render/pip-input.ts, render/live-window.ts), video only.
 */

const FULL: CSSProperties = { position: 'absolute', inset: 0 };
const BLACK: CSSProperties = { ...FULL, background: '#000000' };
const FITTED: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'contain',
};

/** The thin border's colour: white, a little see-through. */
const BORDER = 'rgba(255, 255, 255, 0.85)';

/**
 * The box's run on this screen (render/pip.ts pipRunAt): worked out again whenever the engine's state for it,
 * the group's Movement or the canvas changes, and when the clock jumps (a test holding it, the warm-up). The box
 * hands on the next run itself, at a swap's or a move's middle and at each end (`setRun`).
 */
export function usePipRun(
  layer: PipLayer | null,
  off: { layer: PipLayer; at: number } | null,
  movement: Movement,
  canvas: Size,
): [PipRun, (next: PipRun) => void] {
  const { width, height } = canvas;
  const [run, setRun] = useState<PipRun>(() =>
    pipRunAt(layer, off, movement, engineNow(), { width, height }),
  );
  const [seen, setSeen] = useState({ layer, off, movement, width, height });
  if (
    seen.layer !== layer ||
    seen.off !== off ||
    seen.movement !== movement ||
    seen.width !== width ||
    seen.height !== height
  ) {
    setSeen({ layer, off, movement, width, height });
    setRun(pipRunAt(layer, off, movement, engineNow(), { width, height }));
  }
  useEffect(
    () =>
      onClockJump(() => {
        setRun(pipRunAt(layer, off, movement, engineNow(), { width, height }));
      }),
    [layer, off, movement, width, height],
  );
  return [run, setRun];
}

/** The same run at `now`, worked out from itself: where its middle or its end has brought it. */
const runAgain = (run: PipRun, now: number, canvas: Size): PipRun =>
  run.phase === 'out'
    ? pipRunAt(null, run.layer ? { layer: run.layer, at: run.start } : null, run.movement, now, canvas)
    : pipRunAt(run.layer, null, run.movement, now, canvas);

const moves = (run: PipRun) =>
  run.phase === 'in' || run.phase === 'out' || run.phase === 'swap' || run.phase === 'move';

export function PipBox({
  run,
  onRun,
  canvas,
  draw,
}: {
  run: PipRun;
  /** The run once a swap or a move reaches its middle, or anything its end: the screen draws as it then has it. */
  onRun: (next: PipRun) => void;
  canvas: Size;
  /** One of the screen's pictures (the background, the box's own, the slide), drawn at the box's size. */
  draw: (picture: PipPicture, size: Size) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { width, height } = canvas;
  const moving = moves(run);
  const paint = useCallback(
    (now: number) => {
      const el = ref.current;
      if (!el) return;
      const pose = pipPose(run, now, { width, height });
      const { transform, transformOrigin } = poseTransform(pose);
      el.style.opacity = pose.opacity >= 1 ? '' : String(pose.opacity);
      el.style.transform = transform;
      el.style.transformOrigin = transformOrigin;
      // How far into its move it was drawn (ms), for tests (a held clock).
      el.dataset['pipAt'] = moving
        ? String(Math.round(Math.min(Math.max(0, now - run.start), run.length)))
        : '';
    },
    [run, moving, width, height],
  );
  // Frame by frame from the engine's clock while it moves; at a middle or an end, the screen is told.
  useEffect(() => {
    if (!moving) return;
    let frame = 0;
    const tick = () => {
      const now = engineNow();
      paint(now);
      const next = runAgain(run, now, { width, height });
      if (
        next.phase !== run.phase ||
        next.swapped !== run.swapped ||
        next.place !== run.place ||
        next.layer !== run.layer
      ) {
        onRun(next);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [moving, run, paint, onRun, width, height]);
  // After every render, before it is painted: where it is now.
  useLayoutEffect(() => {
    paint(engineNow());
  });
  const { layer, place } = run;
  if (!layer || !place) return null;
  const r = pipRect(place, canvas);
  const size = { width: r.width, height: r.height };
  const radius = layer.place.rounded ? Math.round(r.height * 0.05) : 0;
  const line = Math.max(2, Math.round(canvas.height * 0.003));
  // Its pictures as drawn now, and while a swap goes out those for after its middle, ready unseen.
  const slots = pipPlaces(layer.source.kind, run.swapped, layer.swapped).box;
  return (
    <div
      ref={ref}
      data-layer="pip"
      data-testid="pip-box"
      data-pip-source={layer.source.kind}
      data-pip-swapped={run.swapped ? 'true' : 'false'}
      data-pip-phase={run.phase}
      data-pip-motion={layer.place.motion}
      data-pip-corner={place.corner ?? 'none'}
      data-pip-size={place.size}
      data-pip-rect={`${String(r.x)},${String(r.y)},${String(r.width)},${String(r.height)}`}
      style={{ position: 'absolute', left: r.x, top: r.y, width: r.width, height: r.height }}
    >
      <div
        data-pip-frame=""
        style={{ ...BLACK, overflow: 'hidden', borderRadius: radius > 0 ? radius : undefined }}
      >
        {slots.map((slot) => (
          <div
            key={slot.picture}
            data-pip-slot={slot.picture}
            data-pip-ready={slot.shown ? undefined : ''}
            style={{ ...FULL, visibility: slot.shown ? undefined : 'hidden' }}
          >
            {draw(slot.picture, size)}
          </div>
        ))}
      </div>
      {layer.place.border && (
        <div
          data-pip-border=""
          style={{
            ...FULL,
            borderRadius: radius > 0 ? radius : undefined,
            border: `${String(line)}px solid ${BORDER}`,
          }}
        />
      )}
    </div>
  );
}

/**
 * The box's own picture at a size (the box's; or the screen's, in the background's place, once swapped): a
 * picture or a video from Media fitted inside it with black around (a video plays muted from when the box went up,
 * round and round), a video input, or another app's window, both fitted inside, live and silent.
 */
export function PipSourcePicture({
  source,
  shownAt,
  size,
}: {
  source: PipSource;
  shownAt: number;
  size: Size;
}) {
  switch (source.kind) {
    case 'media':
      return <PipMedia mediaId={source.mediaId} media={source.media} shownAt={shownAt} size={size} />;
    case 'input':
      return <PipInputPicture inputId={source.inputId} device={source.device} />;
    case 'window':
      return (
        <div data-pip-picture="window-box" style={BLACK}>
          <LiveWindowView
            as="pip"
            layer={{ kind: 'window', sourceId: source.sourceId, name: source.name, startedAt: shownAt }}
          />
        </div>
      );
    case 'slides':
      return null;
  }
}

function PipMedia({
  mediaId,
  media,
  shownAt,
  size,
}: {
  mediaId: string;
  media: 'image' | 'video';
  shownAt: number;
  size: Size;
}) {
  const { width, height } = size;
  // As a slide's picture or video is drawn (its look, a node's copy, a phone's preview), filling the box.
  const el = useMemo<MediaElement>(
    () => ({
      id: 'pip-media',
      kind: media,
      mediaId,
      frame: { x: 0, y: 0, width, height },
      fit: 'fit',
      loop: true,
    }),
    [media, mediaId, width, height],
  );
  return (
    <div data-pip-picture="media" style={BLACK}>
      <ElementView el={el} startedAt={shownAt} />
    </div>
  );
}

function PipInputPicture({ inputId, device }: { inputId: string; device: string }) {
  const { stream, state } = useInputStream(device);
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) void v.play().catch(() => undefined);
  }, [stream]);
  return (
    <div data-pip-picture="input" data-input-id={inputId} data-input-state={state} style={BLACK}>
      <video ref={ref} muted playsInline disablePictureInPicture style={FITTED} />
    </div>
  );
}
