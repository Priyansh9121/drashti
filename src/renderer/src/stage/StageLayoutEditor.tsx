import { useState } from 'react';
import { CALENDAR_LANG_NAMES, CALENDAR_LANGS } from '../../../shared/calendar';
import type { StageBox, StageBoxKind } from '../../../shared/stage-layouts';
import {
  newStageBox,
  STAGE_BOX_KINDS,
  STAGE_BOX_NAMES,
  STAGE_HEIGHT,
  STAGE_WIDTH,
} from '../../../shared/stage-layouts';
import { DEFAULT_LIVE_GROUP_LOOK } from '../../../shared/looks';
import { BoxCanvas } from '../boxes/BoxCanvas';
import { useEngine } from '../engine/engine-store';
import { StageLayoutView } from '../render/StageLayoutView';
import { StageView } from '../render/StageView';
import { PlacedInParent } from '../render/Placed';
import { useFirstGroupLook } from '../screens/screens-store';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { ConfirmDialog, Dialog } from '../ui/Dialog';
import { KeepChangesDialog, settingsChanged } from '../ui/KeepChanges';
import { plural } from '../ui/text';
import { ColorInput, Field, NumberInput, Select, Textarea, TextInput } from '../ui/Field';
import { CopyPlus, Plus, Trash2 } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { SectionTitle } from '../ui/Panel';
import { Checkbox } from '../ui/Toggle';
import {
  change,
  chooseBox,
  closeStageLayouts,
  duplicate,
  isDirty,
  remove,
  save,
  show,
  STANDARD,
  useStageLayouts,
} from './stage-layouts-store';

/*
 * The stage layout editor (Screens, a stage group, Edit stage layouts…): the
 * layouts on the left (Standard, built in, first), the one shown in the
 * middle with what the stage shows now, and the chosen box's settings on the
 * right. Changes are kept until Save; a stage group whose live Look uses the
 * layout shows them then.
 */

const ALIGN_NAMES = { left: 'Left', center: 'Middle', right: 'Right' } as const;

function BoxSettings({ box }: { box: StageBox }) {
  const timers = useEngine((s) => s.state?.timers);
  const set = (patch: Partial<StageBox>) => {
    change((e) => ({ ...e, boxes: e.boxes.map((b) => (b.id === box.id ? { ...b, ...patch } : b)) }));
  };
  const frame = (key: 'x' | 'y' | 'width' | 'height', value: number) => {
    if (!Number.isFinite(value)) return;
    const min = key === 'width' || key === 'height' ? 8 : -STAGE_WIDTH;
    set({ frame: { ...box.frame, [key]: Math.max(min, Math.round(value)) } });
  };
  return (
    <div className="space-y-3" data-testid="stage-box-settings">
      <p className="text-sm font-medium">{STAGE_BOX_NAMES[box.kind]}</p>
      <div className="grid grid-cols-2 gap-2">
        {(['x', 'y', 'width', 'height'] as const).map((key) => (
          <Field
            key={key}
            label={key === 'x' ? 'Across' : key === 'y' ? 'Down' : key === 'width' ? 'Width' : 'Height'}
          >
            <NumberInput
              value={box.frame[key]}
              unit="px"
              onChange={(e) => {
                frame(key, e.target.valueAsNumber);
              }}
            />
          </Field>
        ))}
      </div>
      <Checkbox
        label="Words as large as fit"
        checked={box.size === 'fit'}
        data-testid="stage-box-fit"
        onChange={(e) => {
          set({ size: e.target.checked ? 'fit' : 56 });
        }}
      />
      {box.size !== 'fit' && (
        <Field label="Text size">
          <NumberInput
            value={box.size}
            min={8}
            max={600}
            unit="px"
            data-testid="stage-box-size"
            onChange={(e) => {
              const v = e.target.valueAsNumber;
              if (Number.isFinite(v)) set({ size: Math.min(600, Math.max(8, Math.round(v))) });
            }}
          />
        </Field>
      )}
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
      {box.kind === 'clock' && (
        <Checkbox
          label="Today's Samvat date under the time"
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
          The quote of the day from the idle rotation&apos;s quotes: one each day, the same all day.
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
        <Field label="How many items">
          <NumberInput
            value={box.count ?? 4}
            min={1}
            max={8}
            onChange={(e) => {
              const v = e.target.valueAsNumber;
              if (Number.isFinite(v)) set({ count: Math.min(8, Math.max(1, Math.round(v))) });
            }}
          />
        </Field>
      )}
      <Button
        variant="danger"
        size="sm"
        icon={Trash2}
        onClick={() => {
          change((e) => ({ ...e, boxes: e.boxes.filter((b) => b.id !== box.id) }));
          chooseBox(null);
        }}
      >
        Remove this box
      </Button>
    </div>
  );
}

