import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Rect, SlideElement, TextElement, TextRun } from '../../../shared/model';
import { SHAPE_NAMES } from '../../../shared/model';
import { groupedSelection } from '../../../shared/element-groups';
import type { EditDoc } from '../../../shared/slide-edit';
import { legacyFontOf } from '../../../shared/slide-edit';
import { useMedia } from '../library/library-store';
import { MediaStill } from '../render/MediaStill';
import { darkensBehind, ElementView, SlideBackdropView } from '../render/SlideView';
import { renderEditedSlide } from '../../../shared/slide-design';
import { TranslitSourceContext } from '../render/lang';
import { translitSource } from '../../../shared/tracks';
import { MeasureContext, type MeasureReport } from '../render/measure';
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
import type { TextPatch } from './ops';
import {
  deleteElements,
  duplicateElements,
  findSlide,
  mapElements,
  moveElements,
  rotateElements,
  scaleElements,
  changeSlide,
  styleBox,
} from './ops';
import { copyElements, pasteElements } from './clipboard';
import { finishTextEditing, TextBoxEditor } from './TextBoxEditor';
import { SafeAreas } from './SafeAreas';
import { connectSafeAreas } from './safe-areas-store';
import { cutText } from '../../../shared/text';
import { Button, IconButton } from '../ui/Button';
import { cx } from '../ui/cx';
import { ZoomIn, ZoomOut } from '../ui/icons';
import type { Zoom } from './zoom';
import { scaleFor, zoomBy, zoomIn, zoomLabel, zoomOut, zoomScroll } from './zoom';

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
      /** Pressed on one of several selected: a click (no drag) leaves only this one selected. */
      narrowTo: string | null;
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
  | { kind: 'guide'; axis: 'x' | 'y'; index: number; startDoc: EditDoc }
  | { kind: 'marquee'; start: Point; base: string[] };

