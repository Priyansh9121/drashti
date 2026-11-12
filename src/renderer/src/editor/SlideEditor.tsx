import { slideCanvas } from '../../../shared/document-page';
import { DECK_MOTION_APPROXIMATION } from '../../../shared/deck-edit-motion';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { EditDoc } from '../../../shared/slide-edit';
import type { TextElement } from '../../../shared/model';
import { legacyFontOf, slidesOf } from '../../../shared/slide-edit';
import { renderEditedSlide } from '../../../shared/slide-design';
import { SHOW_F_KEYS } from '../../../shared/keymap';
import { isTyping } from '../operator/useKeymap';
import { loadMedia } from '../library/library-store';
import { PlacedInParent } from '../render/Placed';
import { SlideView } from '../render/SlideView';
import { OversetMark, OversetWatch } from '../render/measure';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import { cx } from '../ui/cx';
import { ConfirmDialog, Dialog, useFocusTrap } from '../ui/Dialog';
import { KeepChangesDialog, SAVES_LIBRARY, savesLive } from '../ui/KeepChanges';
import { plural } from '../ui/text';
import { useEngine } from '../engine/engine-store';
import type { TabItem } from '../ui/Tabs';
import { TabPanel, Tabs } from '../ui/Tabs';
import {
  ArrowLeftRight,
  Download,
  LayoutTemplate,
  ListPlus,
  Palette,
  Redo2,
  Sparkles,
  Type,
  Undo2,
} from '../ui/icons';
import { Notice } from '../ui/Notice';
import { Loading } from '../ui/States';
import { Truncate } from '../ui/Truncate';
import { Canvas } from './Canvas';
import type { EditorGroup } from './editor-store';
import {
  acceptSourceConversion,
  allowSourceContent,
  cancelSourceConversion,
  closeSlideEditor,
  commit,
  isDirty,
  keepEditing,
  requestClose,
  revokeSourceContent,
  saveSlides,
  select,
  showSlide,
  tell,
  useEditor,
} from './editor-store';
import { FindPanel } from './FindPanel';
import { Inspector } from './Inspector';
import { MediaPicker, naturalSize } from './MediaPicker';
import type { Point } from './geometry';
import {
  addElement,
  addSlideAfter,
  changeSlide,
  findSlide,
  mapElements,
  newMedia,
  placeOf,
  placeSlide,
  setSoundCue,
  styleBox,
} from './ops';
import { ArrangeGroup, DesignGroup, InsertGroup, MotionGroup, SlidesGroup } from './Ribbon';
import { activeText, finishTextEditing, redoAny, undoAny } from './TextBoxEditor';
import { WordsGroup } from './WordsGroup';
import { zoomIn, zoomOut } from './zoom';
import { SOURCE_CONVERSION_WARNING } from './source-conversion';
import { PdfTools } from './PdfTools';
import { PdfInsertDialog } from './PdfInsertDialog';
import type { PdfPendingAction } from './PdfTools';
import { SourceLinkDialog } from './SourceLinkDialog';
import { SourceIssues } from './SourceIssues';
import { isPdfPage, pdfEditorTabs, visibleEditorGroup } from './pdf-context';
import { deletePdfPage, turnPdfPageRight } from './pdf-page-ops';
import { restyle, selectedLook } from './runs-doc';
import type { PdfCanvasTool } from './pdf-marks';

/*
 * The slide editor (PLAN.md 5.2, Session 7), since Session 55 (Part 17a) in a window of its own, as a presentation
 * program is laid out but in Drashti's own words and look: its groups along the top (Words, Insert, Arrange, Design,
 * Motion, Slides), each a row of tools; the slides on the left, the slide being edited in the middle (zoomed to fit,
 * or in and out), what is selected (or the slide's own settings) on the right. Undo and Redo take back every change,
 * typing too, by their buttons and keys. Saving is one change for the operator window's Undo; Cancel (or Esc) asks
 * first when there are changes, and so does closing the window.
 */

/** The groups along the top, in their order (Session 55, Part 17a). */
const GROUPS: readonly TabItem<EditorGroup>[] = [
  { id: 'words', label: 'Words', icon: Type },
  { id: 'insert', label: 'Insert', icon: ListPlus },
  { id: 'arrange', label: 'Arrange', icon: ArrowLeftRight },
  { id: 'design', label: 'Design', icon: Palette },
  { id: 'motion', label: 'Motion', icon: Sparkles },
  { id: 'slides', label: 'Slides', icon: LayoutTemplate },
];

export function SlideEditor({ platform }: { platform: string }) {
  const open = useEditor((s) => s.open);
  if (!open) return <Loading label="Opening the slides…" className="h-screen" />;
  return <Editor key={open.presentationId} platform={platform} name={open.name} />;
}

