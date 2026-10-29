import { useRef, useState } from 'react';
import { CALENDAR_LANG_NAMES, CALENDAR_LANGS } from '../../../shared/calendar';
import { shortcutText } from '../../../shared/keymap';
import type { StageBox, StageBoxKind } from '../../../shared/stage-layouts';
import {
  AUDIENCE_BOX_MIN,
  isPictureBox,
  MAX_STAGE_BOXES,
  smallestBox,
  STAGE_BOX_KINDS,
  STAGE_BOX_NAMES,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  typedFrame,
} from '../../../shared/stage-layouts';
import { DEFAULT_LIVE_GROUP_LOOK } from '../../../shared/looks';
import { countsDown } from '../../../shared/timers';
import { BoxCanvas } from '../boxes/BoxCanvas';
import { useEngine } from '../engine/engine-store';
import { StageLayoutView } from '../render/StageLayoutView';
import { StageView } from '../render/StageView';
import { PlacedInParent } from '../render/Placed';
import { useFirstGroupLook } from '../screens/screens-store';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { Dialog } from '../ui/Dialog';
import { KeepChangesDialog, settingsChanged } from '../ui/KeepChanges';
import { plural } from '../ui/text';
import { ColorInput, Field, Select, Textarea, TextInput } from '../ui/Field';
import { CopyPlus, FilePlus, LayoutTemplate, Pencil, Plus, Trash2, Undo2 } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { SectionTitle } from '../ui/Panel';
import { Checkbox } from '../ui/Toggle';
import { Truncate } from '../ui/Truncate';
import { useHallPicture } from './hall-picture';
import { BoxLookFields, BoxOrderButtons, ClockBoxFields, TimerBoxFields } from './StageBoxFields';
import { StageTemplateDialog } from './StageTemplateDialog';
import { TypedNumberField } from './TypedNumberField';
import {
  addBox,
  change,
  chooseBox,
  closeStageLayouts,
  deleteBox,
  duplicate,
  isDirty,
  lastStep,
  newLayout,
  remove,
  rename,
  save,
  show,
  STANDARD,
  undoStage,
  useStageLayouts,
} from './stage-layouts-store';

/*
 * The stage layout editor (the Stage screen panel's Edit layouts…, or Screens): the layouts on the left (Standard,
 * built in, first; the one every stage screen shows marked), the one shown in the middle with what the stage shows
 * now, and the chosen box's settings on the right. Changes to the boxes are kept until Save; the stage screens show
 * them then, if it is the layout they show. Since Session 55 New, New from a Template…, Duplicate, Rename… and
 * Delete act at once, and every step, those and each change to the boxes, has Undo (the button, or Mod+Z); a box
 * is deleted by its button on the canvas, by Delete or Backspace, or in its settings. New from a Template…
 * (Session 54) makes a ready-made layout and its timer, and chooses it for every stage screen at once.
 */

/** The layout every stage screen shows now (Session 55, the engine's state): its id, or null for Standard. */
const chosenNow = () => useEngine.getState().state?.stage?.layout?.id ?? null;

const ALIGN_NAMES = { left: 'Left', center: 'Middle', right: 'Right' } as const;

const FRAME_NAMES = { x: 'Across', y: 'Down', width: 'Width', height: 'Height' } as const;

