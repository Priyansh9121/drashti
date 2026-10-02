import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RenderSlide } from '../../../shared/model';
import type { EditDoc, EditSlide } from '../../../shared/slide-edit';
import { slidesOf } from '../../../shared/slide-edit';
import { isTyping } from '../operator/useKeymap';
import { loadMedia } from '../library/library-store';
import { PlacedInParent } from '../render/Placed';
import { SlideView } from '../render/SlideView';
import { Button, IconButton } from '../ui/Button';
import { cx } from '../ui/cx';
import { ConfirmDialog, useFocusTrap } from '../ui/Dialog';
import {
  Circle,
  ImagePlus,
  Minus,
  RectangleHorizontal,
  Redo2,
  Shapes,
  Square,
  Type,
  Undo2,
} from '../ui/icons';
import type { MenuPlace } from '../ui/Menu';
import { Menu } from '../ui/Menu';
import { Notice } from '../ui/Notice';
import { Loading } from '../ui/States';
import { Truncate } from '../ui/Truncate';
import { Canvas } from './Canvas';
import {
  closeSlideEditor,
  commit,
  isDirty,
  noteMade,
  redo,
  requestClose,
  saveSlides,
  select,
  showSlide,
  startEditing,
  tell,
  undo,
  useEditor,
} from './editor-store';
import { Inspector } from './Inspector';
import { MediaPicker, naturalSize } from './MediaPicker';
import type { ShapeChoice } from './ops';
import { addElement, findSlide, newMedia, newShape, newTextBox } from './ops';
import { finishTextEditing } from './TextBoxEditor';

/*
 * The slide editor (PLAN.md 5.2, Session 7): it covers the operator window,
 * as Edit words does. The slides on the left, the slide being edited in the
 * middle, what is selected on the right. Saving is one change for the
 * operator's Undo; Cancel (or Esc) asks first when there are changes.
 */

export function SlideEditor({ platform }: { platform: string }) {
  const open = useEditor((s) => s.open);
  if (!open) return null;
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
  const conflict = useEditor((s) => s.conflict);
  const canUndo = useEditor((s) => s.past.length > 0 && !s.editing);
  const canRedo = useEditor((s) => s.future.length > 0 && !s.editing);
  const dirty = useEditor(isDirty);
  const unreadable = useEditor((s) => s.unreadable);
  const note = useEditor((s) => s.note);
  const [shapeMenu, setShapeMenu] = useState<MenuPlace | null>(null);
  const [picking, setPicking] = useState(false);
  const mod = platform === 'darwin' ? '⌘' : 'Ctrl+';

  // Esc steps back: stop typing, then let go of the selection, then close (asking first).
  useFocusTrap(root, () => {
    const s = useEditor.getState();
    if (s.askDiscard || s.conflict) return;
    if (s.editing) finishTextEditing();
    else if (s.selection.length > 0) select([]);
    else requestClose();
  });

  // The library's pictures and videos (names, and the slide's background picture).
  useEffect(() => {
    void loadMedia();
  }, []);

  // Undo, Redo and Save from the keyboard; typing in a field or a text box keeps its own keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const m = platform === 'darwin' ? e.metaKey : e.ctrlKey;
      if (!m || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 's' || e.key === 'Enter') {
        e.preventDefault();
        finishTextEditing();
        void saveSlides();
        return;
      }
      if (isTyping(e.target)) return;
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [platform]);

  const slide = doc ? findSlide(doc, slideId) : undefined;
  const add = (fn: () => void) => {
    finishTextEditing();
    fn();
  };
  const addText = () => {
    add(() => {
      const s = useEditor.getState();
      if (!s.doc || !s.look || !slide) return;
      const box = newTextBox(s.look);
      noteMade(box.id);
      commit(addElement(s.doc, slide.id, box), { select: [box.id] });
      startEditing(box.id);
    });
  };
  const addShape = (choice: ShapeChoice) => {
    add(() => {
      const s = useEditor.getState();
      if (!s.doc || !s.look || !slide) return;
      const shape = newShape(choice, s.look, s.doc);
      commit(addElement(s.doc, slide.id, shape), { select: [shape.id] });
    });
  };

  return createPortal(
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid="slide-editor"
      className="fixed inset-0 z-40 flex flex-col bg-ink text-fg focus:outline-none"
    >
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <h2 id={titleId} className="min-w-40 flex-[1_1_12rem] text-base font-bold">
          <Truncate text={`Slides of “${name}”`} />
        </h2>
        <IconButton icon={Undo2} label="Undo" kbd={`${mod}Z`} disabled={!canUndo} onClick={undo} />
        <IconButton
          icon={Redo2}
          label="Redo"
          kbd={platform === 'darwin' ? '⇧⌘Z' : 'Ctrl+Y'}
          disabled={!canRedo}
          onClick={redo}
        />
        <span className="mx-1 h-6 w-px bg-line" aria-hidden="true" />
        <Button size="sm" icon={Type} onClick={addText} disabled={!slide} data-testid="add-text">
          Words
        </Button>
        <Button
          size="sm"
          icon={Shapes}
          disabled={!slide}
          data-testid="add-shape"
          aria-haspopup="menu"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setShapeMenu({ x: r.left, y: r.bottom + 4 });
          }}
        >
          Shape
        </Button>
        <Button
          size="sm"
          icon={ImagePlus}
          disabled={!slide}
          data-testid="add-media"
          onClick={() => {
            finishTextEditing();
            setPicking(true);
          }}
        >
          Picture or video
        </Button>
        <span className="mx-1 h-6 w-px bg-line" aria-hidden="true" />
        <Button onClick={requestClose}>Cancel</Button>
        <Button
          variant="primary"
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
        <div className="flex min-h-0 flex-1">
          <SlideList doc={doc} current={slideId} />
          <Canvas platform={platform} />
          <Inspector />
        </div>
      )}
      {shapeMenu && (
        <Menu
          at={shapeMenu}
          label="Add a shape"
          onClose={() => {
            setShapeMenu(null);
          }}
          entries={(
            [
              ['rectangle', 'Rectangle', Square],
              ['rounded', 'Rounded rectangle', RectangleHorizontal],
              ['ellipse', 'Ellipse', Circle],
              ['line', 'Line', Minus],
            ] as const
          ).map(([choice, label, icon]) => ({
            label,
            icon,
            onSelect: () => {
              addShape(choice);
            },
          }))}
        />
      )}
      {picking && (
        <MediaPicker
          title="Put a picture or video on the slide"
          onClose={() => {
            setPicking(false);
          }}
          onChoose={(m) => {
            setPicking(false);
            void naturalSize(m).then((size) => {
              const s = useEditor.getState();
              const current = s.doc ? findSlide(s.doc, s.slideId) : undefined;
              if (!s.doc || !current) return;
              const el = newMedia({ id: m.id, kind: m.kind, ...(size ?? {}) }, s.doc);
              commit(addElement(s.doc, current.id, el), { select: [el.id] });
            });
          }}
        />
      )}
      {askDiscard && (
        <ConfirmDialog
          title="Throw away the changes?"
          confirmLabel="Throw them away"
          cancelLabel="Keep editing"
          testId="discard-confirm"
          onCancel={() => {
            useEditor.setState({ askDiscard: false });
          }}
          onConfirm={closeSlideEditor}
        >
          <p>The changes to these slides have not been saved. Nothing on the screens has changed.</p>
        </ConfirmDialog>
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
    </div>,
    document.body,
  );
}

