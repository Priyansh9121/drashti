import { create } from 'zustand';
import type { EditDoc, SlideLook } from '../../../shared/slide-edit';
import { slidesOf } from '../../../shared/slide-edit';
import { findSlide } from './ops';
import type { Measured } from '../render/measure';
import type { Zoom } from './zoom';

/*
 * The slide editor: the presentation being edited (a copy, changed freely
 * and saved as one change), its own Undo and Redo, which slide is shown,
 * what is selected, and the text box being typed in. Since Session 55 (Part 17a) it lives in a window of its own: a
 * save there comes back to the operator window as one change for its Undo (main tells it), and saving, throwing the
 * changes away or closing with none closes the window. It has groups along its top (the one chosen kept here), zoom,
 * and find and replace.
 */

/** The editor's groups along its top (Session 55, Part 17a). */
export type EditorGroup = 'words' | 'insert' | 'arrange' | 'design' | 'motion' | 'slides';

/** How many steps the editor's Undo remembers. */
const HISTORY = 200;
/** Arrow-key nudges this close together are one step for Undo. */
const COALESCE_MS = 1000;

export interface EditorView {
  open: { presentationId: string; name: string } | null;
  loading: boolean;
  /** Why it could not open or save. */
  problem: string | null;
  doc: EditDoc | null;
  /** The document as it was opened: anything else has changes to save. */
  opened: EditDoc | null;
  stamp: string;
  look: SlideLook | null;
  unreadable: number;
  slideId: string | null;
  /** Selected elements on the slide shown. */
  selection: string[];
  /** The text box being typed in. */
  editing: string | null;
  past: EditDoc[];
  future: EditDoc[];
  /** The last step that later ones may join (arrow-key nudges). */
  coalesce: { key: string; at: number } | null;
  /** The document before a drag started: the drag is one step. */
  gesture: EditDoc | null;
  saving: boolean;
  /** Asking whether to throw the changes away. */
  askDiscard: boolean;
  /** The presentation changed somewhere else since it was opened: asking whether to save anyway. */
  conflict: string | null;
  /** Elements made in this editor: words typed in them take the theme's look per language. */
  made: string[];
  /** Goes up as words are typed or the caret moves (the inspector shows the look at the caret). */
  textTick: number;
  /** Something to tell the operator in the editor (the operator window's notices are underneath it). */
  note: string | null;
  /** Each text box on the slide shown, as measured where it is drawn (its words past it, its fit). */
  measured: Readonly<Record<string, Measured>>;
  /** The group chosen along the top (Session 55, Part 17a). */
  group: EditorGroup;
  /** How big the slide is drawn: fitted to its area, or a scale of its own (Session 55, Part 17a). */
  zoom: Zoom;
  /** Find and replace is open (Session 55, Part 17a). */
  finding: boolean;
  /** While typing in a text box: how many steps of its typing Undo and Redo can take (Session 55, Part 17a). */
  typing: { undo: number; redo: number };
}

const closed: EditorView = {
  open: null,
  loading: false,
  problem: null,
  doc: null,
  opened: null,
  stamp: '',
  look: null,
  unreadable: 0,
  slideId: null,
  selection: [],
  editing: null,
  past: [],
  future: [],
  coalesce: null,
  gesture: null,
  saving: false,
  askDiscard: false,
  conflict: null,
  made: [],
  textTick: 0,
  note: null,
  measured: {},
  group: 'words',
  zoom: 'fit',
  finding: false,
  typing: { undo: 0, redo: 0 },
};

export const useEditor = create<EditorView>(() => closed);

export const isDirty = (s: EditorView): boolean => s.doc !== null && s.doc !== s.opened;

/** Open the editor on a presentation, at a slide (or its first); `name` until its slides say theirs. */
export async function openSlideEditor(presentationId: string, name: string, slideId: string | null = null) {
  // The group along the top stays as it was, as a presentation program keeps it.
  const group = useEditor.getState().group;
  useEditor.setState({ ...closed, group, open: { presentationId, name }, loading: true });
  const result = await window.drashti.library.slidesForEdit(presentationId);
  if (useEditor.getState().open?.presentationId !== presentationId) return;
  if (!result.ok) {
    useEditor.setState({ loading: false, problem: result.message });
    return;
  }
  const slides = slidesOf(result.doc);
  const start = slides.find((s) => s.id === slideId) ?? slides[0];
  useEditor.setState({
    loading: false,
    open: { presentationId, name: result.doc.name },
    doc: result.doc,
    opened: result.doc,
    stamp: result.stamp,
    look: result.look,
    unreadable: result.unreadable,
    slideId: start?.id ?? null,
  });
}

/** The window the editor is in closes (main closes it: Session 55, Part 17a). */
let closeWindow: () => void = () => undefined;

/** Close the editor's window when the editor closes (its own window's page sets this). */
export function setCloseWindow(close: () => void): void {
  closeWindow = close;
}

export function closeSlideEditor(): void {
  // Another presentation's slides waiting (Session 55, Part 17a): they open instead, the window staying.
  const next = pending;
  pending = null;
  useEditor.setState({ ...closed, group: useEditor.getState().group });
  if (next) void openSlideEditor(next.presentationId, '', next.slideId);
  else closeWindow();
}

/** Close, asking first when there are changes. */
export function requestClose(): void {
  const s = useEditor.getState();
  if (isDirty(s)) useEditor.setState({ askDiscard: true });
  else closeSlideEditor();
}

/** Another presentation's slides asked for while this one has changes (Session 55, Part 17a): opened once answered. */
let pending: { presentationId: string; slideId: string | null } | null = null;