function BoxSettings({ box }: { box: StageBox }) {
  const timers = useEngine((s) => s.state?.timers);
  // A timer box's timer: every running timer (none chosen) or one no longer in Timers counts as counting down.
  const chosenTimer = box.timerId ? timers?.find((t) => t.id === box.timerId) : undefined;
  const set = (patch: Partial<StageBox>) => {
    change(
      (e) => ({ ...e, boxes: e.boxes.map((b) => (b.id === box.id ? { ...b, ...patch } : b)) }),
      `Changed the box ${STAGE_BOX_NAMES[box.kind]}`,
      `box:${box.id}:${Object.keys(patch).join(',')}`,
    );
  };
  const smallest = smallestBox(box.kind);
  return (
    <div className="space-y-3" data-testid="stage-box-settings">
      <p className="text-sm font-medium">{STAGE_BOX_NAMES[box.kind]}</p>
      <div className="grid grid-cols-2 gap-2">
        {(['x', 'y', 'width', 'height'] as const).map((key) => (
          <TypedNumberField
            key={key}
            label={FRAME_NAMES[key]}
            value={box.frame[key]}
            min={key === 'width' || key === 'height' ? smallest[key] : undefined}
            unit="px"
            onChange={(value) => {
              set({ frame: typedFrame(box, key, value) });
            }}
          />
        ))}
      </div>
      {/* Which box is over which (Session 54): boxes may overlap. */}
      <BoxOrderButtons box={box} />
      {box.kind === 'audience' ? (
        // The hall's picture (Session 50): no words of its own, so no size, colour or alignment.
        <p className="text-xs text-muted" data-testid="stage-box-audience-note">
          What the hall’s screens show now, as the first audience group shows it: the background, the slide,
          messages and the ticker, black-out and the Wallpaper too, at 16:9 with black around it. The boxes
          after it in the list draw over it. Resized here, it goes no smaller than {AUDIENCE_BOX_MIN.width} ×{' '}
          {AUDIENCE_BOX_MIN.height}, so “Audience off” and “No audience screens” can be read in it.
        </p>
      ) : box.kind === 'videoInput' ? (
        // The chosen video input (Session 55): a picture too, with no words of its own.
        <p className="text-xs text-muted" data-testid="stage-box-input-note">
          The video input chosen in the Stage screen panel, live, whatever the audience screens show: at the
          mandir, the video mixer’s programme. When the audience shows it too, both use the same picture from
          the device. A node’s screen and a stage tablet name it instead. The boxes after it in the list draw
          over it.
        </p>
      ) : (
        <Checkbox
          label="Words as large as fit"
          checked={box.size === 'fit'}
          data-testid="stage-box-fit"
          onChange={(e) => {
            // Fitted, as large as the box holds (Session 54: a box saved before keeps to 400 px until then).
            set(e.target.checked ? { size: 'fit', fitWhole: true } : { size: 56 });
          }}
        />
      )}
      {!isPictureBox(box.kind) && box.size !== 'fit' && (
        // What is typed shows as typed, the box taking it within 8 to 600 px (Session 54, G4: "4" became 8).
        <TypedNumberField
          label="Text size"
          value={box.size}
          min={8}
          max={600}
          unit="px"
          testId="stage-box-size"
          onChange={(v) => {
            set({ size: Math.min(600, Math.max(8, Math.round(v))) });
          }}
        />
      )}
      {!isPictureBox(box.kind) && (
        <>
          <Field label="Colour">
            <ColorInput
              value={box.color}
              data-testid="stage-box-color"
              onChange={(e) => {
                set({ color: e.target.value });
              }}
            />
          </Field>
          <Field label="Line up">
            <Select
              value={box.align}
              data-testid="stage-box-align"
              onChange={(e) => {
                const v = e.target.value;
                set({ align: v === 'center' || v === 'right' ? v : 'left' });
              }}
            >
              {(['left', 'center', 'right'] as const).map((a) => (
                <option key={a} value={a}>
                  {ALIGN_NAMES[a]}
                </option>
              ))}
            </Select>
          </Field>
          {/* Up and down, bold, a fill, a line round the letters and a shadow (Session 54). */}
          <BoxLookFields box={box} />
        </>
      )}
      <Field label="Label above it" hint="Leave empty for none.">
        <TextInput
          value={box.label}
          maxLength={40}
          onChange={(e) => {
            set({ label: e.target.value });
          }}
        />
      </Field>
      {box.kind === 'timer' && (
        <Field label="Which timer">
          <Select
            value={box.timerId ?? ''}
            data-testid="stage-box-timer"
            onChange={(e) => {
              set({ timerId: e.target.value === '' ? null : e.target.value });
            }}
          >
            <option value="">Every running timer</option>
            {(timers ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {box.kind === 'timer' && (
        // Its way of writing the time, its colours and its flash (Session 54).
        <TimerBoxFields box={box} countsDown={chosenTimer === undefined || countsDown(chosenTimer)} />
      )}
      {box.kind === 'clock' && <ClockBoxFields box={box} />}
      {box.kind === 'clock' && (
        <Checkbox
          label="Today’s Samvat date under the time"
          checked={box.calendar ?? false}
          data-testid="stage-box-calendar"
          onChange={(e) => {
            set({ calendar: e.target.checked, lang: box.lang ?? 'gu' });
          }}
        />
      )}
      {(box.kind === 'samvat' || (box.kind === 'clock' && box.calendar)) && (
        <Field label="The Samvat date in">
          <Select
            value={box.lang ?? 'gu'}
            data-testid="stage-box-lang"
            onChange={(e) => {
              set({ lang: e.target.value === 'en' ? 'en' : 'gu' });
            }}
          >
            {CALENDAR_LANGS.map((l) => (
              <option key={l} value={l}>
                {CALENDAR_LANG_NAMES[l]}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {box.kind === 'quote' && (
        <p className="text-xs text-muted">
          The quote of the day from the idle rotation’s quotes: one each day, the same all day.
        </p>
      )}
      {box.kind === 'samvat' && (
        <p className="text-xs text-muted">
          From the calendars loaded in Timers › Calendar. A date they do not give shows nothing.
        </p>
      )}
      {box.kind === 'text' && (
        <Field label="Words">
          <Textarea
            value={box.text ?? ''}
            maxLength={500}
            rows={3}
            data-testid="stage-box-text"
            onChange={(e) => {
              set({ text: e.target.value });
            }}
          />
        </Field>
      )}
      {box.kind === 'upcoming' && (
        // As typed, the box taking 1 to 8 (Session 54, Part A's review: Backspace then 3 gave 8).
        <TypedNumberField
          label="How many items"
          value={box.count ?? 4}
          min={1}
          max={8}
          onChange={(v) => {
            set({ count: Math.min(8, Math.max(1, Math.round(v))) });
          }}
        />
      )}
      <Button
        variant="danger"
        size="sm"
        icon={Trash2}
        data-testid="stage-box-delete"
        onClick={() => {
          deleteBox(box.id);
        }}
      >
        Delete this box
      </Button>
    </div>
  );
}

/** Rename… (Session 55): the layout shown, a new name typed; Enter or Rename keeps it, Esc or Cancel does not. */
function RenameDialog({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const [text, setText] = useState(name);
  const problem = useStageLayouts((s) => s.problem);
  const [tried, setTried] = useState(false);
  const keep = () => {
    setTried(true);
    void rename(id, text).then((ok) => {
      if (ok) onClose();
    });
  };
  return (
    <Dialog
      title="Rename the layout"
      size="sm"
      onClose={onClose}
      closeButton={false}
      testId="stage-layout-rename-dialog"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" data-testid="stage-layout-rename-keep" onClick={keep}>
            Rename
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          keep();
        }}
      >
        <Field label="Its name" error={tried ? problem : null}>
          <TextInput
            data-autofocus
            data-testid="stage-layout-rename-name"
            value={text}
            maxLength={60}
            onFocus={(e) => {
              e.currentTarget.select();
            }}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
        </Field>
      </form>
    </Dialog>
  );
}

export function StageLayoutEditor({ platform = '' }: { platform?: string }) {
  const s = useStageLayouts();
  const state = useEngine((x) => x.state);
  const stage = useFirstGroupLook('stage');
  // The layout every stage screen shows (Session 55): marked in the list.
  const chosenId = useEngine((x) => x.state?.stage?.layout?.id ?? STANDARD);
  // The audience picture box's picture (Session 50): the hall's, as the stage screens are told it.
  const hall = useHallPicture();
  const [kind, setKind] = useState<StageBoxKind>('current');
  const [ask, setAsk] = useState<
    | null
    | { why: 'switch'; to: string }
    | { why: 'close' }
    | { why: 'template' }
    | { why: 'new' }
    | { why: 'duplicate' }
  >(null);
  // New from a Template… (Session 54): its dialog, over the editor.
  const [templates, setTemplates] = useState(false);
  // Rename… (Session 55): its dialog, over the editor.
  const [renaming, setRenaming] = useState(false);
  // A box being dragged (Session 55): the layout as it was when the drag began, for one Undo step at its end.
  const dragFrom = useRef<typeof s.editing>(null);
  if (!s.open) return null;
  const e = s.editing;
  const dirty = isDirty(s);
  const languages = stage?.look.languages ?? DEFAULT_LIVE_GROUP_LOOK.languages;
  const box = e?.boxes.find((b) => b.id === s.boxId) ?? null;
  const step = lastStep(s);
  const go = (to: string) => {
    if (dirty) setAsk({ why: 'switch', to });
    else show(to);
  };
  const doNew = () => {
    if (dirty) setAsk({ why: 'new' });
    else void newLayout();
  };
  const doDuplicate = () => {
    if (dirty) setAsk({ why: 'duplicate' });
    else void duplicate();
  };
  return (
    <Dialog
      title="Stage layouts"
      subtitle="What a stage screen shows. The Stage screen panel’s Layout chooses the one every stage screen shows."
      size="full"
      onClose={() => {
        if (dirty) setAsk({ why: 'close' });
        else closeStageLayouts();
      }}
      closeLabel="Close stage layouts"
      testId="stage-layout-editor"
      bodyClassName="flex gap-4 overflow-hidden"
      footer={
        <>
          {/* Undo (Session 55): the last step, said, and taken back by the button or Mod+Z. */}
          <div
            className="mr-auto flex min-w-0 flex-1 items-center gap-2"
            data-testid="stage-layout-undo-line"
          >
            {step && (
              <>
                <Button
                  size="sm"
                  icon={Undo2}
                  kbd={platform ? shortcutText('undo', platform) : undefined}
                  data-testid="stage-layout-undo"
                  onClick={() => void undoStage()}
                >
                  Undo
                </Button>
                <Truncate text={step.text} className="min-w-0 flex-1 text-xs text-muted" />
              </>
            )}
          </div>
          {e && (
            <Button
              variant="primary"
              disabled={!dirty}
              onClick={() => void save()}
              data-testid="stage-layout-save"
            >
              Save
            </Button>
          )}
        </>
      }
    >
      <nav aria-label="Stage layouts" className="flex w-56 shrink-0 flex-col gap-2 overflow-y-auto">
        <ul className="space-y-1" data-testid="stage-layout-list">
          {[{ id: STANDARD, name: 'Standard (built in)' }, ...(s.layouts ?? [])].map((l) => {
            const on = (s.shownId || '') === l.id;
            const inUse = chosenId === l.id;
            return (
              <li key={l.id} className="flex items-center gap-1">
                <button
                  type="button"
                  aria-current={on ? 'true' : undefined}
                  aria-describedby={inUse ? 'stage-layout-in-use' : undefined}
                  data-in-use={inUse ? 'true' : undefined}
                  onClick={() => {
                    go(l.id);
                  }}
                  className={cx(
                    'min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm',
                    on ? 'bg-panel-3 font-medium text-fg' : 'text-muted hover:bg-panel-2 hover:text-fg',
                  )}
                >
                  {l.name}
                </button>
                {inUse && (
                  <Badge tone="info" data-testid="stage-layout-in-use">
                    On stage
                  </Badge>
                )}
              </li>
            );
          })}
          {e?.id === null && (
            <li>
              <span className="block w-full truncate rounded-md bg-panel-3 px-2 py-1.5 text-sm font-medium">
                {e.name} (not saved)
              </span>
            </li>
          )}
        </ul>
        <p id="stage-layout-in-use" className="sr-only">
          On the stage screens now
        </p>
        <Button icon={FilePlus} onClick={doNew} data-testid="stage-layout-new">
          New
        </Button>
        <Button
          icon={LayoutTemplate}
          data-testid="stage-layout-from-template"
          onClick={() => {
            if (dirty) setAsk({ why: 'template' });
            else setTemplates(true);
          }}
        >
          New from a Template…
        </Button>
        <Button icon={CopyPlus} onClick={doDuplicate} data-testid="stage-layout-duplicate">
          {e ? 'Duplicate' : 'Duplicate Standard'}
        </Button>
        {e?.id && (
          <>
            <Button
              icon={Pencil}
              data-testid="stage-layout-rename"
              onClick={() => {
                setRenaming(true);
              }}
            >
              Rename…
            </Button>
            <Button
              variant="danger"
              icon={Trash2}
              data-testid="stage-layout-delete"
              onClick={() => void remove(chosenNow)}
            >
              Delete
            </Button>
          </>
        )}
      </nav>

      {e ? (
        <BoxCanvas
          size={{ width: STAGE_WIDTH, height: STAGE_HEIGHT }}
          boxes={e.boxes.map((b) => ({
            id: b.id,
            frame: b.frame,
            name: STAGE_BOX_NAMES[b.kind],
            // No smaller than its kind's smallest (Session 53: the audience picture's, where its line reads).
            min: smallestBox(b.kind),
          }))}
          selected={s.boxId}
          onSelect={chooseBox}
          onChange={(id, frame, done) => {
            const place = (x: NonNullable<typeof e>) => ({
              ...x,
              boxes: x.boxes.map((b) => (b.id === id ? { ...b, frame } : b)),
            });
            // A drag is one step for Undo (Session 55): the layout as it began, kept until it ends.
            if (!done) {
              dragFrom.current ??= useStageLayouts.getState().editing;
              useStageLayouts.setState((x) => (x.editing ? { editing: place(x.editing) } : {}));
              return;
            }
            const from = dragFrom.current;
            dragFrom.current = null;
            const name = STAGE_BOX_NAMES[e.boxes.find((b) => b.id === id)?.kind ?? 'text'];
            if (from) useStageLayouts.setState({ editing: from });
            change(place, `Moved or resized the box ${name}`, `frame:${id}`);
          }}
          onDelete={deleteBox}
          picture={
            state && (
              <StageLayoutView
                layout={{ id: e.id ?? '', name: e.name, background: e.background, boxes: e.boxes }}
                state={state}
                languages={languages}
                hall={hall}
              />
            )
          }
          label="The stage layout. Tab chooses the next box, the arrow keys move it (Shift for ten pixels), and with Alt or Option they make it larger or smaller. Delete or Backspace deletes it."
          testId="stage-layout-canvas"
        />
      ) : (
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Notice tone="info">
            Standard is the stage screen Drashti comes with: the slide and the next one, notes, the clock,
            running timers and the stage message, making room as they come and go. It cannot be changed:
            Duplicate it to make a layout of boxes to place as you like.
          </Notice>
          <div
            className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-line bg-black"
            data-a11y-picture
            aria-hidden="true"
          >
            {state && (
              <PlacedInParent content={{ width: 1920, height: 1080 }} mode="fit" className="absolute inset-0">
                <div className="relative h-[1080px] w-[1920px]">
                  <StageView state={state} languages={languages} />
                </div>
              </PlacedInParent>
            )}
          </div>
        </div>
      )}

      {e && (
        <aside aria-label="Layout and box settings" className="w-72 shrink-0 space-y-4 overflow-y-auto pr-1">
          {s.problem && <Notice tone="danger">{s.problem}</Notice>}
          <Field label="Layout name">
            <TextInput
              value={e.name}
              maxLength={60}
              data-testid="stage-layout-name"
              onChange={(ev) => {
                const name = ev.target.value;
                change((x) => ({ ...x, name }), 'Changed the layout’s name', 'name');
              }}
            />
          </Field>
          <Field label="Background">
            <ColorInput
              value={e.background}
              onChange={(ev) => {
                const background = ev.target.value;
                change((x) => ({ ...x, background }), 'Changed the background', 'background');
              }}
            />
          </Field>
          <section className="space-y-2">
            <SectionTitle>Boxes</SectionTitle>
            <ul className="space-y-1" data-testid="stage-box-list">
              {e.boxes.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    aria-pressed={b.id === s.boxId}
                    onClick={() => {
                      chooseBox(b.id);
                    }}
                    className={cx(
                      'w-full truncate rounded-md border px-2 py-1 text-left text-sm',
                      b.id === s.boxId ? 'border-accent bg-panel-3' : 'border-line hover:bg-panel-2',
                    )}
                  >
                    {STAGE_BOX_NAMES[b.kind]}
                    {b.kind === 'text' && b.text ? `: ${b.text}` : ''}
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Select
                aria-label="Kind of box to add"
                className="min-w-0 flex-1"
                value={kind}
                data-testid="stage-box-kind"
                onChange={(ev) => {
                  setKind(ev.target.value as StageBoxKind);
                }}
              >
                {STAGE_BOX_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {STAGE_BOX_NAMES[k]}
                  </option>
                ))}
              </Select>
              <Button
                icon={Plus}
                disabled={e.boxes.length >= MAX_STAGE_BOXES}
                data-testid="stage-box-add"
                onClick={() => {
                  addBox(kind);
                }}
              >
                Add
              </Button>
            </div>
          </section>
          {/* Its own fields for each box (Session 53): what is typed in one never shows for another. */}
          {box ? (
            <BoxSettings key={box.id} box={box} />
          ) : (
            <p className="text-xs text-muted">Choose a box to change it.</p>
          )}
        </aside>
      )}

      {ask && (
        <KeepChangesDialog
          name={<>the stage layout “{e?.name ?? ''}”</>}
          lost={
            s.saved === null
              ? 'This new layout is not saved yet.'
              : `You changed ${plural(Math.max(1, settingsChanged(s.saved, e)), 'setting')}.`
          }
          live="Saving changes the stage screens at once if it is the layout they show."
          onKeepEditing={() => {
            setAsk(null);
          }}
          onSave={() => {
            const was = ask;
            setAsk(null);
            void save().then((ok) => {
              if (!ok) return;
              if (was.why === 'close') closeStageLayouts();
              else if (was.why === 'template') setTemplates(true);
              else if (was.why === 'new') void newLayout();
              else if (was.why === 'duplicate') void duplicate();
              else show(was.to);
            });
          }}
          onThrowAway={() => {
            const was = ask;
            setAsk(null);
            if (was.why === 'close') closeStageLayouts();
            else if (was.why === 'switch') show(was.to);
            else {
              show(e?.id ?? STANDARD);
              if (was.why === 'template') setTemplates(true);
              else if (was.why === 'new') void newLayout();
              else void duplicate();
            }
          }}
        />
      )}
      {renaming && e?.id && (
        <RenameDialog
          id={e.id}
          name={s.layouts?.find((l) => l.id === e.id)?.name ?? e.name}
          onClose={() => {
            setRenaming(false);
          }}
        />
      )}
      {templates && (
        <StageTemplateDialog
          onClose={() => {
            setTemplates(false);
          }}
        />
      )}
    </Dialog>
  );
}
