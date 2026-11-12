import { create } from 'zustand';
import { useMemo } from 'react';
import type { EditDoc, SlideLook } from '../../../shared/slide-edit';
import { legacyFontOf, slidesOf } from '../../../shared/slide-edit';
import { findSlide } from './ops';
import type { Measured } from '../render/measure';
import type { Zoom } from './zoom';
import type { PdfCanvasTool } from './pdf-marks';
import type { Point } from './geometry';
import { groupedSelection } from '../../../shared/element-groups';
import { sizeLook } from '../../../shared/slide-size';
import { slideCanvas } from '../../../shared/document-page';
import { convertSourceContent, SourceConversionGate, sourceContentChanges } from './source-conversion';

/*
 * The slide editor: the presentation being edited (a copy, changed freely
 * and saved as one change), its own Undo and Redo, which slide is shown,
 * what is selected, and the text box being typed in. Since Session 55 (Part 17a) it lives in a window of its own: a
 * save there comes back to the operator window as one change for its Undo (main tells it), and saving, throwing the
 * changes away or closing with none closes the window. It has groups along its top (the one chosen kept here), zoom,
 * and find and replace.
 */

/** The editor's groups along its top (Session 55, Part 17a). */
export type EditorGroup = 'words' | 'insert' | 'arrange' | 'design' | 'motion' | 'slides' | 'pdf';

/**
 * A change the editor makes outside the presentation (Session 55, Part 17a): Drashti's default transition, a slide
 * timer's own time and kind (the library's timer). Saved at once, it is a step of the editor's Undo and Redo all the
 * same, in its turn: taken back and given again by its own two.
 */
export interface OutsideStep {
  outside: true;
  undo: () => void;
  redo: () => void;
}

/** A step for Undo: the document as it was before it, or a change outside the presentation. */
export type EditStep = EditDoc | OutsideStep;

const isOutside = (step: EditStep): step is OutsideStep => 'outside' in step;

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
  /** Preparation limits for imported source objects, separate from unreadable stored elements. */
  sourceIssues: string[];
  slideId: string | null;
  /** Selected elements on the slide shown. */
  selection: string[];
  /** The text box being typed in. */
  editing: string | null;
  /** Where to put the caret when a pointer opened this text box. */
  editingAt: Point | null;
  past: EditStep[];
  future: EditStep[];
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
  /** Editor view aids; guides themselves are saved on their slide. */
  aids: { snap: boolean; guides: boolean; rulers: boolean; grid: boolean };
  strip: boolean;
  masterReturnId: string | null;
  previewAt: number | null;
  /** An animated imported page asks before typing, content changes or drag previews. */
  sourceConversion: { slideIds: string[] } | null;
  /** A page-mark tool and its unfinished local pointer preview, never saved content. */
  pdfTool: PdfCanvasTool | null;
  pdfDrawing: boolean;
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
  sourceIssues: [],
  slideId: null,
  selection: [],
  editing: null,
  editingAt: null,
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
  aids: { snap: true, guides: false, rulers: false, grid: false },
  strip: false,
  masterReturnId: null,
  previewAt: null,
  sourceConversion: null,
  pdfTool: null,
  pdfDrawing: false,
};

export const useEditor = create<EditorView>(() => closed);

const sourceGate = new SourceConversionGate();
let sourcePromptView: Pick<
  EditorView,
  'group' | 'selection' | 'editing' | 'editingAt' | 'previewAt' | 'made' | 'pdfTool'
> | null = null;

function requestSourceConversion(ids: readonly string[], resume?: () => void, next?: EditDoc): boolean {
  const s = useEditor.getState();
  if (!s.doc) return false;
  if (sourceGate.request(s.doc, ids, resume, next)) return true;
  if (!s.sourceConversion && sourceGate.pending) {
    const present = new Set(slidesOf(s.doc).flatMap((slide) => slide.elements.map((element) => element.id)));
    sourcePromptView = {
      group: s.group,
      selection: s.selection,
      editing: s.editing,
      editingAt: s.editingAt,
      previewAt: s.previewAt,
      made: s.made.filter((id) => present.has(id)),
      pdfTool: s.pdfTool,
    };
    useEditor.setState({ sourceConversion: { slideIds: sourceGate.pending.slideIds } });
  }
  return false;
}

