import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  DARKEN_STRENGTHS,
  TRANSITION_KINDS,
  TRANSITION_NAMES,
  type TransitionKind,
} from '../../../shared/model';
import { slidesOf } from '../../../shared/slide-edit';
import { TIMER_KIND_NAMES } from '../../../shared/timers';
import { useEngine } from '../engine/engine-store';
import { Button, IconButton } from '../ui/Button';
import { NumberInput, Select } from '../ui/Field';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDown,
  ArrowUp,
  BringToFront,
  Circle,
  CopyPlus,
  EyeOff,
  ImagePlus,
  ListPlus,
  Minus,
  Plus,
  RectangleHorizontal,
  SendToBack,
  Shapes,
  Square,
  Timer,
  Trash2,
  Type,
} from '../ui/icons';
import type { Icon } from '../ui/icons';
import type { MenuPlace } from '../ui/Menu';
import { Menu } from '../ui/Menu';
import { commit, noteMade, showSlide, startEditing, useEditor } from './editor-store';
import type { Alignment } from './geometry';
import { alignMoves, boundsOf, distributeMoves } from './geometry';
import type { Arrange, ShapeChoice } from './ops';
import {
  addElement,
  addGroup,
  addSlideAfter,
  arrange,
  changeSlide,
  copySlide,
  findSlide,
  moveEach,
  moveSlideBy,
  newShape,
  newSlide,
  newTextBox,
  newTimerElement,
  removeSlide,
} from './ops';
import { NewTimerSlideDialog } from './NewTimerSlide';
import { finishTextEditing } from './TextBoxEditor';
import { Cluster, Divider } from './RibbonParts';

/*
 * The slide editor's groups along its top besides Words (Session 55, Part 17a, run 1), each a row of tools in clusters,
 * named under them. Today's tools moved into them: Insert (a text box, a shape, a picture or video, a timer, from the
 * top of the old editor), Arrange (lining up, spacing out, front and back, from the old inspector), Design (the slide's
 * colour and darkening behind its words, quick; all of a slide's settings stay in the side panel), Motion (how the slide
 * comes on and whether it moves on by itself, quick, as in the side panel) and Slides (new, a timer slide, a group,
 * duplicate, up and down, delete and hide, from the old slide list's top). Runs 2 and 3 of Part 17a grow each group:
 * Insert (lines and arrows, pictures cropped, video, sound, tables, icons), Arrange (group, rotate, flip, snapping and
 * guides, rulers and grid), Design (gradients and pictures, slide size, layouts, a master), Motion (each element's
 * animations and their timing), Slides (the strip to drag about, notes).
 */