export function StageLayoutEditor() {
  const s = useStageLayouts();
  const state = useEngine((x) => x.state);
  const stage = useFirstGroupLook('stage');
  const [kind, setKind] = useState<StageBoxKind>('current');
  const [ask, setAsk] = useState<null | { why: 'switch'; to: string } | { why: 'close' } | { why: 'remove' }>(
    null,
  );
  if (!s.open) return null;
  const e = s.editing;
  const dirty = isDirty(s);
  const languages = stage?.look.languages ?? DEFAULT_LIVE_GROUP_LOOK.languages;
  const box = e?.boxes.find((b) => b.id === s.boxId) ?? null;
  const go = (to: string) => {
    if (dirty) setAsk({ why: 'switch', to });
    else show(to);
  };
  return (
    <Dialog
      title="Stage layouts"
      subtitle="What a stage screen shows. A stage group gets its layout in each Look (Screens)."
      size="full"
      onClose={() => {
        if (dirty) setAsk({ why: 'close' });
        else closeStageLayouts();
      }}
      closeLabel="Close stage layouts"
      testId="stage-layout-editor"
      bodyClassName="flex gap-4 overflow-hidden"
      footer={
        e && (
          <>
            {e.id && (
              <Button
                variant="danger"
                icon={Trash2}
                className="mr-auto"
                onClick={() => {
                  setAsk({ why: 'remove' });
                }}
              >
                Remove layout
              </Button>
            )}
            <Button
              disabled={!dirty || e.id === null}
              onClick={() => {
                show(e.id ?? STANDARD);
              }}
            >
              Undo changes
            </Button>
            <Button
              variant="primary"
              disabled={!dirty}
              onClick={() => void save()}
              data-testid="stage-layout-save"
            >
              Save
            </Button>
          </>
        )
      }
    >
      <nav aria-label="Stage layouts" className="flex w-56 shrink-0 flex-col gap-2 overflow-y-auto">
        <ul className="space-y-1" data-testid="stage-layout-list">
          {[{ id: STANDARD, name: 'Standard (built in)' }, ...(s.layouts ?? [])].map((l) => {
            const on = (s.shownId || '') === l.id;
            return (
              <li key={l.id}>
                <button
                  type="button"
                  aria-current={on ? 'true' : undefined}
                  onClick={() => {
                    go(l.id);
                  }}
                  className={cx(
                    'w-full truncate rounded-md px-2 py-1.5 text-left text-sm',
                    on ? 'bg-panel-3 font-medium text-fg' : 'text-muted hover:bg-panel-2 hover:text-fg',
                  )}
                >
                  {l.name}
                </button>
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
        <Button icon={CopyPlus} onClick={duplicate} data-testid="stage-layout-duplicate">
          {e ? 'Duplicate' : 'Duplicate Standard'}
        </Button>
      </nav>

      {e ? (
        <BoxCanvas
          size={{ width: STAGE_WIDTH, height: STAGE_HEIGHT }}
          boxes={e.boxes.map((b) => ({ id: b.id, frame: b.frame, name: STAGE_BOX_NAMES[b.kind] }))}
          selected={s.boxId}
          onSelect={chooseBox}
          onChange={(id, frame) => {
            change((x) => ({ ...x, boxes: x.boxes.map((b) => (b.id === id ? { ...b, frame } : b)) }));
          }}
          picture={
            state && (
              <StageLayoutView
                layout={{ id: e.id ?? '', name: e.name, background: e.background, boxes: e.boxes }}
                state={state}
                languages={languages}
              />
            )
          }
          label="The stage layout. Tab chooses the next box, the arrow keys move it (Shift for ten pixels)."
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
                change((x) => ({ ...x, name }));
              }}
            />
          </Field>
          <Field label="Background">
            <ColorInput
              value={e.background}
              onChange={(ev) => {
                const background = ev.target.value;
                change((x) => ({ ...x, background }));
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
                disabled={e.boxes.length >= 40}
                data-testid="stage-box-add"
                onClick={() => {
                  const made = newStageBox(kind, crypto.randomUUID());
                  change((x) => ({ ...x, boxes: [...x.boxes, made] }));
                  chooseBox(made.id);
                }}
              >
                Add
              </Button>
            </div>
          </section>
          {box ? <BoxSettings box={box} /> : <p className="text-xs text-muted">Choose a box to change it.</p>}
        </aside>
      )}

      {ask?.why === 'remove' && (
        <ConfirmDialog
          title={`Remove “${e?.name ?? ''}”?`}
          confirmLabel="Remove"
          onCancel={() => {
            setAsk(null);
          }}
          onConfirm={() => {
            setAsk(null);
            void remove();
          }}
          testId="stage-layout-confirm"
        >
          <p>Stage groups that use it in a Look show the Standard stage screen instead.</p>
        </ConfirmDialog>
      )}
      {ask && ask.why !== 'remove' && (
        <KeepChangesDialog
          name={<>the stage layout “{e?.name ?? ''}”</>}
          lost={
            s.saved === null
              ? 'This new layout is not saved yet.'
              : `You changed ${plural(Math.max(1, settingsChanged(s.saved, e)), 'setting')}.`
          }
          live="Saving changes the stage screens at once wherever the live Look uses this layout."
          onKeepEditing={() => {
            setAsk(null);
          }}
          onSave={() => {
            const was = ask;
            setAsk(null);
            void save().then((ok) => {
              if (!ok) return;
              if (was.why === 'close') closeStageLayouts();
              else show(was.to);
            });
          }}
          onThrowAway={() => {
            const was = ask;
            setAsk(null);
            if (was.why === 'close') closeStageLayouts();
            else show(was.to);
          }}
        />
      )}
    </Dialog>
  );
}