/** The slides, group by group: the one being edited is marked; click another to edit it. */
function SlideList({ doc, current }: { doc: EditDoc; current: string | null }) {
  const numbers = new Map(slidesOf(doc).map((s, i) => [s.id, i + 1]));
  return (
    <nav
      aria-label="Slides"
      className="w-52 shrink-0 overflow-y-auto border-r border-line bg-panel p-2"
      data-testid="editor-slides"
    >
      {doc.groups.map((g) => (
        <section key={g.id} className="mb-3" aria-label={g.name || 'Slides without a group'}>
          <h3 className="mb-1 flex items-center gap-2 text-xs font-bold text-fg">
            <span
              aria-hidden="true"
              className="h-3 w-3 shrink-0 rounded-sm border border-line-strong"
              style={{ background: g.color ?? 'transparent' }}
            />
            <Truncate text={g.name || 'No group'} />
          </h3>
          <ol className="space-y-2">
            {g.slides.map((s) => {
              const n = numbers.get(s.id) ?? 0;
              const here = s.id === current;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    data-testid="editor-slide-thumb"
                    data-slide-id={s.id}
                    aria-current={here ? 'true' : undefined}
                    aria-label={`Slide ${n}${s.label ? `: ${s.label}` : ''}${s.enabled ? '' : ' (hidden in the show)'}`}
                    onClick={() => {
                      finishTextEditing();
                      showSlide(s.id);
                    }}
                    className={cx(
                      'w-full overflow-hidden rounded-md border-2 bg-black text-left',
                      here ? 'border-accent' : 'border-line hover:border-field',
                      !s.enabled && 'opacity-50',
                    )}
                  >
                    <span
                      className="pointer-events-none relative block aspect-video w-full"
                      data-a11y-picture
                    >
                      <PlacedInParent content={doc} mode="fit" className="absolute inset-0">
                        <SlideView slide={renderSlide(doc, s)} media="still" />
                      </PlacedInParent>
                    </span>
                    <span className="flex h-6 items-center gap-1 bg-panel-2 px-1.5 text-2xs text-muted">
                      <span className="font-bold tabular-nums">{n}</span>
                      {s.label && <Truncate text={s.label} className="min-w-0 flex-1" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </nav>
  );
}