/** A tool with its words (the Insert group's: what it adds). */
function Tool({
  icon,
  children,
  onClick,
  disabled,
  testId,
  menu = false,
}: {
  icon: Icon;
  children: ReactNode;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  testId: string;
  menu?: boolean;
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={icon}
      disabled={disabled}
      data-testid={testId}
      aria-haspopup={menu ? 'menu' : undefined}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/** The slide shown, in the document as it is now. */
const shownSlide = () => {
  const s = useEditor.getState();
  return s.doc ? findSlide(s.doc, s.slideId) : undefined;
};

/** Insert: what goes on the slide. A text box goes straight into typing, the Words group chosen. */
export function InsertGroup({ onPicture }: { onPicture: () => void }) {
  const slide = useEditor((s) => (s.doc ? findSlide(s.doc, s.slideId) : undefined));
  const [shapeMenu, setShapeMenu] = useState<MenuPlace | null>(null);
  const [timerMenu, setTimerMenu] = useState<MenuPlace | null>(null);
  const timers = useEngine((e) => e.state?.timers);
  const add = (fn: () => void) => {
    finishTextEditing();
    fn();
  };
  const addText = () => {
    add(() => {
      const s = useEditor.getState();
      const at = shownSlide();
      if (!s.doc || !s.look || !at) return;
      const box = newTextBox(s.look);
      noteMade(box.id);
      commit(addElement(s.doc, at.id, box), { select: [box.id] });
      useEditor.setState({ group: 'words' });
      startEditing(box.id);
    });
  };
  const addShape = (choice: ShapeChoice) => {
    add(() => {
      const s = useEditor.getState();
      const at = shownSlide();
      if (!s.doc || !s.look || !at) return;
      const shape = newShape(choice, s.look, s.doc);
      commit(addElement(s.doc, at.id, shape), { select: [shape.id] });
    });
  };
  const addTimer = (timerId: string) => {
    add(() => {
      const s = useEditor.getState();
      const at = shownSlide();
      if (!s.doc || !at) return;
      const el = newTimerElement(timerId, s.look, s.doc);
      commit(addElement(s.doc, at.id, el), { select: [el.id] });
    });
  };
  const below = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: r.left, y: r.bottom + 4 };
  };
  return (
    <div className="flex min-w-0 items-start" data-testid="insert-group">
      <Cluster name="On the slide">
        <Tool icon={Type} testId="add-text" disabled={!slide} onClick={addText}>
          Text box
        </Tool>
        <Tool
          icon={Shapes}
          testId="add-shape"
          disabled={!slide}
          menu
          onClick={(e) => {
            setShapeMenu(below(e));
          }}
        >
          Shape
        </Tool>
        <Tool
          icon={ImagePlus}
          testId="add-media"
          disabled={!slide}
          onClick={() => {
            finishTextEditing();
            onPicture();
          }}
        >
          Picture or video
        </Tool>
        <Tool
          icon={Timer}
          testId="add-timer"
          disabled={!slide}
          menu
          onClick={(e) => {
            finishTextEditing();
            setTimerMenu(below(e));
          }}
        >
          Timer
        </Tool>
      </Cluster>
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
      {timerMenu && (
        <Menu
          at={timerMenu}
          label="Add a timer"
          onClose={() => {
            setTimerMenu(null);
          }}
          entries={
            timers && timers.length > 0
              ? timers.map((t) => ({
                  label: `${t.name} (${TIMER_KIND_NAMES[t.kind]})`,
                  icon: Timer,
                  onSelect: () => {
                    addTimer(t.id);
                  },
                }))
              : [{ label: 'No timers yet: make one in Timers', disabled: true, onSelect: () => undefined }]
          }
        />
      )}
    </div>
  );
}

