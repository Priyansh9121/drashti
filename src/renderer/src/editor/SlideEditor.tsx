import { useEffect, useId, useRef, useState } from 'react';
import type { RenderSlide } from '../../../shared/model';
import type { EditDoc, EditSlide } from '../../../shared/slide-edit';
import { slidesOf } from '../../../shared/slide-edit';
import { SHOW_F_KEYS } from '../../../shared/keymap';
import { isTyping } from '../operator/useKeymap';
import { loadMedia } from '../library/library-store';
import { PlacedInParent } from '../render/Placed';
import { SlideView } from '../render/SlideView';
import { OversetMark, OversetWatch } from '../render/measure';
import { Button, IconButton } from '../ui/Button';
import { cx } from '../ui/cx';
import { ConfirmDialog, useFocusTrap } from '../ui/Dialog';
import { KeepChangesDialog, SAVES_LIBRARY, savesLive } from '../ui/KeepChanges';
import { plural } from '../ui/text';
import { useEngine } from '../engine/engine-store';
import type { TabItem } from '../ui/Tabs';
import { TabPanel, Tabs } from '../ui/Tabs';
import { ArrowLeftRight, LayoutTemplate, ListPlus, Palette, Redo2, Sparkles, Type, Undo2 } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { Loading } from '../ui/States';
import { Truncate } from '../ui/Truncate';
import { Canvas } from './Canvas';
import type { EditorGroup } from './editor-store';
import {
  closeSlideEditor,
  commit,
  isDirty,
  keepEditing,
  requestClose,
  saveSlides,
  select,
  showSlide,
  tell,
  useEditor,
} from './editor-store';
import { FindPanel } from './FindPanel';
import { Inspector } from './Inspector';
import { MediaPicker, naturalSize } from './MediaPicker';
import { addElement, changeSlide, findSlide, newMedia, placeOf, placeSlide, setSoundCue } from './ops';
import { ArrangeGroup, DesignGroup, InsertGroup, MotionGroup, SlidesGroup } from './Ribbon';
import { finishTextEditing, redoAny, undoAny } from './TextBoxEditor';
import { WordsGroup } from './WordsGroup';
import { zoomIn, zoomOut } from './zoom';

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
  return <Editor platform={platform} name={open.name} />;
}

/** As the renderer sees a slide being edited. */
const renderSlide = (doc: EditDoc, s: EditSlide): RenderSlide => ({
  id: s.id,
  width: doc.width,
  height: doc.height,
  background: s.background,
  elements: s.elements,
});

