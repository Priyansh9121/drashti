import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useRef, useState } from 'react';
import type { Rect, SlideElement } from '../../../shared/model';
import type { EditDoc } from '../../../shared/slide-edit';
import { legacyFontOf } from '../../../shared/slide-edit';
import { useMedia } from '../library/library-store';
import { MediaStill } from '../render/MediaStill';
import { ElementView } from '../render/SlideView';
import { useElementSize } from '../render/useElementSize';
import {
  beginGesture,
  commit,
  endGesture,
  select,
  startEditing,
  tell,
  updateGesture,
  useEditor,
} from './editor-store';
import type { Guides, Handle, Point, SnapLines } from './geometry';
import {
  boundsOf,
  boxBetween,
  centerOf,
  HANDLE_AT,
  HANDLES,
  hitTest,
  overlaps,
  resizeFrame,
  rotatePoint,
  rotationToward,
  snapLines,
  snapMove,
  snapResize,
  unionOf,
} from './geometry';
import {
  deleteElements,
  duplicateElements,
  findSlide,
  mapElements,
  moveElements,
  rotateElements,
  scaleElements,
} from './ops';
import { copyElements, pasteElements } from './clipboard';
import { finishTextEditing, TextBoxEditor } from './TextBoxEditor';

/*
 * The slide being edited, scaled to fit, drawn by the same renderer as the
 * screens. Click to select (Shift adds), drag to move (snapping to the
 * slide's edges and middle and to other elements; hold Alt to place freely),
 * drag a handle to resize or the round handle to turn, drag on the empty
 * slide to select several. Several selected have one box round them: its
 * handles resize them together (snapping too) and its round handle turns
 * them together, each step one Undo. Copy, Cut and Paste (the Edit menu's)
 * copy elements between slides and presentations (clipboard.ts). Double-click (or Enter) a text box to type in it.
 * From the keyboard: Tab chooses the next element, the arrows move it (Shift
 * ten at a time), Delete removes it.
 */

/** Room round the slide. */
const PAD = 32;
/** How close (screen pixels) something must come to a line to snap to it. */
const SNAP_PX = 8;
/** Moves under this (screen pixels) are a click, not a drag. */
const DRAG_PX = 3;
/** Handles, screen pixels. */
const HANDLE_PX = 10;

type Drag =
  | {
      kind: 'move';
      start: Point;
      startDoc: EditDoc;
      ids: string[];
      box: Rect;
      lines: SnapLines;
      dragging: boolean;
    }
  | {
      kind: 'resize';
      id: string;
      handle: Handle;
      startDoc: EditDoc;
      frame: Rect;
      rotation: number;
      lines: SnapLines;
      keepRatio: boolean;
    }
  | { kind: 'rotate'; id: string; startDoc: EditDoc; frame: Rect }
  /** Several elements resized together by the box round them. */
  | { kind: 'groupResize'; ids: string[]; handle: Handle; startDoc: EditDoc; box: Rect; lines: SnapLines }
  /** Several elements turned together round the middle of the box round them. */
  | { kind: 'groupRotate'; ids: string[]; startDoc: EditDoc; center: Point; from: number }
  | { kind: 'marquee'; start: Point; base: string[] };