/** Ask before a live content intent; drags are tried again after acknowledgement. */
export function allowSourceContent(slideId: string | null, resume?: () => void): boolean {
  return slideId !== null && requestSourceConversion([slideId], resume);
}

/** Acceptance itself is neither a document change nor an Undo step. */
export function acceptSourceConversion(): void {
  const resume = sourceGate.accept(useEditor.getState().doc);
  sourcePromptView = null;
  useEditor.setState({ sourceConversion: null });
  resume?.();
}

export function cancelSourceConversion(): void {
  sourceGate.reset();
  const before = sourcePromptView;
  sourcePromptView = null;
  useEditor.setState({ ...before, sourceConversion: null });
}

/** An abandoned typing session, or Undo back to its original words, needs notice again. */
export function revokeSourceContent(slideId: string): void {
  sourceGate.consume([slideId]);
}

export function currentLook(): SlideLook | null {
  const s = useEditor.getState();
  return s.look && s.doc && s.opened
    ? sizeLook(s.look, s.opened, slideCanvas(findSlide(s.doc, s.slideId), s.doc))
    : s.look;
}

export function useEditorLook(): SlideLook | null {
  const look = useEditor((s) => s.look);
  const fromWidth = useEditor((s) => s.opened?.width);
  const fromHeight = useEditor((s) => s.opened?.height);
  const width = useEditor((s) => (s.doc ? slideCanvas(findSlide(s.doc, s.slideId), s.doc).width : undefined));
  const height = useEditor((s) =>
    s.doc ? slideCanvas(findSlide(s.doc, s.slideId), s.doc).height : undefined,
  );
  return useMemo(
    () =>
      look && fromWidth && fromHeight && width && height
        ? sizeLook(look, { width: fromWidth, height: fromHeight }, { width, height })
        : look,
    [look, fromWidth, fromHeight, width, height],
  );
}

export const isDirty = (s: EditorView): boolean => s.doc !== null && s.doc !== s.opened;

/** Open the editor on a presentation, at a slide (or its first); `name` until its slides say theirs. */
export async function openSlideEditor(presentationId: string, name: string, slideId: string | null = null) {
  cancelSourceConversion();
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
    sourceIssues: result.sourceIssues ?? [],
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
  cancelSourceConversion();
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
  const changedSources = sourceContentChanges(s.doc, next);
  if (!requestSourceConversion(changedSources, () => commit(next, options), next)) return;
  next = convertSourceContent(next, changedSources);
  sourceGate.consume(changedSources);
  const now = Date.now();
  const joins =
    options.coalesce !== undefined &&
    s.coalesce?.key === options.coalesce &&
    now - s.coalesce.at < COALESCE_MS &&
    s.past.length > 0;
  useEditor.setState({
    doc: next,
    previewAt: null,
    past: joins ? s.past : [...s.past.slice(1 - HISTORY), s.doc],
    future: [],
    coalesce: options.coalesce !== undefined ? { key: options.coalesce, at: now } : null,
    selection: validSelection(next, s.slideId, options.select ?? s.selection),
  });
}

/** Start a drag: changes until it ends are shown, and are one step for Undo. */
export function beginGesture(): void {
  const s = useEditor.getState();
  if (s.doc && !s.gesture) useEditor.setState({ gesture: s.doc, previewAt: null });
}

/** The document while dragging (not a step yet). */
export function updateGesture(next: EditDoc): void {
  const s = useEditor.getState();
  if (!s.gesture || !s.doc) return;
  const changedSources = sourceContentChanges(s.gesture, next);
  if (!requestSourceConversion(changedSources)) {
    useEditor.setState({ gesture: null });
    return;
  }
  useEditor.setState({ doc: convertSourceContent(next, changedSources) });
  sourceGate.consume(changedSources);
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
  cancelSourceConversion();
  const s = useEditor.getState();
  const prev = s.past.at(-1);
  if (!prev || !s.doc || s.editing) return;
  if (isOutside(prev)) {
    prev.undo();
    useEditor.setState({ past: s.past.slice(0, -1), future: [prev, ...s.future], coalesce: null });
    return;
  }
  const slideId = findSlide(prev, s.slideId) ? s.slideId : (slidesOf(prev)[0]?.id ?? null);
  useEditor.setState({
    doc: prev,
    previewAt: null,
    past: s.past.slice(0, -1),
    future: [s.doc, ...s.future],
    coalesce: null,
    slideId,
    selection: validSelection(prev, slideId, s.selection),
  });
}

