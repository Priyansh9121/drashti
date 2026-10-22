import type { CSSProperties, ReactNode, RefObject } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { PipLayer, PipSource } from '../../../shared/engine/state';
import type { Movement } from '../../../shared/looks';
import type { MediaElement } from '../../../shared/model';
import type { Size } from '../../../shared/scaling';
import { engineNow, onClockJump } from './clock';
import { LiveWindowView } from './LiveWindowView';
import {
  keptPipRun,
  PIP_REST,
  pipMainPose,
  type PipPicture,
  pipPlaces,
  pipPose,
  pipRect,
  type PipRun,
  pipRunAt,
  pipRunLater,
  poseTransform,
  samePipRun,
} from './pip';
import { KeptVideo } from './KeptVideo';
import { ElementView } from './SlideView';
import { useVideoInput } from './video-input';

/*
 * The picture-in-picture box on a screen (Session 50, render/pip.ts): a 16:9 box over the props and under the
 * lower third, messages and the ticker, with a thin border and rounded corners when chosen (a border-radius
 * clipping it and a border over it: no shadow, no filter). It comes in from when it went up, swaps and moves
 * from its last change, and goes out from when it was taken off, each frame worked out from the engine's clock;
 * only its opacity and transform move, and in a swap the main picture's own change moves with it (Session 51,
 * usePipMainMove). Black-out and the logo cover it, as they cover the slide. A video in it
 * plays muted from when it went up; a video input and a window are opened as every picture of them is
 * (render/video-input.ts, render/live-window.ts), video only.
 */

const FULL: CSSProperties = { position: 'absolute', inset: 0 };
const BLACK: CSSProperties = { ...FULL, background: '#000000' };

/** The thin border's colour: white, a little see-through. */
const BORDER = 'rgba(255, 255, 255, 0.85)';

/**
 * The box's run on this screen (render/pip.ts pipRunAt), worked out from the engine's state and the engine's time
 * at every drawing (Session 51), so whatever draws the screen again draws the box as the time has it, a swap's or a
 * move's middle and each end included. The run is kept while it draws the same (keptPipRun), so nothing drawn from
 * it is drawn again for nothing. `refresh` works it out again now, drawing the screen again only if the box changed:
 * when the clock jumps (a test holding it, the warm-up, a node's offset set), and at the frame a swap or a move
 * reaches its middle or anything its end (PipBox). Before, every clock jump drew the whole screen again.
 */
export function usePipRun(
  layer: PipLayer | null,
  off: { layer: PipLayer; at: number } | null,
  movement: Movement,
  canvas: Size,
): [PipRun, () => void] {
  const { width, height } = canvas;
  const latest = pipRunAt(layer, off, movement, engineNow(), { width, height });
  const [kept, setKept] = useState(latest);
  const run = keptPipRun(kept, latest);
  if (run !== kept) setKept(run);
  const refresh = useCallback(() => {
    setKept((was) => keptPipRun(was, pipRunAt(layer, off, movement, engineNow(), { width, height })));
  }, [layer, off, movement, width, height]);
  useEffect(() => onClockJump(refresh), [refresh]);
  return [run, refresh];
}

const moves = (run: PipRun) =>
  run.phase === 'in' || run.phase === 'out' || run.phase === 'swap' || run.phase === 'move';

export function PipBox({
  run,
  onRun,
  canvas,
  draw,
}: {
  run: PipRun;
  /**
   * Works the run out again now (usePipRun's refresh): at the frame a swap or a move reaches its middle, or
   * anything its end, the screen is drawn again as the time then has it.
   */
  onRun: () => void;
  canvas: Size;
  /** One of the screen's pictures (the background, the box's own, the slide), drawn at the box's size. */
  draw: (picture: PipPicture, size: Size) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { width, height } = canvas;
  const moving = moves(run);
  // The moment this drawing was worked out for (the run with it, by the screen).
  const drawnAt = engineNow();
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
  // Frame by frame from the engine's clock while it moves. At the frame a swap or a move reaches its middle, or it
  // ends, the screen is drawn again at once (flushSync), before that frame is shown: never a frame of the old
  // pictures, place or phase after the time has changed them. Started and stopped as each drawing is put on the
  // page, so no frame paints a move it no longer draws.
  useLayoutEffect(() => {
    if (!moving) return;
    let frame = 0;
    let live = true;
    const tick = () => {
      const now = engineNow();
      if (!samePipRun(pipRunLater(run, now, { width, height }), run)) {
        flushSync(onRun);
        // Drawn again with its next run: that drawing's own loop goes on.
        if (!live) return;
      }
      paint(now);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      live = false;
      cancelAnimationFrame(frame);
    };
  }, [moving, run, paint, onRun, width, height]);
  // After every drawing, before it is shown: as at the moment it was worked out for.
  useLayoutEffect(() => {
    paint(drawnAt);
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
 * The main picture's part in a swap (Session 51, render/pip.ts pipMainPose): the picture there that changes,
 * drawn frame by frame from the engine's clock while its swap runs (`run`; null for a picture that does not move),
 * so it moves as the box does at the same moment; at rest otherwise. The box draws the screen again at the swap's
 * middle and at its end (PipBox), and so this picture's next part.
 */
export function usePipMainMove(ref: RefObject<HTMLElement | null>, run: PipRun | null, canvas: Size): void {
  const { width, height } = canvas;
  // The moment this drawing was worked out for (the run with it, by the screen).
  const drawnAt = engineNow();
  const paint = useCallback(
    (now: number) => {
      const el = ref.current;
      if (!el) return;
      const pose = run ? pipMainPose(run, now, { width, height }) : PIP_REST;
      const { transform, transformOrigin } = poseTransform(pose);
      el.style.opacity = pose.opacity >= 1 ? '' : String(pose.opacity);
      el.style.transform = transform;
      el.style.transformOrigin = transform === '' ? '' : transformOrigin;
      // How far into the swap it was drawn (ms), for tests (a held clock), as the box says it.
      const at = run ? Math.round(Math.min(Math.max(0, now - run.start), run.length)) : null;
      if (at === null) el.removeAttribute('data-pip-at');
      else el.setAttribute('data-pip-at', String(at));
    },
    [ref, run, width, height],
  );
  // Frame by frame while it swaps, started and stopped as each drawing is put on the page.
  useLayoutEffect(() => {
    if (!run) return;
    const { start, length } = run;
    let frame = 0;
    const tick = () => {
      const now = engineNow();
      paint(now);
      if (now - start < length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [run, paint]);
  // After every drawing, before it is shown: as at the moment it was worked out for (at rest once it is over).
  useLayoutEffect(() => {
    paint(drawnAt);
  });
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

/**
 * A video input in the box: the page's one capture of it (render/video-input.ts, shared with the background's
 * and Media's pictures of it), keeping its last picture when it stops; nothing where this computer does not have
 * it (a node's screens). The notice and Clear the input are the background's: the box says nothing of its own.
 */
function PipInputPicture({ inputId, device }: { inputId: string; device: string }) {
  const capture = useVideoInput({ inputId, device });
  return (
    <div data-pip-picture="input" data-input-id={inputId} data-input-state={capture.state} style={BLACK}>
      {capture.state !== 'absent' && (
        <KeptVideo stream={capture.stream} live={capture.state === 'live'} fit="contain" />
      )}
    </div>
  );
}