/** Arrange: what is selected lined up with the slide (one) or with each other (several), spaced out, front and back. */
export function ArrangeGroup() {
  const doc = useEditor((s) => s.doc);
  const slideId = useEditor((s) => s.slideId);
  const selection = useEditor((s) => s.selection);
  const slide = doc ? findSlide(doc, slideId) : undefined;
  const selected = slide?.elements.filter((e) => selection.includes(e.id)) ?? [];
  const none = selected.length === 0 || !slide;
  const single = selected.length === 1;
  const align = (how: Alignment) => {
    const now = useEditor.getState().doc;
    if (!now || !slide || !doc) return;
    const moves = alignMoves(
      selected.map((el) => boundsOf(el)),
      how,
      doc,
    );
    commit(moveEach(now, slide.id, new Map(selected.map((el, i) => [el.id, moves[i] ?? { x: 0, y: 0 }]))));
  };
  const distribute = (axis: 'x' | 'y') => {
    const now = useEditor.getState().doc;
    if (!now || !slide) return;
    const moves = distributeMoves(
      selected.map((el) => boundsOf(el)),
      axis,
    );
    commit(moveEach(now, slide.id, new Map(selected.map((el, i) => [el.id, moves[i] ?? { x: 0, y: 0 }]))));
  };
  const order = (how: Arrange) => {
    const now = useEditor.getState().doc;
    if (now && slide) commit(arrange(now, slide.id, selection, how));
  };
  return (
    <div className="flex min-w-0 items-start" data-testid="arrange-group">
      <Cluster name={single ? 'Line up with the slide' : 'Line up'}>
        {(
          [
            ['left', 'Line up the left edges', AlignStartVertical],
            ['center', 'Line up the middles across', AlignCenterVertical],
            ['right', 'Line up the right edges', AlignEndVertical],
            ['top', 'Line up the tops', AlignStartHorizontal],
            ['middle', 'Line up the middles down', AlignCenterHorizontal],
            ['bottom', 'Line up the bottoms', AlignEndHorizontal],
          ] as const
        ).map(([how, label, icon]) => (
          <IconButton
            key={how}
            icon={icon}
            size="sm"
            label={single ? `${label} (with the slide)` : label}
            disabled={none}
            data-testid={`arrange-${how}`}
            onClick={() => {
              align(how);
            }}
          />
        ))}
      </Cluster>
      <Divider />
      <Cluster name="Space out">
        <IconButton
          icon={AlignHorizontalDistributeCenter}
          size="sm"
          label="Space out evenly across"
          disabled={selected.length < 3}
          data-testid="arrange-across"
          onClick={() => {
            distribute('x');
          }}
        />
        <IconButton
          icon={AlignVerticalDistributeCenter}
          size="sm"
          label="Space out evenly down"
          disabled={selected.length < 3}
          data-testid="arrange-down"
          onClick={() => {
            distribute('y');
          }}
        />
      </Cluster>
      <Divider />
      <Cluster name="Front and back">
        {(
          [
            ['front', 'Bring to the front', BringToFront],
            ['forward', 'Bring forward', ArrowUp],
            ['backward', 'Send backward', ArrowDown],
            ['back', 'Send to the back', SendToBack],
          ] as const
        ).map(([how, label, icon]) => (
          <IconButton
            key={how}
            icon={icon}
            size="sm"
            label={label}
            disabled={none}
            data-testid={`arrange-${how}`}
            onClick={() => {
              order(how);
            }}
          />
        ))}
      </Cluster>
    </div>
  );
}

/** Design: the slide's colour behind it and the darkening behind its words, quick (all of it in the side panel). */
export function DesignGroup() {
  const slide = useEditor((s) => (s.doc ? findSlide(s.doc, s.slideId) : undefined));
  const set = (patch: Parameters<typeof changeSlide>[2], coalesce?: string) => {
    const now = useEditor.getState().doc;
    if (now && slide) commit(changeSlide(now, slide.id, patch), coalesce ? { coalesce } : {});
  };
  const off = !slide;
  return (
    <div className="flex min-w-0 items-start" data-testid="design-group">
      <Cluster name="A colour behind it">
        <input
          type="checkbox"
          aria-label="A colour behind the slide"
          data-testid="design-color-on"
          disabled={off}
          checked={slide?.background != null}
          onChange={(e) => {
            set({ background: e.target.checked ? '#000000' : null });
          }}
          className="h-4 w-4 accent-primary"
        />
        <input
          type="color"
          aria-label="The colour behind the slide"
          data-testid="design-color"
          disabled={off || slide.background === null}
          value={(slide?.background ?? '#000000').slice(0, 7)}
          onChange={(e) => {
            set({ background: e.target.value }, `background:${slide?.id ?? ''}`);
          }}
          className="h-7 w-9 cursor-pointer rounded-md border border-field bg-panel-2 p-0.5 hover:border-muted disabled:cursor-not-allowed disabled:opacity-40"
        />
      </Cluster>
      <Divider />
      <Cluster name="Darken behind the words">
        <Select
          aria-label="Darken behind the words"
          data-testid="design-darken"
          className="w-44"
          disabled={off}
          value={slide?.darken?.kind ?? 'none'}
          onChange={(e) => {
            const kind = e.target.value;
            set({
              darken:
                kind === 'band' || kind === 'whole'
                  ? { kind, strength: slide?.darken?.strength ?? 0.6 }
                  : null,
            });
          }}
        >
          <option value="none">None</option>
          <option value="band">A band behind the words</option>
          <option value="whole">The whole picture</option>
        </Select>
        <Select
          aria-label="How dark"
          data-testid="design-darken-strength"
          className="w-20"
          disabled={off || !slide.darken}
          value={String(slide?.darken?.strength ?? 0.6)}
          onChange={(e) => {
            const kind = slide?.darken?.kind ?? 'band';
            set({ darken: { kind, strength: Number(e.target.value) } });
          }}
        >
          {DARKEN_STRENGTHS.map((x) => (
            <option key={x} value={String(x)}>
              {Math.round(x * 100)}%
            </option>
          ))}
        </Select>
      </Cluster>
    </div>
  );
}