/** The angle (degrees) from `c` to `p`. */
const angleOf = (c: Point, p: Point) => (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI;

const KIND_NAME: Record<SlideElement['kind'], string> = {
  text: 'Text box',
  shape: 'Shape',
  image: 'Picture',
  video: 'Video',
  timer: 'Timer',
};

/** How an element is read out: its kind and words, or its kind. */
export function elementName(el: SlideElement): string {
  if (el.kind === 'text') {
    const words = el.text.trim().replace(/\s+/gu, ' ');
    return words ? `${KIND_NAME.text}: ${cutText(words, 40)}` : `${KIND_NAME.text} (empty)`;
  }
  if (el.kind === 'shape') return SHAPE_NAMES[el.shape ?? 'rectangle'];
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

/** A text box's measure kept in the editor's store, when it changed (the inspector reads it). */
const keepMeasure: MeasureReport = (id, measured) => {
  const now = useEditor.getState().measured;
  const was = now[id];
  if (measured === null ? was === undefined : was?.over === measured.over && was.fit === measured.fit) return;
  const { [id]: _was, ...rest } = now;
  useEditor.setState({ measured: measured === null ? rest : { ...rest, [id]: measured } });
};

export function Canvas({ platform }: { platform: string }) {
  // View › Show Safe Areas: its switch, from the main process.
  useEffect(() => {
    connectSafeAreas();
  }, []);
  const doc = useEditor((s) => s.doc);
  const slideId = useEditor((s) => s.slideId);
  const selection = useEditor((s) => s.selection);
  const editing = useEditor((s) => s.editing);
  const zoom = useEditor((s) => s.zoom);
  const aids = useEditor((s) => s.aids);
  const previewAt = useEditor((s) => s.previewAt);
  const area = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const size = useElementSize(area);
  // Zoomed about a point (a pinch): the area scrolled, once drawn at the new size, so that point stays put.
  const keepPoint = useRef<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = area.current;
    const keep = keepPoint.current;
    if (!el || !keep) return;
    keepPoint.current = null;
    el.scrollLeft = keep.left;
    el.scrollTop = keep.top;
  });
  // A pinch on the trackpad (the wheel with Ctrl) zooms about the pointer; the page itself never zooms. Read from the
  // editor and the area as it is when the wheel turns.
  const hasDoc = doc !== null;
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const now = useEditor.getState();
      const d = now.doc;
      if (!d) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      const fit = Math.max(0.05, Math.min((w - 2 * PAD) / d.width, (h - 2 * PAD) / d.height));
      const scale = scaleFor(now.zoom, fit);
      const next = zoomBy(now.zoom, fit, Math.exp(-e.deltaY * 0.01));
      if (Math.abs(next - scale) < 1e-4) return;
      const r = el.getBoundingClientRect();
      const at = { x: e.clientX - r.left, y: e.clientY - r.top };
      const keep = (pointer: number, scroll: number, area: number, length: number) =>
        zoomScroll({
          pointer,
          scroll,
          offset: Math.max(PAD, (area - length * scale) / 2),
          offsetAfter: Math.max(PAD, (area - length * next) / 2),
          from: scale,
          to: next,
        });
      keepPoint.current = {
        left: keep(at.x, el.scrollLeft, w, d.width),
        top: keep(at.y, el.scrollTop, h, d.height),
      };
      useEditor.setState({ zoom: next });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
    };
  }, [hasDoc]);
  const drag = useRef<Drag | null>(null);
  const [guides, setGuides] = useState<Guides | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [editAt, setEditAt] = useState<Point | null>(null);
  /** When Paste in place's keys went down: the paste event that same press can also make is not a second paste. */
  const pastedInPlaceAt = useRef<number | null>(null);
  const slide = doc ? findSlide(doc, slideId) : undefined;
  if (!doc || !slide) return <div ref={area} className="min-w-0 flex-1 bg-ink" />;

  // Fitted to the area, as the editor always opened; zoomed, a size of its own (Session 55, Part 17a).
  const fit = Math.max(
    0.05,
    Math.min((size.width - 2 * PAD) / doc.width, (size.height - 2 * PAD) / doc.height),
  );
  const scale = scaleFor(zoom, fit);
  const width = doc.width * scale;
  const height = doc.height * scale;
  // Where the slide sits: in the middle while it fits, else PAD in from the scrolled area's edges.
  const left = Math.max(PAD, (size.width - width) / 2);
  const top = Math.max(PAD, (size.height - height) / 2);
  const elements = slide.elements;
  const rendered = renderEditedSlide(doc, slide);
  const fixedIds = new Set(rendered.masterElementIds);
  const fixed = rendered.elements.filter((el) => fixedIds.has(el.id));
  // The words the whole-picture darkening goes under: the first box with any, or a Timer (Session 50).
  const wholeUnder = slide.darken?.kind === 'whole' ? elements.find(darkensBehind)?.id : undefined;
  const selected = elements.filter((e) => selection.includes(e.id));
  const single = selected.length === 1 ? selected[0] : undefined;
  const background = slide.cues.find((c) => c.kind === 'background' && c.mediaId !== null);

  /** Where the pointer is on the slide, in slide pixels. */
  const pointOf = (e: { clientX: number; clientY: number }): Point => {
    const r = stage.current?.getBoundingClientRect();
    return r ? { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale } : { x: 0, y: 0 };
  };
  const linesWithout = (ids: readonly string[]) => {
    const lines = snapLines(
      doc,
      elements.filter((e) => !ids.includes(e.id)).map((e) => boundsOf(e)),
    );
    return {
      x: [
        ...lines.x,
        ...(slide.guides?.x ?? []),
        ...(aids.grid ? Array.from({ length: Math.floor(doc.width / 50) + 1 }, (_, i) => i * 50) : []),
      ],
      y: [
        ...lines.y,
        ...(slide.guides?.y ?? []),
        ...(aids.grid ? Array.from({ length: Math.floor(doc.height / 50) + 1 }, (_, i) => i * 50) : []),
      ],
    };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const p = pointOf(e);
    const handle = target.closest<HTMLElement>('[data-handle]')?.dataset['handle'];
    const guide = target.closest<HTMLElement>('[data-guide-axis]');
    const hit = hitTest(elements, p, 6 / scale);
    // Typing in a box: clicks inside it place the caret; anywhere else ends the typing.
    if (editing) {
      if (hit === editing && !handle && !guide) return;
      finishTextEditing();
    }
    e.preventDefault();
    stage.current?.focus();
    const now = useEditor.getState();
    if (!now.doc) return;
    if (guide) {
      const axis = guide.dataset['guideAxis'];
      const index = Number(guide.dataset['guideIndex']);
      if (
        (axis === 'x' || axis === 'y') &&
        Number.isInteger(index) &&
        slide.guides?.[axis][index] !== undefined
      ) {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { kind: 'guide', axis, index, startDoc: now.doc };
        beginGesture();
      }
      return;
    }
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
      let ids = now.selection;
      const members = groupedSelection(elements, [hit]);
      if (additive)
        ids = members.every((id) => ids.includes(id))
          ? ids.filter((id) => !members.includes(id))
          : [...ids, ...members];
      else if (!ids.includes(hit)) ids = members;
      select(ids);
      ids = useEditor.getState().selection;
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
        narrowTo: !additive && ids.length > 1 ? hit : null,
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
    const free = e.altKey || !aids.snap;
    const within = SNAP_PX / scale;
    if (d.kind === 'guide') {
      const base = findSlide(d.startDoc, slide.id)?.guides;
      if (!base) return;
      const value = Math.round(Math.max(0, Math.min(d.axis === 'x' ? doc.width : doc.height, p[d.axis])));
      updateGesture(
        changeSlide(d.startDoc, slide.id, {
          guides: {
            ...base,
            [d.axis]: base[d.axis].map((n, i) => (i === d.index ? value : n)),
          },
        }),
      );
    } else if (d.kind === 'move') {
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
    // A click on one of several selected elements (pressed there to drag them all, but not moved).
    if (d.kind === 'move' && !d.dragging && d.narrowTo) {
      select([d.narrowTo]);
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
    // Any other key: a paste after it is a paste of its own.
    pastedInPlaceAt.current = null;
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
    // ⌘B, ⌘I and ⌘U (Ctrl on Windows): the text boxes selected, bold, italic or underlined, and back (Session 55,
    // Part 17a, as the Words group's buttons; while typing, the words selected: TextBoxEditor's keys).
    const toggle = { b: 'bold', i: 'italic', u: 'underline' } as const;
    const which =
      mod && !e.altKey && !e.shiftKey ? toggle[e.key.toLowerCase() as keyof typeof toggle] : undefined;
    if (which) {
      const boxes = elements.filter(
        (el): el is TextElement =>
          el.kind === 'text' && selection.includes(el.id) && legacyFontOf(el) === null,
      );
      const first = boxes[0];
      if (!first) return;
      e.preventDefault();
      const every = (has: (run: TextRun) => boolean) =>
        (first.runs ?? []).some((r) => r.text.trim() !== '') &&
        (first.runs ?? []).filter((r) => r.text.trim() !== '').every(has);
      const patch: TextPatch =
        which === 'bold'
          ? { weight: first.style.fontWeight >= 650 ? 400 : 700 }
          : which === 'italic'
            ? { italic: !every((r) => r.italic === true) }
            : { underline: !every((r) => r.underline === true) };
      commit(
        mapElements(
          now.doc,
          slide.id,
          boxes.map((b) => b.id),
          (el) => (el.kind === 'text' ? styleBox(el, patch) : el),
        ),
      );
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
    const inPlaceAt = pastedInPlaceAt.current;
    pastedInPlaceAt.current = null;
    if (inPlaceAt !== null && e.timeStamp - inPlaceAt < 300) return;
    paste(false);
  };

  const status =
    selected.length === 0
      ? 'Nothing selected'
      : single
        ? `${elementName(single)} selected, at ${Math.round(single.frame.x)}, ${Math.round(single.frame.y)}, ${Math.round(single.frame.width)} by ${Math.round(single.frame.height)}`
        : `${selected.length} elements selected`;

  return (
    <div className="relative min-w-0 flex-1 bg-ink">
      <div
        ref={area}
        className={cx('absolute inset-0', zoom === 'fit' ? 'overflow-hidden' : 'overflow-auto')}
        data-testid="editor-canvas-area"
      >
        {/* Zoomed in, the room the slide takes (with PAD round it): the area scrolls over it. */}
        {zoom !== 'fit' && (
          <div aria-hidden="true" style={{ width: left + width + PAD, height: top + height + PAD }} />
        )}
        <div
          ref={stage}
          role="application"
          aria-roledescription="slide"
          aria-label="The slide. Tab chooses the next element, the arrow keys move it (Shift for ten pixels), Enter types in a text box, Delete removes. Copy, Cut and Paste work on elements; Shift with Paste puts them exactly where they were."
          aria-describedby="editor-canvas-status"
          tabIndex={0}
          data-testid="editor-canvas"
          data-scale={scale.toFixed(4)}
          data-fit={fit.toFixed(4)}
          className="absolute touch-none outline-offset-4 select-none"
          style={{ left, top, width, height }}
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
              data-preview-motion={previewAt === null ? undefined : 'true'}
              style={{
                position: 'absolute',
                inset: 0,
                overflow: 'hidden',
                background: rendered.background ?? '#000000',
              }}
            >
              {background?.mediaId && <CueStill mediaId={background.mediaId} props={background.props} />}
              <SlideBackdropView slide={rendered} />
              {fixed.length > 0 && (
                <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} data-master-content="">
                  {fixed.map((el) => (
                    <ElementView key={el.id} el={el} media="still" previewAt={previewAt ?? undefined} />
                  ))}
                </div>
              )}
              {/* Each text box's measure, for the inspector (words past the box, the size drawn); what the
                slide's transliteration is of, for its words' lang (Sessions 31–36, I18N-4). */}
              <TranslitSourceContext.Provider value={translitSource(elements)}>
                <MeasureContext.Provider value={keepMeasure}>
                  {elements.map((el) => [
                    // Darkening behind the words (Sessions 31–36, SLD-3), as the screens draw it.
                    el.id === wholeUnder && slide.darken ? (
                      <div
                        key="darken"
                        data-darken="whole"
                        style={{
                          position: 'absolute',
                          inset: 0,
                          background: `rgba(0, 0, 0, ${String(slide.darken.strength)})`,
                          pointerEvents: 'none',
                        }}
                      />
                    ) : null,
                    el.id === editing && el.kind === 'text' ? (
                      <TextBoxEditor key={el.id} el={el} slideId={slide.id} at={editAt} />
                    ) : (
                      <ElementView
                        key={el.id}
                        el={el}
                        media="still"
                        previewAt={previewAt ?? undefined}
                        band={
                          slide.darken?.kind === 'band' && darkensBehind(el)
                            ? slide.darken.strength
                            : undefined
                        }
                      />
                    ),
                  ])}
                </MeasureContext.Provider>
              </TranslitSourceContext.Provider>
            </div>
            <Selection elements={selected} scale={scale} handles={!editing && single !== undefined} />
            {aids.grid && (
              <svg
                data-testid="editor-grid"
                aria-hidden="true"
                width={doc.width}
                height={doc.height}
                className="pointer-events-none absolute inset-0"
              >
                <defs>
                  <pattern id="editor-grid-pattern" width={50} height={50} patternUnits="userSpaceOnUse">
                    <path
                      d="M50 0 H0 V50"
                      fill="none"
                      stroke="#9aa9cf"
                      strokeOpacity="0.4"
                      strokeWidth={1 / scale}
                    />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#editor-grid-pattern)" />
              </svg>
            )}
            {aids.guides && (
              <div data-testid="editor-guides" className="pointer-events-none absolute inset-0">
                <GuideLines
                  editable
                  guides={slide.guides ?? { x: [doc.width / 2], y: [doc.height / 2] }}
                  doc={doc}
                  scale={scale}
                />
              </div>
            )}
            {aids.rulers && (
              <svg
                data-testid="editor-rulers"
                aria-hidden="true"
                width={doc.width}
                height={doc.height}
                className="pointer-events-none absolute inset-0 overflow-visible"
              >
                {Array.from({ length: Math.floor(doc.width / 100) + 1 }, (_, i) => (
                  <text key={`x${i}`} x={i * 100} y={-8 / scale} fill="#c8d0e2" fontSize={9 / scale}>
                    {i * 100}
                  </text>
                ))}
                {Array.from({ length: Math.floor(doc.height / 100) + 1 }, (_, i) => (
                  <text
                    key={`y${i}`}
                    x={-5 / scale}
                    y={i * 100}
                    textAnchor="end"
                    fill="#c8d0e2"
                    fontSize={9 / scale}
                  >
                    {i * 100}
                  </text>
                ))}
              </svg>
            )}
            {!editing && selected.length > 1 && <GroupBox elements={selected} scale={scale} />}
            {guides && <GuideLines guides={guides} doc={doc} scale={scale} />}
            <SafeAreas slide={doc} scale={scale} />
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
                  background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
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
      <ZoomBar zoom={zoom} fit={fit} />
    </div>
  );
}

/** Zoom (Session 55, Part 17a): out, to fit (its size said), and in; over the slide's area, at its bottom right. */
function ZoomBar({ zoom, fit }: { zoom: Zoom; fit: number }) {
  const set = (next: Zoom) => {
    useEditor.setState({ zoom: next });
  };
  return (
    <div
      role="group"
      aria-label="Zoom"
      className="absolute right-2 bottom-2 z-10 flex items-center gap-0.5 rounded-lg border border-line bg-panel-2 p-0.5 shadow-overlay"
    >
      <IconButton
        icon={ZoomOut}
        size="sm"
        label="Zoom out"
        data-testid="zoom-out"
        onClick={() => {
          set(zoomOut(zoom, fit));
        }}
      />
      <Button
        size="sm"
        variant={zoom === 'fit' ? 'secondary' : 'ghost'}
        aria-pressed={zoom === 'fit'}
        aria-label={`Fit to the window (now ${zoomLabel(zoom, fit)})`}
        data-testid="zoom-fit"
        className="w-14 tabular-nums"
        onClick={() => {
          set('fit');
        }}
      >
        {zoomLabel(zoom, fit)}
      </Button>
      <IconButton
        icon={ZoomIn}
        size="sm"
        label="Zoom in"
        data-testid="zoom-in"
        onClick={() => {
          set(zoomIn(zoom, fit));
        }}
      />
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
                  border: `${px}px solid var(--color-selection)`,
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
                    border: `${px}px solid var(--color-selection)`,
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
            border: `${px}px solid var(--color-selection)`,
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
          border: `${px}px solid var(--color-selection)`,
          cursor: 'grab',
          pointerEvents: 'auto',
        }}
      />
    </div>
  );
}