/** As the renderer sees a slide being edited. */
const renderSlide = renderEditedSlide;

function Editor({ platform, name }: { platform: string; name: string }) {
  const root = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const sourceWarningId = useId();
  const loading = useEditor((s) => s.loading);
  const doc = useEditor((s) => s.doc);
  const slideId = useEditor((s) => s.slideId);
  const problem = useEditor((s) => s.problem);
  const saving = useEditor((s) => s.saving);
  const askDiscard = useEditor((s) => s.askDiscard);
  const sourceConversion = useEditor((s) => s.sourceConversion);
  const warningDecks =
    doc && sourceConversion ? sourceConversion.slideIds.map((id) => findSlide(doc, id)?.deck) : [];
  const pdfTool = useEditor((s) => s.pdfTool);
  const pdfDrawing = useEditor((s) => s.pdfDrawing);
  const steps = useEditor((s) => s.past.length);
  const group = useEditor((s) => s.group);
  const strip = useEditor((s) => s.strip);
  const finding = useEditor((s) => s.finding);
  // Its slide is on the screens now: saving changes them at once.
  const presentationId = useEditor((s) => s.open?.presentationId);
  const live = useEngine(
    (e) => presentationId !== undefined && e.state?.layers.slide?.presentationId === presentationId,
  );
  const conflict = useEditor((s) => s.conflict);
  // Undo and Redo, typing too (Session 55, Part 17a): while typing, its own steps first, then the editor's.
  const canUndo = useEditor((s) => s.past.length > 0 || (s.editing !== null && s.typing.undo > 0));
  const canRedo = useEditor((s) => s.future.length > 0 || (s.editing !== null && s.typing.redo > 0));
  const dirty = useEditor(isDirty);
  const unreadable = useEditor((s) => s.unreadable);
  const sourceIssues = useEditor((s) => s.sourceIssues);
  const preparingSource = useEditor((s) => s.slideId !== null && s.preparingSource.has(s.slideId));
  const selection = useEditor((s) => s.selection);
  const editing = useEditor((s) => s.editing);
  useEditor((s) => s.textTick);
  const note = useEditor((s) => s.note);
  const [picking, setPicking] = useState<'picture' | 'sound' | null>(null);
  const [pickingBusy, setPickingBusy] = useState(false);
  const [pdfPending, setPdfPending] = useState<PdfPendingAction>(null);
  const [inserting, setInserting] = useState<{ doc: EditDoc; slideId: string; stamp: string } | null>(null);
  const [linking, setLinking] = useState<{ doc: EditDoc; slideId: string; stamp: string } | null>(null);
  const insertBase = useRef<{ doc: EditDoc; slideId: string; stamp: string } | null>(null);
  const pdfJob = useRef(false);
  const pendingPick = useRef<{ id: number; busy: boolean; save: boolean | null }>({
    id: 0,
    busy: false,
    save: null,
  });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const cancelPicking = useCallback(() => {
    pendingPick.current = { id: pendingPick.current.id + 1, busy: false, save: null };
    setPickingBusy(false);
    setPicking(null);
  }, []);
  const saveWhenReady = useCallback((force = false) => {
    if (pdfJob.current || useEditor.getState().sourceConversion || useEditor.getState().pdfDrawing) return;
    finishTextEditing();
    if (pendingPick.current.busy) pendingPick.current.save = force;
    else void saveSlides(force);
  }, []);
  const placeMedia = (
    load: (
      presentationId: string,
    ) => Promise<{ id: string; kind: 'image' | 'video' } | { message: string } | null>,
    at?: Point,
  ) => {
    const before = useEditor.getState();
    if (
      !before.doc ||
      !before.slideId ||
      before.saving ||
      before.askDiscard ||
      before.sourceConversion ||
      before.pdfDrawing ||
      pendingPick.current.busy
    )
      return;
    finishTextEditing();
    const target = { presentationId: before.doc.presentationId, slideId: before.slideId };
    const request = pendingPick.current.id + 1;
    pendingPick.current = { id: request, busy: true, save: null };
    setPickingBusy(true);
    const current = () => alive.current && pendingPick.current.id === request;
    void (async () => {
      try {
        const media = await load(target.presentationId);
        if (!media || !current()) return;
        if ('message' in media) {
          tell(media.message);
          return;
        }
        const size = await naturalSize(media);
        if (!current()) return;
        const now = useEditor.getState();
        const slide = now.doc ? findSlide(now.doc, target.slideId) : undefined;
        if (now.doc?.presentationId !== target.presentationId || !slide) return;
        const element = newMedia({ ...media, ...(size ?? {}) }, slideCanvas(slide, now.doc), at);
        commit(
          addElement(now.doc, slide.id, element),
          now.slideId === slide.id ? { select: [element.id] } : {},
        );
        const queuedSave = pendingPick.current.save;
        if (queuedSave !== null) void saveSlides(queuedSave);
      } catch {
        if (current()) tell('Drashti couldn’t add the picture or video. Choose it again.');
      } finally {
        if (current()) cancelPicking();
      }
    })();
  };
  const pictureFromComputer = (path: string | null, at?: Point) => {
    if (pdfJob.current || picking !== null) return;
    placeMedia(async (presentationId) => {
      const result = await window.drashti.slideEditor.addPicture(presentationId, path);
      if (!result.ok) return { message: result.message };
      return result.mediaId ? { id: result.mediaId, kind: 'image' } : null;
    }, at);
  };
  const mac = platform === 'darwin';
  const mod = mac ? '⌘' : 'Ctrl+';
  const pdfPage = isPdfPage(doc, slideId);
  const shownGroup = visibleEditorGroup(group, pdfPage);
  const pdfRowVisible = pdfPage && shownGroup === 'pdf';
  const exportBusy =
    loading ||
    saving ||
    picking !== null ||
    pickingBusy ||
    pdfDrawing ||
    sourceConversion !== null ||
    pdfPending !== null;
  const shownPage = doc ? findSlide(doc, slideId) : undefined;
  const pdfBoxes =
    shownPage?.elements.filter(
      (element): element is TextElement =>
        element.kind === 'text' && selection.includes(element.id) && legacyFontOf(element) === null,
    ) ?? [];
  const pdfActive = editing && pdfBoxes.some((box) => box.id === editing) ? activeText() : null;
  const wordLook = pdfActive ? selectedLook(pdfActive.view.state) : {};
  const allMarked = (which: 'underline' | 'strike') =>
    pdfBoxes.length > 0 &&
    pdfBoxes.every((box) => (box.runs?.length ?? 0) > 0 && box.runs?.every((run) => run[which] === true));
  const underlined = wordLook.underline ?? allMarked('underline');
  const struckThrough = wordLook.strike ?? allMarked('strike');
  const choosePdfTool = (tool: PdfCanvasTool) => {
    const now = useEditor.getState();
    if (now.sourceConversion || now.pdfDrawing) return;
    if (now.editing) finishTextEditing();
    select([]);
    useEditor.setState({ pdfTool: now.pdfTool === tool ? null : tool, previewAt: null });
  };
  const applyPdfMark = (which: 'underline' | 'strike') => {
    if (pdfBoxes.length === 0) {
      choosePdfTool(which);
      return;
    }
    const state = useEditor.getState();
    const active = activeText();
    const value = which === 'underline' ? !underlined : !struckThrough;
    if (state.editing === active?.elementId && !active.view.state.selection.empty) {
      active.view.dispatch(restyle(active.view.state, { [which]: value }));
      return;
    }
    finishTextEditing();
    const now = useEditor.getState();
    if (!now.doc || !now.slideId) return;
    commit(
      mapElements(now.doc, now.slideId, now.selection, (element) =>
        element.kind === 'text' && legacyFontOf(element) === null
          ? styleBox(element, { [which]: value })
          : element,
      ),
    );
  };
  const rotatePdfPage = () => {
    finishTextEditing();
    const now = useEditor.getState();
    if (now.doc && now.slideId) commit(turnPdfPageRight(now.doc, now.slideId));
  };
  const deleteCurrentPdfPage = () => {
    finishTextEditing();
    const now = useEditor.getState();
    if (!now.doc || !now.slideId) return;
    const removed = deletePdfPage(now.doc, now.slideId);
    if (!removed) return;
    commit(removed.doc, { select: [] });
    showSlide(removed.show);
  };
  const closeInsertion = () => {
    if (insertBase.current) revokeSourceContent(insertBase.current.slideId);
    insertBase.current = null;
    setLinking(null);
    pdfJob.current = false;
    setInserting(null);
    setPdfPending(null);
  };
  const openInsertion = () => {
    if (pdfJob.current || exportBusy) return;
    finishTextEditing();
    const now = useEditor.getState();
    if (!now.doc || !now.slideId || now.sourceConversion) return;
    insertBase.current = { doc: now.doc, slideId: now.slideId, stamp: now.stamp };
    pdfJob.current = true;
    useEditor.setState({ pdfTool: null });
    setPdfPending('insert-pages');
    setInserting(insertBase.current);
  };
  const openSourceLink = () => {
    if (pdfJob.current || exportBusy) return;
    finishTextEditing();
    const now = useEditor.getState();
    if (!now.doc || !now.slideId || now.sourceConversion) return;
    const begin = () => {
      const current = useEditor.getState();
      if (!current.doc || !current.slideId || current.doc !== now.doc) return;
      insertBase.current = { doc: current.doc, slideId: current.slideId, stamp: current.stamp };
      pdfJob.current = true;
      useEditor.setState({ pdfTool: null });
      setPdfPending('insert-pages');
      setLinking(insertBase.current);
    };
    if (allowSourceContent(now.slideId, begin)) begin();
  };
  const savePdfCopy = async () => {
    const before = useEditor.getState();
    if (
      pdfJob.current ||
      pendingPick.current.busy ||
      picking !== null ||
      pickingBusy ||
      before.loading ||
      before.saving ||
      before.pdfDrawing ||
      before.sourceConversion ||
      before.askDiscard ||
      before.conflict ||
      !before.doc ||
      !before.open
    )
      return;
    finishTextEditing();
    const current = useEditor.getState();
    if (!current.doc || !current.open || current.sourceConversion || current.pdfDrawing) return;
    const snapshot = { id: current.open.presentationId, doc: current.doc, stamp: current.stamp };
    pdfJob.current = true;
    setPdfPending('save-copy');
    useEditor.setState({ pdfTool: null });
    tell(null);
    try {
      const result = await window.drashti.library.exportPdf(snapshot.id, snapshot.doc, snapshot.stamp);
      if (!alive.current || useEditor.getState().open?.presentationId !== snapshot.id) return;
      if (result.ok) tell(`Saved PDF copy “${result.name}”.`);
      else if (!result.cancelled) tell(result.message);
    } catch {
      if (alive.current && useEditor.getState().open?.presentationId === snapshot.id)
        tell('The PDF copy could not be written.');
    } finally {
      pdfJob.current = false;
      if (alive.current) setPdfPending(null);
    }
  };

  // Esc steps back: close find, stop typing, then let go of the selection, then close (asking first).
  useFocusTrap(root, () => {
    const s = useEditor.getState();
    if (pdfJob.current || s.askDiscard || s.conflict || s.sourceConversion) return;
    if (s.finding) useEditor.setState({ finding: false });
    else if (s.pdfTool) {
      if (s.slideId) revokeSourceContent(s.slideId);
      useEditor.setState({ pdfTool: null, pdfDrawing: false });
    } else if (s.editing) finishTextEditing();
    else if (s.selection.length > 0) select([]);
    else requestClose();
  });

  // The library's pictures and videos (names, and the slide's background picture).
  useEffect(() => {
    void loadMedia();
  }, []);

  // The window's keys: Save, Undo and Redo, Find, and zoom; typing in a field or a text box keeps its own keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useEditor.getState().sourceConversion) return;
      // The show's F-keys (Clear all, Oops, the Wallpaper...): the operator window acts on them (Session 55, 17a).
      if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.repeat && SHOW_F_KEYS.includes(e.key)) {
        e.preventDefault();
        void window.drashti.slideEditor.showKey(e.key);
        return;
      }
      const m = mac ? e.metaKey : e.ctrlKey;
      if (!m || e.altKey) return;
      const key = e.key.toLowerCase();
      if (insertBase.current) {
        e.preventDefault();
        return;
      }
      if (key === 's' || e.key === 'Enter') {
        e.preventDefault();
        saveWhenReady();
        return;
      }
      if (key === 'f') {
        e.preventDefault();
        useEditor.setState({ finding: true });
        // Open already: the words to find chosen again.
        document.querySelector<HTMLInputElement>('[data-testid="find-text"]')?.select();
        return;
      }
      // Zoom (Session 55, Part 17a): in, out, and to fit.
      if (e.key === '=' || e.key === '+' || e.code === 'Equal') {
        e.preventDefault();
        zoomBy('in');
        return;
      }
      if (e.key === '-' || e.code === 'Minus') {
        e.preventDefault();
        zoomBy('out');
        return;
      }
      if (e.key === '0' || e.code === 'Digit0') {
        e.preventDefault();
        useEditor.setState({ zoom: 'fit' });
        return;
      }
      if (isTyping(e.target)) return;
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoAny();
      } else if ((key === 'z' && e.shiftKey) || (key === 'y' && !mac)) {
        e.preventDefault();
        redoAny();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [mac, saveWhenReady]);

  return (
    <div
      ref={root}
      tabIndex={-1}
      aria-labelledby={titleId}
      data-testid="slide-editor"
      className="flex h-screen flex-col bg-ink text-fg focus:outline-none"
    >
      <header className="flex shrink-0 items-center gap-1.5 border-b border-line bg-panel px-3 py-1.5">
        <h1 id={titleId} className="min-w-24 flex-[1_1_8rem] text-sm font-bold">
          <Truncate text={`Slides of “${name}”`} />
        </h1>
        <Tabs
          group="editor"
          label="The editor’s groups"
          items={pdfEditorTabs(GROUPS, pdfPage)}
          value={shownGroup}
          size="sm"
          className="max-xl:[&_svg]:hidden"
          onChange={(next) => {
            const now = useEditor.getState();
            if (next !== 'pdf') {
              if (now.pdfTool && now.slideId) revokeSourceContent(now.slideId);
              useEditor.setState({ group: next, pdfTool: null, pdfDrawing: false });
            } else useEditor.setState({ group: next });
          }}
        />
        <Tooltip content="Undo the last change" kbd={`${mod}Z`} side="bottom">
          <Button size="sm" variant="ghost" icon={Undo2} disabled={!canUndo} onClick={undoAny}>
            Undo
          </Button>
        </Tooltip>
        <Tooltip content="Redo the change you undid" kbd={mac ? '⇧⌘Z' : 'Ctrl+Y'} side="bottom">
          <Button size="sm" variant="ghost" icon={Redo2} disabled={!canRedo} onClick={redoAny}>
            Redo
          </Button>
        </Tooltip>
        {!pdfRowVisible && (
          <Button
            size="sm"
            variant="ghost"
            icon={Download}
            data-testid="pdf-save-copy"
            disabled={!doc || exportBusy}
            onClick={() => {
              void savePdfCopy();
            }}
          >
            Save a PDF copy…
          </Button>
        )}
        <Button
          size="sm"
          disabled={pdfPending !== null}
          onClick={() => {
            // Words still being typed count as a change: keep them first, so closing asks.
            finishTextEditing();
            requestClose();
          }}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          kbd={`${mod}S`}
          disabled={
            saving ||
            loading ||
            !doc ||
            pickingBusy ||
            pdfDrawing ||
            pdfPending !== null ||
            sourceConversion !== null
          }
          data-testid="save-slides"
          onClick={() => {
            saveWhenReady();
          }}
        >
          {dirty ? 'Save' : 'Done'}
        </Button>
      </header>
      {pdfPending === 'save-copy' && !pdfRowVisible && (
        <p
          className="border-b border-line px-3 py-1 text-xs text-muted"
          role="status"
          data-testid="pdf-pages-pending"
        >
          Writing the PDF copy…
        </p>
      )}
      {pickingBusy && picking === null && (
        <p className="border-b border-line px-3 py-1 text-xs text-muted" role="status">
          Adding the picture…
        </p>
      )}
      <TabPanel
        group="editor"
        id={shownGroup}
        className="flex shrink-0 items-center overflow-x-auto border-b border-line bg-panel-2 px-3 py-1"
      >
        <div data-testid="editor-ribbon" data-group={shownGroup} className="flex min-w-0 items-start">
          {shownGroup === 'words' && (
            <WordsGroup
              findKbd={`${mod}F`}
              onFind={() => {
                useEditor.setState({ finding: true });
              }}
            />
          )}
          {shownGroup === 'insert' && (
            <InsertGroup
              onPicture={() => {
                setPicking('picture');
              }}
              onPictureFile={() => pictureFromComputer(null)}
              pictureBusy={pickingBusy}
              onSound={() => setPicking('sound')}
            />
          )}
          {shownGroup === 'arrange' && <ArrangeGroup />}
          {shownGroup === 'design' && <DesignGroup key={slideId} />}
          {shownGroup === 'motion' && <MotionGroup key={slideId} />}
          {shownGroup === 'slides' && <SlidesGroup />}
          {pdfRowVisible && (
            <PdfTools
              available={{
                highlight: true,
                underline: true,
                strike: true,
                draw: true,
                cover: true,
                rotateRight:
                  !!shownPage?.pageSize ||
                  (shownPage?.documentPage?.width !== undefined &&
                    shownPage.documentPage.height !== undefined &&
                    !shownPage.documentPage.rotation),
                deletePage: !!doc && slidesOf(doc).length > 1,
                insertPages: !!doc,
                saveCopy: !!doc,
              }}
              activeTool={pdfTool}
              underlined={underlined}
              struckThrough={struckThrough}
              pending={pdfPending}
              blocked={loading || saving || pickingBusy || pdfDrawing || sourceConversion !== null}
              onHighlight={() => choosePdfTool('highlight')}
              onUnderline={() => applyPdfMark('underline')}
              onStrikeThrough={() => applyPdfMark('strike')}
              onDraw={() => choosePdfTool('draw')}
              onCover={() => choosePdfTool('cover')}
              onRotateRight={rotatePdfPage}
              onDeletePage={deleteCurrentPdfPage}
              onInsertPages={openInsertion}
              onSaveCopy={() => {
                void savePdfCopy();
              }}
            />
          )}
        </div>
      </TabPanel>
      {doc?.master?.id === slideId && (
        <div
          className="flex shrink-0 items-center justify-between gap-3 border-b border-second/30 bg-second/10 px-3 py-1"
          data-testid="editor-master-banner"
        >
          <p className="text-sm text-fg">
            Editing the master — shared behind this presentation’s own slides.
          </p>
          <Button
            size="sm"
            data-testid="master-done"
            onClick={() => {
              finishTextEditing();
              const s = useEditor.getState();
              const target =
                s.masterReturnId && s.doc && findSlide(s.doc, s.masterReturnId)
                  ? s.masterReturnId
                  : s.doc?.groups.flatMap((g) => g.slides)[0]?.id;
              if (target) showSlide(target);
            }}
          >
            Done editing master
          </Button>
        </div>
      )}
      {problem && (
        <Notice tone="danger" className="m-2">
          {problem}
        </Notice>
      )}
      {note && (
        <Notice
          tone="info"
          className="m-2"
          data-testid="editor-note"
          onDismiss={() => {
            tell(null);
          }}
        >
          {note}
        </Notice>
      )}
      {unreadable > 0 && (
        <Notice tone="warning" className="m-2">
          {unreadable === 1 ? 'One element' : `${unreadable} elements`} on these slides could not be read. It
          is kept as it is, but not shown here.
        </Notice>
      )}
      <SourceIssues
        issues={sourceIssues}
        blocked={exportBusy}
        onLink={
          shownPage &&
          (!shownPage.documentPage ||
            shownPage.documentPage.ext === 'ppt' ||
            shownPage.documentPage.ext === 'key') &&
          shownPage.elements.some((element) => element.kind === 'image')
            ? openSourceLink
            : undefined
        }
      />
      {loading || !doc ? (
        <Loading label="Opening the slides…" className="flex-1" />
      ) : (
        <main className="flex min-h-0 flex-1 flex-col" aria-label="The slides">
          <div className="flex min-h-0 flex-1">
            {!strip && <SlideList doc={doc} current={slideId} />}
            <div className="relative flex min-w-0 flex-1">
              <Canvas
                platform={platform}
                onPictureDrop={(file, at) => {
                  const path = window.drashti.files.pathFor(file);
                  if (path) pictureFromComputer(path, at);
                  else tell('Drop a picture file from this computer.');
                }}
              />
              {preparingSource && (
                <div
                  role="status"
                  className="pointer-events-none absolute left-3 top-3 z-10 rounded bg-panel px-2 py-1 text-sm text-muted shadow"
                >
                  <span>Preparing…</span>{' '}
                  <span>
                    Reading continues when nothing is on the screens and streaming and recording are off.
                  </span>
                </div>
              )}
              {finding && (
                <FindPanel
                  onClose={() => {
                    useEditor.setState({ finding: false });
                  }}
                />
              )}
            </div>
            <Inspector />
          </div>
          {strip && <SlideList doc={doc} current={slideId} horizontal />}
        </main>
      )}
      {picking && (
        <MediaPicker
          title={picking === 'sound' ? 'Give this slide a sound' : 'Put a picture or video on the slide'}
          sounds={picking === 'sound'}
          busy={pickingBusy}
          onClose={cancelPicking}
          onChoose={(m) => {
            if (picking === 'sound') {
              const s = useEditor.getState();
              const at = s.doc ? findSlide(s.doc, s.slideId) : undefined;
              if (s.doc && at)
                commit(changeSlide(s.doc, at.id, setSoundCue(at, { id: m.id, volume: 1, loop: false })));
              cancelPicking();
              return;
            }
            if (m.kind === 'audio') return;
            const media = { id: m.id, kind: m.kind };
            placeMedia(() => Promise.resolve(media));
          }}
        />
      )}
      {linking && (
        <SourceLinkDialog
          doc={linking.doc}
          slideId={linking.slideId}
          stamp={linking.stamp}
          onClose={closeInsertion}
          onLinked={(page, issues) => {
            const base = insertBase.current;
            const now = useEditor.getState();
            if (base?.doc !== now.doc || now.stamp !== base.stamp) {
              tell('The slides changed while the reading copy was prepared. Choose Link source page again.');
              return;
            }
            commit(changeSlide(base.doc, page.id, page), { select: [] });
            useEditor.setState({ sourceIssues: [...new Set([...now.sourceIssues, ...issues])] });
          }}
        />
      )}
      {inserting && (
        <PdfInsertDialog
          presentationId={inserting.doc.presentationId}
          stamp={inserting.stamp}
          onClose={closeInsertion}
          onInserted={(pages, issues) => {
            const base = insertBase.current;
            const now = useEditor.getState();
            if (base?.doc !== now.doc || now.stamp !== base.stamp) {
              tell('The slides changed while the pages were prepared. Choose Insert pages again.');
              return;
            }
            let next = base.doc,
              after = base.slideId;
            for (const page of pages) {
              next = addSlideAfter(next, after, page);
              after = page.id;
            }
            commit(next, { select: [] });
            const first = pages[0];
            if (first) showSlide(first.id);
            useEditor.setState({ sourceIssues: [...new Set([...now.sourceIssues, ...issues])] });
          }}
        />
      )}
      {askDiscard && (
        <KeepChangesDialog
          name={<>the slides of “{name}”</>}
          lost={`You made ${plural(Math.max(1, steps), 'change')}.`}
          live={live ? savesLive(name) : undefined}
          note={live ? undefined : SAVES_LIBRARY}
          saving={saving}
          onKeepEditing={keepEditing}
          onSave={() => {
            useEditor.setState({ askDiscard: false });
            saveWhenReady();
          }}
          onThrowAway={closeSlideEditor}
        />
      )}
      {sourceConversion && (
        <Dialog
          title={
            sourceConversion.slideIds.length === 1
              ? SOURCE_CONVERSION_WARNING.title
              : 'Edit these animated slides'
          }
          onClose={cancelSourceConversion}
          closeButton={false}
          size="sm"
          describedBy={sourceWarningId}
          testId="source-conversion"
          footer={
            <>
              <Button data-autofocus onClick={cancelSourceConversion}>
                {SOURCE_CONVERSION_WARNING.cancel}
              </Button>
              <Button variant="primary" onClick={acceptSourceConversion}>
                {sourceConversion.slideIds.length === 1
                  ? SOURCE_CONVERSION_WARNING.accept
                  : 'Make these slides editable'}
              </Button>
            </>
          }
        >
          <div id={sourceWarningId} className="space-y-2 text-sm text-muted">
            <p>
              {sourceConversion.slideIds.length === 1
                ? 'Only this slide becomes Drashti’s own.'
                : `These ${sourceConversion.slideIds.length} slides become Drashti’s own.`}{' '}
            </p>
            {warningDecks.some((deck) => deck && !deck.motion) && (
              <p>Their original animations and clicks are replaced by editable content.</p>
            )}
            {warningDecks.some((deck) => deck?.motion?.approximate) && <p>{DECK_MOTION_APPROXIMATION}</p>}
            <p>The original file is never changed. Other slides keep their original playback.</p>
          </div>
        </Dialog>
      )}
      {conflict && (
        <ConfirmDialog
          title="Save over the other change?"
          confirmLabel="Save mine"
          confirmVariant="primary"
          cancelLabel="Keep editing"
          testId="conflict-confirm"
          onCancel={() => {
            useEditor.setState({ conflict: null });
          }}
          onConfirm={() => {
            saveWhenReady(true);
          }}
        >
          <p>{conflict}</p>
          <p>Saving yours replaces that change. Undo brings it back afterwards.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/** Zoom in or out a step from where it is (the slide's fit as the canvas last measured it). */
function zoomBy(way: 'in' | 'out'): void {
  const s = useEditor.getState();
  const canvas = document.querySelector<HTMLElement>('[data-testid="editor-canvas"]');
  const fit = Number(canvas?.dataset['fit'] ?? '0.5') || 0.5;
  useEditor.setState({ zoom: way === 'in' ? zoomIn(s.zoom, fit) : zoomOut(s.zoom, fit) });
}

/** The slides, group by group: the one being edited is marked; click another to edit it, drag to move it. */
function SlideList({
  doc,
  current,
  horizontal = false,
}: {
  doc: EditDoc;
  current: string | null;
  horizontal?: boolean;
}) {
  const numbers = new Map(slidesOf(doc).map((s, i) => [s.id, i + 1]));
  const preparing = useEditor((s) => s.preparingSource);
  const [dragging, setDragging] = useState<string | null>(null);
  // Slides with words past a box (Sessions 31–36, SLD-1), marked on their thumbnails.
  const [overset, setOverset] = useState<ReadonlySet<string>>(new Set());
  const [dropAt, setDropAt] = useState<{ groupId: string; index: number } | null>(null);
  const drop = () => {
    const s = useEditor.getState();
    const moving = dragging && s.doc ? findSlide(s.doc, dragging) : undefined;
    if (moving && dropAt && s.doc) {
      const from = placeOf(s.doc, moving.id);
      const group = s.doc.groups.find((g) => g.id === dropAt.groupId);
      // Later in the same group: the slide itself no longer counts before the place.
      const index =
        from && group && s.doc.groups[from.group]?.id === group.id && from.index < dropAt.index
          ? dropAt.index - 1
          : dropAt.index;
      commit(placeSlide(s.doc, moving, dropAt.groupId, index));
    }
    setDragging(null);
    setDropAt(null);
  };
  return (
    <nav
      aria-label="Slides"
      className={
        horizontal
          ? 'h-40 w-full shrink-0 border-t border-line bg-panel'
          : 'flex w-44 shrink-0 flex-col border-r border-line bg-panel xl:w-52'
      }
      data-testid="editor-slides"
      data-direction={horizontal ? 'across' : 'down'}
    >
      <div
        className={
          horizontal ? 'flex h-full gap-4 overflow-x-auto p-2' : 'min-h-0 flex-1 overflow-y-auto p-2'
        }
      >
        {doc.groups.map((g) => (
          <section
            key={g.id}
            className={horizontal ? 'shrink-0' : 'mb-3'}
            aria-label={g.name || 'Slides without a group name'}
            data-testid="editor-group"
            data-group={g.name}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              // Over the group but no slide: at its end.
              if (e.target === e.currentTarget) setDropAt({ groupId: g.id, index: g.slides.length });
            }}
            onDrop={(e) => {
              e.preventDefault();
              drop();
            }}
          >
            <h3 className="mb-1 flex items-center gap-2 text-xs font-bold text-fg">
              <span
                aria-hidden="true"
                className="h-3 w-3 shrink-0 rounded-sm border border-line-strong"
                style={{ background: g.color ?? 'transparent' }}
              />
              <Truncate text={g.name || 'No name'} />
            </h3>
            <ol className={horizontal ? 'flex gap-2' : 'space-y-2'}>
              {g.slides.map((s, index) => {
                const n = numbers.get(s.id) ?? 0;
                const label = `Slide ${n}${s.label ? `: ${s.label}` : ''}${s.enabled ? '' : ' (hidden in the show)'}${overset.has(s.id) ? ', words run past a box' : ''}${preparing.has(s.id) ? ', preparing when the screens are clear and streaming and recording are off' : ''}`;
                const here = s.id === current;
                const marker = dropAt?.groupId === g.id && dropAt.index === index;
                return (
                  <li
                    key={s.id}
                    className={cx(
                      'rounded-md',
                      horizontal && 'w-36 shrink-0',
                      marker &&
                        (horizontal
                          ? 'shadow-[-3px_0_0_0_var(--color-accent)]'
                          : 'shadow-[0_-3px_0_0_var(--color-accent)]'),
                    )}
                    onDragOver={(e) => {
                      if (!dragging) return;
                      e.preventDefault();
                      const r = e.currentTarget.getBoundingClientRect();
                      setDropAt({
                        groupId: g.id,
                        index: (
                          horizontal ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2
                        )
                          ? index + 1
                          : index,
                      });
                    }}
                  >
                    <button
                      type="button"
                      draggable
                      data-testid="editor-slide-thumb"
                      data-slide-id={s.id}
                      data-source-preparing={preparing.has(s.id) || undefined}
                      aria-current={here ? 'true' : undefined}
                      aria-label={label}
                      title={label}
                      onDragStart={(e) => {
                        finishTextEditing();
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', s.id);
                        setDragging(s.id);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setDropAt(null);
                      }}
                      onClick={() => {
                        finishTextEditing();
                        showSlide(s.id);
                      }}
                      className={cx(
                        'w-full overflow-hidden rounded-md border-2 bg-black text-left',
                        here ? 'border-accent' : 'border-line hover:border-field',
                        !s.enabled && 'opacity-50',
                        dragging === s.id && 'opacity-40',
                      )}
                    >
                      <span
                        className="pointer-events-none relative block aspect-video w-full"
                        data-a11y-picture
                      >
                        <PlacedInParent
                          fractional
                          content={slideCanvas(s, doc)}
                          mode="fit"
                          className="absolute inset-0"
                        >
                          <OversetWatch
                            onChange={(over) => {
                              setOverset((was) => {
                                if (was.has(s.id) === over) return was;
                                const next = new Set(was);
                                if (over) next.add(s.id);
                                else next.delete(s.id);
                                return next;
                              });
                            }}
                          >
                            <SlideView slide={renderSlide(doc, s)} media="still" />
                          </OversetWatch>
                        </PlacedInParent>
                        {overset.has(s.id) && <OversetMark />}
                      </span>
                      <span className="flex h-6 items-center gap-1 bg-panel-2 px-1.5 text-2xs text-muted">
                        <span className="font-bold tabular-nums">{n}</span>
                        {s.label && <Truncate text={s.label} className="min-w-0 flex-1" />}
                        {s.autoAdvanceMs !== null && (
                          <span className="ml-auto">{s.autoAdvanceMs / 1000} s</span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            {dropAt?.groupId === g.id && dropAt.index === g.slides.length && (
              <div aria-hidden="true" className="mt-1 h-0.5 rounded bg-accent" />
            )}
          </section>
        ))}
      </div>
    </nav>
  );
}