/** The angle (degrees) from `c` to `p`. */
const angleOf = (c: Point, p: Point) => (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI;

const KIND_NAME: Record<SlideElement['kind'], string> = {
  text: 'Text box',
  shape: 'Shape',
  image: 'Picture',
  video: 'Video',
};

/** How an element is read out: its kind and words, or its kind. */
export function elementName(el: SlideElement): string {
  if (el.kind === 'text') {
    const words = el.text.trim().replace(/\s+/gu, ' ');
    return words ? `${KIND_NAME.text}: ${words.slice(0, 40)}` : `${KIND_NAME.text} (empty)`;
  }
  if (el.kind === 'shape')
    return el.shape === 'ellipse' ? 'Ellipse' : el.shape === 'line' ? 'Line' : 'Rectangle';
  return KIND_NAME[el.kind];
}

const CURSOR: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

export function Canvas({ platform }: { platform: string }) {
  const doc = useEditor((s) => s.doc);
  const slideId = useEditor((s) => s.slideId);
  const selection = useEditor((s) => s.selection);
  const editing = useEditor((s) => s.editing);
  const area = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const size = useElementSize(area);
  const drag = useRef<Drag | null>(null);
  const [guides, setGuides] = useState<Guides | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [editAt, setEditAt] = useState<Point | null>(null);
  const pastedInPlaceAt = useRef(0);
  const slide = doc ? findSlide(doc, slideId) : undefined;
  if (!doc || !slide) return <div ref={area} className="min-w-0 flex-1 bg-ink" />;

  const scale = Math.max(
    0.05,
    Math.min((size.width - 2 * PAD) / doc.width, (size.height - 2 * PAD) / doc.height),
  );
  const width = doc.width * scale;
  const height = doc.height * scale;
  const elements = slide.elements;
  const selected = elements.filter((e) => selection.includes(e.id));
  const single = selected.length === 1 ? selected[0] : undefined;
  const background = slide.cues.find((c) => c.kind === 'background' && c.mediaId !== null);

  /** Where the pointer is on the slide, in slide pixels. */
  const pointOf = (e: { clientX: number; clientY: number }): Point => {
    const r = stage.current?.getBoundingClientRect();
    return r ? { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale } : { x: 0, y: 0 };
  };
  const linesWithout = (ids: readonly string[]) =>
    snapLines(
      doc,
      elements.filter((e) => !ids.includes(e.id)).map((e) => boundsOf(e)),
    );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const p = pointOf(e);
    const handle = target.closest<HTMLElement>('[data-handle]')?.dataset['handle'];
    const hit = hitTest(elements, p, 6 / scale);
    // Typing in a box: clicks inside it place the caret; anywhere else ends the typing.
    if (editing) {
      if (hit === editing && !handle) return;
      finishTextEditing();
    }
    e.preventDefault();
    stage.current?.focus();
    const now = useEditor.getState();
    if (!now.doc) return;
    if (handle && selected.length > 1) {
      // Several elements: resized or turned together by the box round them.
      e.currentTarget.setPointerCapture(e.pointerId);
      const ids = selected.map((el) => el.id);
      const box = unionOf(selected.map((el) => boundsOf(el))) ?? { x: 0, y: 0, width: 0, height: 0 };
      drag.current =
        handle === 'rotate'
          ? {
              kind: 'groupRotate',
              ids,
              startDoc: now.doc,
              center: centerOf(box),
              from: angleOf(centerOf(box), p),
            }
          : {
              kind: 'groupResize',
              ids,
              handle: handle as Handle,
              startDoc: now.doc,
              box,
              lines: linesWithout(ids),
            };
      beginGesture();
      return;
    }
    if (handle && single) {
      e.currentTarget.setPointerCapture(e.pointerId);
      if (handle === 'rotate') {
        drag.current = { kind: 'rotate', id: single.id, startDoc: now.doc, frame: single.frame };
      } else {
        drag.current = {
          kind: 'resize',
          id: single.id,
          handle: handle as Handle,
          startDoc: now.doc,
          frame: single.frame,
          rotation: single.rotation ?? 0,
          lines: linesWithout([single.id]),
          // Pictures and videos keep their proportions; Shift does it for anything.
          keepRatio: single.kind === 'image' || single.kind === 'video',
        };
      }
      beginGesture();
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const additive = e.shiftKey || (platform === 'darwin' ? e.metaKey : e.ctrlKey);
    if (hit) {
      let ids = selection;
      if (additive) ids = selection.includes(hit) ? selection.filter((i) => i !== hit) : [...selection, hit];
      else if (!selection.includes(hit)) ids = [hit];
      select(ids);
      if (!ids.includes(hit)) return;
      const moving = elements.filter((el) => ids.includes(el.id));
      drag.current = {
        kind: 'move',
        start: p,
        startDoc: now.doc,
        ids,
        box: unionOf(moving.map((el) => boundsOf(el))) ?? { x: 0, y: 0, width: 0, height: 0 },
        lines: linesWithout(ids),
        dragging: false,
      };
      return;
    }
    if (!additive) select([]);
    drag.current = { kind: 'marquee', start: p, base: additive ? selection : [] };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = pointOf(e);
    const free = e.altKey;
    const within = SNAP_PX / scale;
    if (d.kind === 'move') {
      const dx = p.x - d.start.x;
      const dy = p.y - d.start.y;
      if (!d.dragging) {
        if (Math.hypot(dx, dy) * scale < DRAG_PX) return;
        d.dragging = true;
        beginGesture();
      }
      const moved = { ...d.box, x: d.box.x + dx, y: d.box.y + dy };
      const snap = free ? null : snapMove(moved, d.lines, within);
      updateGesture(
        moveElements(d.startDoc, slide.id, d.ids, { x: dx + (snap?.dx ?? 0), y: dy + (snap?.dy ?? 0) }),
      );
      setGuides(snap && (snap.guides.x.length || snap.guides.y.length) ? snap.guides : null);
    } else if (d.kind === 'resize') {
      let frame = resizeFrame({ frame: d.frame, rotation: d.rotation }, d.handle, p, {
        keepRatio: d.keepRatio !== e.shiftKey,
        min: 8,
      });
      let shown: Guides | null = null;
      if (!free && d.rotation === 0 && !(d.keepRatio !== e.shiftKey)) {
        const snapped = snapResize(frame, d.handle, d.lines, within);
        frame = snapped.frame;
        shown = snapped.guides.x.length || snapped.guides.y.length ? snapped.guides : null;
      }
      const round = (n: number) => Math.round(n * 100) / 100;
      const next = {
        x: round(frame.x),
        y: round(frame.y),
        width: round(frame.width),
        height: round(frame.height),
      };
      updateGesture(mapElements(d.startDoc, slide.id, [d.id], (el) => ({ ...el, frame: next })));
      setGuides(shown);
    } else if (d.kind === 'groupResize') {
      let box = resizeFrame({ frame: d.box }, d.handle, p, { keepRatio: e.shiftKey, min: 8 });
      let shown: Guides | null = null;
      if (!free && !e.shiftKey) {
        const snapped = snapResize(box, d.handle, d.lines, within);
        box = snapped.frame;
        shown = snapped.guides.x.length || snapped.guides.y.length ? snapped.guides : null;
      }
      updateGesture(scaleElements(d.startDoc, slide.id, d.ids, d.box, box));
      setGuides(shown);
    } else if (d.kind === 'groupRotate') {
      let degrees = angleOf(d.center, p) - d.from;
      if (e.shiftKey) degrees = Math.round(degrees / 15) * 15;
      else if (!free) {
        const quarter = Math.round(degrees / 90) * 90;
        if (Math.abs(degrees - quarter) <= 3) degrees = quarter;
      }
      updateGesture(rotateElements(d.startDoc, slide.id, d.ids, d.center, degrees));
    } else if (d.kind === 'rotate') {
      const rotation = rotationToward(d.frame, p, { step: e.shiftKey, snapWithin: free ? 0 : 3 });
      updateGesture(
        mapElements(d.startDoc, slide.id, [d.id], (el) => {
          const { rotation: _old, ...rest } = el;
          return rotation ? { ...rest, rotation } : rest;
        }),
      );
    } else {
      setMarquee(boxBetween(d.start, p));
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    setGuides(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.kind === 'marquee') {
      const box = marquee;
      setMarquee(null);
      if (box && box.width * scale > DRAG_PX && box.height * scale > DRAG_PX) {
        const inside = elements.filter((el) => overlaps(boundsOf(el), box)).map((el) => el.id);
        select([...new Set([...d.base, ...inside])]);
      }
      return;
    }
    endGesture();
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const hit = hitTest(elements, pointOf(e), 6 / scale);
    const el = elements.find((x) => x.id === hit);
    if (el?.kind !== 'text') return;
    const legacy = legacyFontOf(el);
    if (legacy) {
      tell(
        `These words are typed in a legacy font (${legacy}): the box can be moved and resized, but its words cannot be edited yet.`,
      );
      return;
    }
    setEditAt({ x: e.clientX, y: e.clientY });
    startEditing(el.id);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // Alt places freely while dragging; on its own it must not open the window's menu bar (Windows).
    if (e.key === 'Alt') {
      e.preventDefault();
      return;
    }
    if (editing || e.target !== e.currentTarget) return;
    const mod = platform === 'darwin' ? e.metaKey : e.ctrlKey;
    const now = useEditor.getState();
    if (!now.doc) return;
    const step = e.shiftKey ? 10 : 1;
    const arrows: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const arrow = arrows[e.key];
    if (arrow && selection.length > 0 && !mod && !e.altKey) {
      e.preventDefault();
      commit(moveElements(now.doc, slide.id, selection, arrow), { coalesce: `nudge:${selection.join(',')}` });
      return;
    }
    if (e.key === 'Tab' && !mod && !e.altKey && elements.length > 0) {
      // The next (or previous) element in order; past the last, Tab goes on to the controls.
      const at = single ? elements.indexOf(single) : e.shiftKey ? elements.length : -1;
      const next = elements[at + (e.shiftKey ? -1 : 1)];
      if (next) {
        e.preventDefault();
        select([next.id]);
      }
      return;
    }
    if (e.key === 'Enter' && single?.kind === 'text') {
      e.preventDefault();
      const legacy = legacyFontOf(single);
      if (legacy)
        tell(
          `These words are typed in a legacy font (${legacy}): the box can be moved and resized, but its words cannot be edited yet.`,
        );
      else {
        setEditAt(null);
        startEditing(single.id);
      }
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length > 0) {
      e.preventDefault();
      commit(deleteElements(now.doc, slide.id, selection), { select: [] });
      return;
    }
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      select(elements.map((x) => x.id));
      return;
    }
    if (mod && e.key.toLowerCase() === 'd' && selection.length > 0) {
      e.preventDefault();
      const copied = duplicateElements(now.doc, slide.id, selection);
      commit(copied.doc, { select: copied.ids });
      return;
    }
    // Paste in place (Mod+Shift+V): exactly where they were. (Mod+V comes as the window's paste.)
    if (mod && e.shiftKey && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      pastedInPlaceAt.current = e.timeStamp;
      paste(true);
    }
  };

  /** Paste what was copied onto this slide (one step for Undo); the pasted elements are selected. */
  const paste = (inPlace: boolean) => {
    const now = useEditor.getState();
    if (!now.doc || now.editing) return;
    const pasted = pasteElements(now.doc, slide.id, { inPlace });
    if (pasted) commit(pasted.doc, { select: pasted.ids });
  };
  // The window's Copy, Cut and Paste (the Edit menu and its keys) while the slide has the focus.
  const onCopy = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (editing || e.target !== e.currentTarget || selection.length === 0) return;
    const now = useEditor.getState();
    if (!now.doc) return;
    e.preventDefault();
    const n = copyElements(now.doc, slide.id, selection);
    tell(n === 1 ? 'Copied 1 element.' : `Copied ${n} elements.`);
  };
  const onCut = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (editing || e.target !== e.currentTarget || selection.length === 0) return;
    const now = useEditor.getState();
    if (!now.doc) return;
    e.preventDefault();
    copyElements(now.doc, slide.id, selection);
    commit(deleteElements(now.doc, slide.id, selection), { select: [] });
  };
  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (editing || e.target !== e.currentTarget) return;
    e.preventDefault();
    // Mod+Shift+V can also come as a paste: it was handled as Paste in place.
    if (e.timeStamp - pastedInPlaceAt.current < 300) return;
    paste(false);
  };

  const status =
    selected.length === 0
      ? 'Nothing selected'
      : single
        ? `${elementName(single)} selected, at ${Math.round(single.frame.x)}, ${Math.round(single.frame.y)}, ${Math.round(single.frame.width)} by ${Math.round(single.frame.height)}`
        : `${selected.length} elements selected`;

  return (
    <div
      ref={area}
      className="relative min-w-0 flex-1 overflow-hidden bg-ink"
      data-testid="editor-canvas-area"
    >
      <div
        ref={stage}
        role="application"
        aria-roledescription="slide"
        aria-label="The slide. Tab chooses the next element, the arrow keys move it (Shift for ten pixels), Enter types in a text box, Delete removes. Copy, Cut and Paste work on elements; Shift with Paste puts them exactly where they were."
        aria-describedby="editor-canvas-status"
        tabIndex={0}
        data-testid="editor-canvas"
        data-scale={scale.toFixed(4)}
        className="absolute touch-none outline-offset-4 select-none"
        style={{ left: (size.width - width) / 2, top: (size.height - height) / 2, width, height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: doc.width,
            height: doc.height,
            transform: `scale(${scale})`,
            transformOrigin: '0 0',
          }}
        >
          <div
            data-a11y-picture
            data-testid="editor-slide"
            style={{
              position: 'absolute',
              inset: 0,
              overflow: 'hidden',
              background: slide.background ?? '#000000',
            }}
          >
            {background?.mediaId && <CueStill mediaId={background.mediaId} props={background.props} />}
            {elements.map((el) =>
              el.id === editing && el.kind === 'text' ? (
                <TextBoxEditor key={el.id} el={el} slideId={slide.id} at={editAt} />
              ) : (
                <ElementView key={el.id} el={el} media="still" />
              ),
            )}
          </div>
          <Selection elements={selected} scale={scale} handles={!editing && single !== undefined} />
          {!editing && selected.length > 1 && <GroupBox elements={selected} scale={scale} />}
          {guides && <GuideLines guides={guides} doc={doc} scale={scale} />}
          {marquee && (
            <div
              data-testid="editor-marquee"
              style={{
                position: 'absolute',
                left: marquee.x,
                top: marquee.y,
                width: marquee.width,
                height: marquee.height,
                border: `${1 / scale}px solid var(--color-accent)`,
                background: 'rgb(91 155 255 / 0.12)',
                pointerEvents: 'none',
              }}
            />
          )}
        </div>
      </div>
      <p id="editor-canvas-status" className="sr-only" aria-live="polite" data-testid="editor-status">
        {status}
      </p>
    </div>
  );
}