/** The lines something snapped to, across the whole slide. */
function GuideLines({
  guides,
  doc,
  scale,
  editable = false,
}: {
  guides: Guides;
  doc: EditDoc;
  scale: number;
  editable?: boolean;
}) {
  const px = 1 / scale;
  const grab = editable ? 8 * px : px;
  const line = {
    position: 'absolute',
    background: editable ? 'transparent' : 'var(--color-guide)',
    pointerEvents: editable ? 'auto' : 'none',
  } as const;
  return (
    <>
      {guides.x.map((x, i) => (
        <div
          key={`x${i}`}
          data-testid="guide"
          data-x={x}
          data-guide-axis={editable ? 'x' : undefined}
          data-guide-index={editable ? i : undefined}
          style={{
            ...line,
            left: x - grab / 2,
            top: 0,
            width: grab,
            height: doc.height,
            cursor: editable ? 'col-resize' : undefined,
          }}
        >
          {editable && (
            <div
              style={{
                position: 'absolute',
                left: grab / 2,
                top: 0,
                width: px,
                height: '100%',
                background: 'var(--color-guide)',
              }}
            />
          )}
        </div>
      ))}
      {guides.y.map((y, i) => (
        <div
          key={`y${i}`}
          data-testid="guide"
          data-y={y}
          data-guide-axis={editable ? 'y' : undefined}
          data-guide-index={editable ? i : undefined}
          style={{
            ...line,
            top: y - grab / 2,
            left: 0,
            height: grab,
            width: doc.width,
            cursor: editable ? 'row-resize' : undefined,
          }}
        >
          {editable && (
            <div
              style={{
                position: 'absolute',
                top: grab / 2,
                left: 0,
                height: px,
                width: '100%',
                background: 'var(--color-guide)',
              }}
            />
          )}
        </div>
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