/** Motion: how the slide comes on, and whether it moves on by itself, quick (as in the side panel). */
export function MotionGroup() {
  const slide = useEditor((s) => (s.doc ? findSlide(s.doc, s.slideId) : undefined));
  const set = (patch: Parameters<typeof changeSlide>[2], coalesce?: string) => {
    const now = useEditor.getState().doc;
    if (now && slide) commit(changeSlide(now, slide.id, patch), coalesce ? { coalesce } : {});
  };
  // A deck's slide comes on with its deck's own transition, set in the side panel (Session 54, C2).
  const deck = slide?.deck !== undefined;
  const transition = slide?.transition ?? null;
  const [seconds, setSeconds] = useState<string | null>(null);
  return (
    <div className="flex min-w-0 items-start" data-testid="motion-group">
      <Cluster name="Comes on with">
        <Select
          aria-label="Comes on with"
          data-testid="motion-transition"
          className="w-44"
          disabled={!slide || deck}
          title={deck ? 'A deck’s slide: its transitions are in the side panel.' : undefined}
          value={transition?.kind ?? 'none'}
          onChange={(e) => {
            const v = e.target.value;
            set(
              {
                transition:
                  v === 'none'
                    ? null
                    : v === 'cut'
                      ? { kind: 'cut', durationMs: 0 }
                      : {
                          kind: v as TransitionKind,
                          durationMs: transition && transition.kind !== 'cut' ? transition.durationMs : 800,
                        },
              },
              `transition:${slide?.id ?? ''}`,
            );
          }}
        >
          <option value="none">The presentation’s</option>
          <option value="cut">Cut (at once)</option>
          {TRANSITION_KINDS.filter((k) => k !== 'cut').map((k) => (
            <option key={k} value={k}>
              {TRANSITION_NAMES[k]}
            </option>
          ))}
        </Select>
      </Cluster>
      <Divider />
      <Cluster name="Moves on by itself">
        <input
          type="checkbox"
          aria-label="Moves on by itself"
          data-testid="motion-auto"
          disabled={!slide}
          checked={slide?.autoAdvanceMs != null}
          onChange={(e) => {
            set({ autoAdvanceMs: e.target.checked ? 5000 : null });
          }}
          className="h-4 w-4 accent-primary"
        />
        <NumberInput
          aria-label="Moves on after (seconds)"
          data-testid="motion-auto-seconds"
          className="h-7 w-16"
          unit="s"
          min={0.5}
          max={3600}
          step={0.5}
          disabled={(slide?.autoAdvanceMs ?? null) === null}
          value={seconds ?? String((slide?.autoAdvanceMs ?? 5000) / 1000)}
          onFocus={() => {
            setSeconds(String((slide?.autoAdvanceMs ?? 5000) / 1000));
          }}
          onBlur={() => {
            setSeconds(null);
          }}
          onChange={(e) => {
            setSeconds(e.target.value);
            const n = Number(e.target.value);
            if (!Number.isFinite(n) || n < 0.5 || n > 3600) return;
            set({ autoAdvanceMs: Math.round(n * 1000) }, `auto:${slide?.id ?? ''}`);
          }}
        />
      </Cluster>
    </div>
  );
}