function Editor({ platform, name }: { platform: string; name: string }) {
  const root = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const loading = useEditor((s) => s.loading);
  const doc = useEditor((s) => s.doc);
  const slideId = useEditor((s) => s.slideId);
  const problem = useEditor((s) => s.problem);
  const saving = useEditor((s) => s.saving);
  const askDiscard = useEditor((s) => s.askDiscard);
  const steps = useEditor((s) => s.past.length);
  const group = useEditor((s) => s.group);
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
  const note = useEditor((s) => s.note);
  const [picking, setPicking] = useState<'picture' | 'sound' | null>(null);
  const mac = platform === 'darwin';
  const mod = mac ? '⌘' : 'Ctrl+';

  // Esc steps back: close find, stop typing, then let go of the selection, then close (asking first).
  useFocusTrap(root, () => {
    const s = useEditor.getState();
    if (s.askDiscard || s.conflict) return;
    if (s.finding) useEditor.setState({ finding: false });
    else if (s.editing) finishTextEditing();
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
      // The show's F-keys (Clear all, Oops, the Wallpaper...): the operator window acts on them (Session 55, 17a).
      if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.repeat && SHOW_F_KEYS.includes(e.key)) {
        e.preventDefault();
        void window.drashti.slideEditor.showKey(e.key);
        return;
      }
      const m = mac ? e.metaKey : e.ctrlKey;
      if (!m || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 's' || e.key === 'Enter') {
        e.preventDefault();
        finishTextEditing();
        void saveSlides();
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
  }, [mac]);

  return (
    <div
      ref={root}
      tabIndex={-1}
      aria-labelledby={titleId}
      data-testid="slide-editor"
      className="flex h-screen flex-col bg-ink text-fg focus:outline-none"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-3 py-1.5">
        <h1 id={titleId} className="min-w-24 flex-[1_1_8rem] text-sm font-bold">
          <Truncate text={`Slides of “${name}”`} />
        </h1>
        <Tabs
          group="editor"
          label="The editor’s groups"
          items={GROUPS}
          value={group}
          size="sm"
          onChange={(next) => {
            useEditor.setState({ group: next });
          }}
        />
        <span className="mx-1 h-6 w-px shrink-0 bg-line" aria-hidden="true" />
        <IconButton icon={Undo2} label="Undo" kbd={`${mod}Z`} disabled={!canUndo} onClick={undoAny} />
        <IconButton
          icon={Redo2}
          label="Redo"
          kbd={mac ? '⇧⌘Z' : 'Ctrl+Y'}
          disabled={!canRedo}
          onClick={redoAny}
        />
        <span className="mx-1 h-6 w-px shrink-0 bg-line" aria-hidden="true" />
        <Button
          size="sm"
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
          disabled={saving || loading || !doc}
          data-testid="save-slides"
          onClick={() => {
            finishTextEditing();
            void saveSlides();
          }}
        >
          {dirty ? 'Save' : 'Done'}
        </Button>
      </header>
      <TabPanel
        group="editor"
        id={group}
        className="flex shrink-0 items-center overflow-x-auto border-b border-line bg-panel-2 px-3 py-1"
      >
        <div data-testid="editor-ribbon" data-group={group} className="flex min-w-0 items-start">
          {group === 'words' && (
            <WordsGroup
              findKbd={`${mod}F`}
              onFind={() => {
                useEditor.setState({ finding: true });
              }}
            />
          )}
          {group === 'insert' && (
            <InsertGroup
              onPicture={() => {
                setPicking('picture');
              }}
              onSound={() => setPicking('sound')}
            />
          )}
          {group === 'arrange' && <ArrangeGroup />}
          {group === 'design' && <DesignGroup />}
          {group === 'motion' && <MotionGroup />}
          {group === 'slides' && <SlidesGroup />}
        </div>
      </TabPanel>
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
      {loading || !doc ? (
        <Loading label="Opening the slides…" className="flex-1" />
      ) : (
        <main className="flex min-h-0 flex-1" aria-label="The slides">
          <SlideList doc={doc} current={slideId} />
          <div className="relative flex min-w-0 flex-1">
            <Canvas platform={platform} />
            {finding && (
              <FindPanel
                onClose={() => {
                  useEditor.setState({ finding: false });
                }}
              />
            )}
          </div>
          <Inspector />
        </main>
      )}
      {picking && (
        <MediaPicker
          title={picking === 'sound' ? 'Give this slide a sound' : 'Put a picture or video on the slide'}
          sounds={picking === 'sound'}
          onClose={() => {
            setPicking(null);
          }}
          onChoose={(m) => {
            setPicking(null);
            if (picking === 'sound') {
              const s = useEditor.getState();
              const at = s.doc ? findSlide(s.doc, s.slideId) : undefined;
              if (s.doc && at)
                commit(changeSlide(s.doc, at.id, setSoundCue(at, { id: m.id, volume: 1, loop: false })));
              return;
            }
            if (m.kind === 'audio') return;
            const kind = m.kind;
            void naturalSize({ id: m.id, kind }).then((size) => {
              const s = useEditor.getState();
              const current = s.doc ? findSlide(s.doc, s.slideId) : undefined;
              if (!s.doc || !current) return;
              const el = newMedia({ id: m.id, kind, ...(size ?? {}) }, s.doc);
              commit(addElement(s.doc, current.id, el), { select: [el.id] });
            });
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
            finishTextEditing();
            void saveSlides();
          }}
          onThrowAway={closeSlideEditor}
        />
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
            void saveSlides(true);
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
function SlideList({ doc, current }: { doc: EditDoc; current: string | null }) {
  const numbers = new Map(slidesOf(doc).map((s, i) => [s.id, i + 1]));
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
      className="flex w-44 shrink-0 flex-col border-r border-line bg-panel xl:w-52"
      data-testid="editor-slides"
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {doc.groups.map((g) => (
          <section
            key={g.id}
            className="mb-3"
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
            <ol className="space-y-2">
              {g.slides.map((s, index) => {
                const n = numbers.get(s.id) ?? 0;
                const here = s.id === current;
                const marker = dropAt?.groupId === g.id && dropAt.index === index;
                return (
                  <li
                    key={s.id}
                    className={cx('rounded-md', marker && 'shadow-[0_-3px_0_0_var(--color-accent)]')}
                    onDragOver={(e) => {
                      if (!dragging) return;
                      e.preventDefault();
                      const r = e.currentTarget.getBoundingClientRect();
                      setDropAt({
                        groupId: g.id,
                        index: e.clientY > r.top + r.height / 2 ? index + 1 : index,
                      });
                    }}
                  >
                    <button
                      type="button"
                      draggable
                      data-testid="editor-slide-thumb"
                      data-slide-id={s.id}
                      aria-current={here ? 'true' : undefined}
                      aria-label={`Slide ${n}${s.label ? `: ${s.label}` : ''}${s.enabled ? '' : ' (hidden in the show)'}${overset.has(s.id) ? ', words run past a box' : ''}`}
                      onDragStart={(e) => {
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
                        <PlacedInParent content={doc} mode="fit" className="absolute inset-0">
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