export function redo(): void {
  cancelSourceConversion();
  const s = useEditor.getState();
  const next = s.future[0];
  if (!next || !s.doc || s.editing) return;
  if (isOutside(next)) {
    next.redo();
    useEditor.setState({ past: [...s.past, next], future: s.future.slice(1), coalesce: null });
    return;
  }
  const slideId = findSlide(next, s.slideId) ? s.slideId : (slidesOf(next)[0]?.id ?? null);
  useEditor.setState({
    doc: next,
    past: [...s.past, s.doc],
    previewAt: null,
    future: s.future.slice(1),
    coalesce: null,
    slideId,
    selection: validSelection(next, slideId, s.selection),
  });
}

/** A change made outside the presentation, now (Session 55, Part 17a): one step for Undo, nothing left to redo. */
export function noteOutside(step: { undo: () => void; redo: () => void }): void {
  const s = useEditor.getState();
  useEditor.setState({
    past: [...s.past.slice(1 - HISTORY), { outside: true, ...step }],
    future: [],
    coalesce: null,
  });
}

export function select(ids: readonly string[], { expandGroups = true } = {}): void {
  const s = useEditor.getState();
  if (!s.doc) return;
  const elements = findSlide(s.doc, s.slideId)?.elements ?? [];
  useEditor.setState({
    selection: validSelection(s.doc, s.slideId, expandGroups ? groupedSelection(elements, ids) : ids),
    previewAt: null,
    editing: null,
    editingAt: null,
  });
}

export function showSlide(slideId: string): void {
  const s = useEditor.getState();
  if (!s.doc || !findSlide(s.doc, slideId)) return;
  cancelSourceConversion();
  useEditor.setState({
    slideId,
    selection: [],
    editing: null,
    editingAt: null,
    previewAt: null,
    pdfTool: null,
    pdfDrawing: false,
  });
}

export function startEditing(elementId: string, at: Point | null = null): void {
  const s = useEditor.getState();
  const element = s.doc ? findSlide(s.doc, s.slideId)?.elements.find((el) => el.id === elementId) : undefined;
  if (element?.kind !== 'text') {
    // Insert Text calls commit then starts typing. Its proposed element is not
    // published until the pending content change is accepted.
    const proposed = sourceGate.pending?.next;
    if (
      proposed &&
      findSlide(proposed, s.slideId)?.elements.some((el) => el.id === elementId && el.kind === 'text')
    )
      sourceGate.pending?.after.push(() => startEditing(elementId, at));
    return;
  }
  if (element.hidden) return;
  const legacy = legacyFontOf(element);
  if (legacy) {
    tell(
      `These words are typed in a legacy font (${legacy}): the box can be moved and resized, but its words cannot be edited yet.`,
    );
    return;
  }
  if (!allowSourceContent(s.slideId, () => startEditing(elementId, at))) return;
  useEditor.setState({ editing: elementId, editingAt: at, selection: [elementId], previewAt: null });
}

/** Tell the operator something, in the editor. */
export function tell(note: string | null): void {
  useEditor.setState({ note });
}

export function stopEditing(): void {
  const s = useEditor.getState();
  if (s.slideId) revokeSourceContent(s.slideId);
  const elements = s.doc ? findSlide(s.doc, s.slideId)?.elements : undefined;
  useEditor.setState({
    editing: null,
    editingAt: null,
    ...(s.editing && elements ? { selection: groupedSelection(elements, s.selection) } : {}),
  });
}

/** Remember that an element was made here (its typed words take the theme's look). */
export function noteMade(id: string): void {
  useEditor.setState((s) => ({ made: [...s.made, id] }));
}

/** Save the changes as one change for the operator window's Undo, and close. */
export async function saveSlides(force = false): Promise<void> {
  const s = useEditor.getState();
  if (s.sourceConversion) return;
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