/** Slides: a new one (or a timer slide, or a group), a copy, up and down, deleted, hidden in the show. */
export function SlidesGroup() {
  const doc = useEditor((s) => s.doc);
  const current = useEditor((s) => s.slideId);
  const theme = useEditor((s) => s.look);
  const [timerSlide, setTimerSlide] = useState(false);
  const slide = doc ? findSlide(doc, current) : undefined;
  const all = doc ? slidesOf(doc) : [];
  const numbers = new Map(all.map((s, i) => [s.id, i + 1]));
  const act = (
    fn: (
      d: NonNullable<typeof doc>,
      slideId: string,
    ) => { doc: NonNullable<typeof doc>; show?: string } | null,
  ) => {
    finishTextEditing();
    const s = useEditor.getState();
    if (!s.doc || !s.slideId) return;
    const done = fn(s.doc, s.slideId);
    if (!done) return;
    commit(done.doc, { select: [] });
    if (done.show) showSlide(done.show);
  };
  const look = () => useEditor.getState().look;
  return (
    <div className="flex min-w-0 items-start" data-testid="slides-group">
      <Cluster name="New">
        <IconButton
          icon={Plus}
          size="sm"
          label="New slide after this one"
          data-testid="slide-new"
          disabled={!slide}
          onClick={() => {
            act((d, id) => {
              const made = newSlide(look());
              return { doc: addSlideAfter(d, id, made), show: made.id };
            });
          }}
        />
        <IconButton
          icon={Timer}
          size="sm"
          label="New timer slide after this one…"
          data-testid="slide-new-timer"
          disabled={!slide}
          onClick={() => {
            finishTextEditing();
            setTimerSlide(true);
          }}
        />
        <IconButton
          icon={ListPlus}
          size="sm"
          label="New group"
          data-testid="group-new"
          disabled={!doc}
          onClick={() => {
            act((d) => {
              const made = addGroup(d, 'New group', look());
              return { doc: made.doc, show: made.slideId };
            });
          }}
        />
      </Cluster>
      <Divider />
      <Cluster name="This slide">
        <IconButton
          icon={CopyPlus}
          size="sm"
          label="Duplicate this slide"
          data-testid="slide-duplicate"
          disabled={!slide}
          onClick={() => {
            act((d, id) => {
              const original = findSlide(d, id);
              if (!original) return null;
              const copy = copySlide(original);
              return { doc: addSlideAfter(d, id, copy), show: copy.id };
            });
          }}
        />
        <IconButton
          icon={ArrowUp}
          size="sm"
          label="Move this slide up"
          data-testid="slide-up"
          disabled={!slide}
          onClick={() => {
            act((d, id) => ({ doc: moveSlideBy(d, id, -1) }));
          }}
        />
        <IconButton
          icon={ArrowDown}
          size="sm"
          label="Move this slide down"
          data-testid="slide-down"
          disabled={!slide}
          onClick={() => {
            act((d, id) => ({ doc: moveSlideBy(d, id, 1) }));
          }}
        />
        <IconButton
          icon={EyeOff}
          size="sm"
          label="Hidden in the show"
          aria-pressed={slide ? !slide.enabled : false}
          variant={slide && !slide.enabled ? 'secondary' : 'ghost'}
          data-testid="slides-hide"
          disabled={!slide}
          onClick={() => {
            act((d, id) => {
              const s = findSlide(d, id);
              return s ? { doc: changeSlide(d, id, { enabled: !s.enabled }) } : null;
            });
          }}
        />
        <IconButton
          icon={Trash2}
          size="sm"
          variant="danger"
          label="Delete this slide"
          data-testid="slide-delete"
          disabled={!slide || all.length < 2}
          onClick={() => {
            act((d, id) => {
              const list = slidesOf(d);
              const at = list.findIndex((x) => x.id === id);
              const next = list[at + 1] ?? list[at - 1];
              return next ? { doc: removeSlide(d, id), show: next.id } : null;
            });
          }}
        />
      </Cluster>
      {timerSlide && doc && (
        <NewTimerSlideDialog
          where={`after slide ${String(current ? (numbers.get(current) ?? all.length) : all.length)}`}
          look={theme}
          size={doc}
          onAdd={(made) => {
            act((d, id) => ({ doc: addSlideAfter(d, id, made), show: made.id }));
            return null;
          }}
          onClose={() => {
            setTimerSlide(false);
          }}
        />
      )}
    </div>
  );
}