/** The slide's background picture or video (its cue), behind everything, as a still. */
function CueStill({ mediaId, props }: { mediaId: string; props: string }) {
  let settings: { media?: 'image' | 'video'; fit?: 'fit' | 'fill' | 'stretch' } = {};
  try {
    settings = JSON.parse(props) as typeof settings;
  } catch {
    // The defaults.
  }
  const media = useMediaKind(mediaId) ?? settings.media ?? 'image';
  return (
    <span style={{ position: 'absolute', inset: 0 }}>
      <MediaStill mediaId={mediaId} media={media} fit={settings.fit ?? 'fit'} />
    </span>
  );
}

/** Whether a media item is a picture or a video, from the library's list. */
function useMediaKind(mediaId: string): 'image' | 'video' | null {
  const kind = useMedia((s) => s.media.find((m) => m.id === mediaId)?.kind);
  return kind === 'image' || kind === 'video' ? kind : null;
}

/** Outlines round the selected elements, and handles to resize and turn one. */
function Selection({
  elements,
  scale,
  handles,
}: {
  elements: SlideElement[];
  scale: number;
  handles: boolean;
}) {
  const px = 1 / scale;
  return (
    <>
      {elements.map((el) => {
        const f = el.frame;
        const line = el.kind === 'shape' && el.shape === 'line';
        const shown = handles ? (line ? (['w', 'e'] as Handle[]) : HANDLES) : [];
        const size = HANDLE_PX * px;
        return (
          <div
            key={el.id}
            data-testid="selection"
            data-selected={el.id}
            style={{
              position: 'absolute',
              left: f.x,
              top: f.y,
              width: f.width,
              height: f.height,
              transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
              outline: `${2 * px}px solid var(--color-accent)`,
              pointerEvents: 'none',
            }}
          >
            {shown.map((h) => (
              <span
                key={h}
                data-handle={h}
                data-testid={`handle-${h}`}
                style={{
                  position: 'absolute',
                  left: HANDLE_AT[h].x * f.width - size / 2,
                  top: HANDLE_AT[h].y * f.height - size / 2,
                  width: size,
                  height: size,
                  background: '#ffffff',
                  border: `${px}px solid var(--color-accent-strong)`,
                  borderRadius: 2 * px,
                  cursor: CURSOR[h],
                  pointerEvents: 'auto',
                }}
              />
            ))}
            {handles && (
              <>
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: f.width / 2 - px / 2,
                    top: -28 * px,
                    width: px,
                    height: 28 * px,
                    background: 'var(--color-accent)',
                  }}
                />
                <span
                  data-handle="rotate"
                  data-testid="handle-rotate"
                  style={{
                    position: 'absolute',
                    left: f.width / 2 - (size * 1.3) / 2,
                    top: -28 * px - (size * 1.3) / 2,
                    width: size * 1.3,
                    height: size * 1.3,
                    borderRadius: '50%',
                    background: '#ffffff',
                    border: `${px}px solid var(--color-accent-strong)`,
                    cursor: 'grab',
                    pointerEvents: 'auto',
                  }}
                />
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

/** The box round several selected elements, with handles to resize and turn them together. */
function GroupBox({ elements, scale }: { elements: SlideElement[]; scale: number }) {
  const box = unionOf(elements.map((el) => boundsOf(el)));
  if (!box) return null;
  const px = 1 / scale;
  const size = HANDLE_PX * px;
  return (
    <div
      data-testid="group-box"
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        outline: `${px}px dashed var(--color-accent)`,
        pointerEvents: 'none',
      }}
    >
      {HANDLES.map((h) => (
        <span
          key={h}
          data-handle={h}
          data-testid={`group-handle-${h}`}
          style={{
            position: 'absolute',
            left: HANDLE_AT[h].x * box.width - size / 2,
            top: HANDLE_AT[h].y * box.height - size / 2,
            width: size,
            height: size,
            background: '#ffffff',
            border: `${px}px solid var(--color-accent-strong)`,
            borderRadius: 2 * px,
            cursor: CURSOR[h],
            pointerEvents: 'auto',
          }}
        />
      ))}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: box.width / 2 - px / 2,
          top: -28 * px,
          width: px,
          height: 28 * px,
          background: 'var(--color-accent)',
        }}
      />
      <span
        data-handle="rotate"
        data-testid="group-handle-rotate"
        style={{
          position: 'absolute',
          left: box.width / 2 - (size * 1.3) / 2,
          top: -28 * px - (size * 1.3) / 2,
          width: size * 1.3,
          height: size * 1.3,
          borderRadius: '50%',
          background: '#ffffff',
          border: `${px}px solid var(--color-accent-strong)`,
          cursor: 'grab',
          pointerEvents: 'auto',
        }}
      />
    </div>
  );
}

/** The lines something snapped to, across the whole slide. */
function GuideLines({ guides, doc, scale }: { guides: Guides; doc: EditDoc; scale: number }) {
  const px = 1 / scale;
  const line = { position: 'absolute', background: 'var(--color-guide)', pointerEvents: 'none' } as const;
  return (
    <>
      {guides.x.map((x) => (
        <div
          key={`x${x}`}
          data-testid="guide"
          data-x={x}
          style={{ ...line, left: x - px / 2, top: 0, width: px, height: doc.height }}
        />
      ))}
      {guides.y.map((y) => (
        <div
          key={`y${y}`}
          data-testid="guide"
          data-y={y}
          style={{ ...line, top: y - px / 2, left: 0, height: px, width: doc.width }}
        />
      ))}
    </>
  );
}

/** Where a point on a turned element is on the slide (for tests and handles). */
export function onSlide(el: SlideElement, share: Point): Point {
  const f = el.frame;
  return rotatePoint(
    { x: f.x + share.x * f.width, y: f.y + share.y * f.height },
    centerOf(f),
    el.rotation ?? 0,
  );
}