/**
 * The window told to open a presentation's slides (Session 55, Part 17a): this one's, at that slide; another's at once
 * when nothing here has changed, else once the question about the changes is answered (Keep editing stays here).
 */
export function switchTo(open: { presentationId: string; slideId: string | null }): void {
  const s = useEditor.getState();
  if (s.open?.presentationId === open.presentationId && s.doc) {
    if (open.slideId) showSlide(open.slideId);
    return;
  }
  if (isDirty(s)) {
    pending = open;
    useEditor.setState({ askDiscard: true });
    return;
  }
  void openSlideEditor(open.presentationId, '', open.slideId);
}

/** The window asked to close with changes (its close button): the question about them, then closed. */
export function askBeforeClosing(): void {
  pending = null;
  if (isDirty(useEditor.getState())) useEditor.setState({ askDiscard: true });
  else closeSlideEditor();
}

/** Keep editing: the question goes, and nothing waits for it any more. */
export function keepEditing(): void {
  pending = null;
  useEditor.setState({ askDiscard: false });
}

/** Keep only selected elements that are on the slide shown. */
function validSelection(doc: EditDoc, slideId: string | null, ids: readonly string[]): string[] {
  const slide = findSlide(doc, slideId);
  return slide ? ids.filter((id) => slide.elements.some((e) => e.id === id)) : [];
}

/** A step for Undo: the new document, the old one remembered. `coalesce` joins steps with the same key. */
export function commit(next: EditDoc, options: { coalesce?: string; select?: string[] } = {}): void {
  const s = useEditor.getState();
  if (!s.doc || next === s.doc) return;
  const now = Date.now();
  const joins =
    options.coalesce !== undefined &&
    s.coalesce?.key === options.coalesce &&
    now - s.coalesce.at < COALESCE_MS &&
    s.past.length > 0;
  useEditor.setState({
    doc: next,
    past: joins ? s.past : [...s.past.slice(1 - HISTORY), s.doc],
    future: [],
    coalesce: options.coalesce !== undefined ? { key: options.coalesce, at: now } : null,
    selection: validSelection(next, s.slideId, options.select ?? s.selection),
  });
}

/** Start a drag: changes until it ends are shown, and are one step for Undo. */
export function beginGesture(): void {
  const s = useEditor.getState();
  if (s.doc && !s.gesture) useEditor.setState({ gesture: s.doc });
}

/** The document while dragging (not a step yet). */
export function updateGesture(next: EditDoc): void {
  if (useEditor.getState().gesture) useEditor.setState({ doc: next });
}

/** End a drag: one step for Undo, if anything moved. */
export function endGesture(): void {
  const s = useEditor.getState();
  if (!s.gesture) return;
  const before = s.gesture;
  if (s.doc === before || !s.doc) {
    useEditor.setState({ gesture: null });
    return;
  }
  useEditor.setState({
    gesture: null,
    past: [...s.past.slice(1 - HISTORY), before],
    future: [],
    coalesce: null,
  });
}

export function undo(): void {
  const s = useEditor.getState();
  const prev = s.past.at(-1);
  if (!prev || !s.doc || s.editing) return;
  const slideId = findSlide(prev, s.slideId) ? s.slideId : (slidesOf(prev)[0]?.id ?? null);
  useEditor.setState({
    doc: prev,
    past: s.past.slice(0, -1),
    future: [s.doc, ...s.future],
    coalesce: null,
    slideId,
    selection: validSelection(prev, slideId, s.selection),
  });
}

export function redo(): void {
  const s = useEditor.getState();
  const next = s.future[0];
  if (!next || !s.doc || s.editing) return;
  const slideId = findSlide(next, s.slideId) ? s.slideId : (slidesOf(next)[0]?.id ?? null);
  useEditor.setState({
    doc: next,
    past: [...s.past, s.doc],
    future: s.future.slice(1),
    coalesce: null,
    slideId,
    selection: validSelection(next, slideId, s.selection),
  });
}

export function select(ids: readonly string[]): void {
  const s = useEditor.getState();
  if (!s.doc) return;
  useEditor.setState({ selection: validSelection(s.doc, s.slideId, ids), editing: null });
}

export function showSlide(slideId: string): void {
  const s = useEditor.getState();
  if (!s.doc || !findSlide(s.doc, slideId)) return;
  useEditor.setState({ slideId, selection: [], editing: null });
}

export function startEditing(elementId: string): void {
  useEditor.setState({ editing: elementId, selection: [elementId] });
}

/** Tell the operator something, in the editor. */
export function tell(note: string | null): void {
  useEditor.setState({ note });
}

export function stopEditing(): void {
  useEditor.setState({ editing: null });
}

/** Remember that an element was made here (its typed words take the theme's look). */
export function noteMade(id: string): void {
  useEditor.setState((s) => ({ made: [...s.made, id] }));
}

/** Save the changes as one change for the operator window's Undo, and close. */
export async function saveSlides(force = false): Promise<void> {
  const s = useEditor.getState();
  if (!s.open || !s.doc || s.saving) return;
  if (!isDirty(s)) {
    closeSlideEditor();
    return;
  }
  useEditor.setState({ saving: true, problem: null, conflict: null });
  const { presentationId } = s.open;
  const result = await window.drashti.library.saveSlides(presentationId, s.doc, s.stamp, force);
  if (!result.ok) {
    useEditor.setState(
      result.changedElsewhere
        ? { saving: false, conflict: result.message }
        : { saving: false, problem: result.message },
    );
    return;
  }
  // One change for the operator window's Undo: main tells it (Session 55, Part 17a).
  closeSlideEditor();
}
