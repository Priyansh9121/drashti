import { useMemo, useState } from 'react';
import type {
  LowerThirdAlign,
  LowerThirdFont,
  LowerThirdWeight,
  LowerThirdWhere,
} from '../../../shared/lower-thirds';
import {
  LOWER_THIRD_ALIGNS,
  LOWER_THIRD_BOTTOM,
  LOWER_THIRD_FONTS,
  LOWER_THIRD_LINE_MAX,
  LOWER_THIRD_SIZE,
  LOWER_THIRD_WHERE,
  WHERE_NAMES,
} from '../../../shared/lower-thirds';
import {
  animationById,
  LOWER_THIRD_ANIMATIONS,
  searchAnimations,
} from '../../../shared/lower-third-animations';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { Dialog } from '../ui/Dialog';
import { ColorInput, Field, Select, Slider, TextInput } from '../ui/Field';
import { Play } from '../ui/icons';
import { KeepChangesDialog, settingsChanged } from '../ui/KeepChanges';
import { Notice } from '../ui/Notice';
import { SectionTitle } from '../ui/Panel';
import { radioKeys, radioTabIndex } from '../ui/radio';
import { changeDraft, closeEditor, isDirty, saveDraft, useLowerThirds } from './lower-thirds-store';
import { LowerThirdPreview } from './LowerThirdPreview';

/*
 * Making or changing a lower third (Session 44): its lines (a name, a title and a place, say), how it looks (its
 * colours, one of Drashti's fonts, its size, left, centre or right, and how far from the bottom), where it shows,
 * and its animation, found by searching the library's plain names ("fade", "slide left", "bounce"); choosing one
 * plays it in the small picture beside the list. Closing with changes asks first, as every editor does.
 */

const LINE_LABELS = ['First line (a name, say)', 'Second line (a title)', 'Third line (a place)'];
const ALIGN_NAMES: Record<LowerThirdAlign, string> = { left: 'Left', centre: 'Centre', right: 'Right' };
const WEIGHT_NAMES: Record<LowerThirdWeight, string> = { 400: 'Regular', 500: 'Medium', 700: 'Bold' };

/** A row of choices as one radio group (one Tab stop; the arrows move the choice). */
function Choices<T extends string>({
  label,
  choices,
  value,
  names,
  onChoose,
  testId,
}: {
  label: string;
  choices: readonly T[];
  value: T;
  names: Record<T, string>;
  onChoose: (choice: T) => void;
  testId: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted" id={`${testId}-label`}>
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${testId}-label`}
        className="flex flex-wrap gap-1"
        data-testid={testId}
        onKeyDown={radioKeys(choices, value, onChoose)}
      >
        {choices.map((c, i) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={c === value}
            tabIndex={radioTabIndex(c === value, i, true)}
            data-choice={c}
            className={cx(
              'h-8 rounded-md border px-3 text-sm',
              c === value
                ? 'border-accent bg-panel-3 text-fg'
                : 'border-field bg-panel-2 text-muted hover:text-fg',
            )}
            onClick={() => {
              onChoose(c);
            }}
          >
            {names[c]}
          </button>
        ))}
      </div>
    </div>
  );
}

export function LowerThirdEditor() {
  const editing = useLowerThirds((s) => s.editing);
  const saving = useLowerThirds((s) => s.saving);
  const problem = useLowerThirds((s) => s.problem);
  const [query, setQuery] = useState('');
  const [play, setPlay] = useState(0);
  const [ask, setAsk] = useState(false);
  const found = useMemo(() => searchAnimations(query), [query]);
  if (!editing) return null;
  const d = editing.draft;
  const look = d.look;
  const dirty = isDirty(editing);
  const hasWords = d.lines.some((l) => l.trim() !== '');
  const chosen = animationById(d.animation);
  const close = () => {
    setQuery('');
    closeEditor();
  };
  const save = async () => {
    if (await saveDraft()) close();
  };
  return (
    <Dialog
      title={editing.id ? 'Change the lower third' : 'New lower third'}
      subtitle="Up to three lines across the bottom of the picture, coming in and going out with an animation."
      size="xl"
      onClose={() => {
        if (dirty) setAsk(true);
        else close();
      }}
      closeLabel="Close the lower third"
      testId="lower-third-editor"
      bodyClassName="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,340px)]"
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!hasWords || saving}
            data-testid="lower-third-save"
            onClick={() => void save()}
          >
            Save
          </Button>
        </>
      }
    >
      <section aria-label="Words and look" className="space-y-4">
        <div className="space-y-2">
          {LINE_LABELS.map((label, i) => (
            <Field key={label} label={label}>
              <TextInput
                value={d.lines[i] ?? ''}
                maxLength={LOWER_THIRD_LINE_MAX}
                data-testid="lower-third-line"
                placeholder={i === 0 ? 'Placeholder name' : ''}
                onChange={(e) => {
                  const lines = [...d.lines];
                  lines[i] = e.target.value;
                  changeDraft({ lines });
                }}
              />
            </Field>
          ))}
        </div>
        <Choices<LowerThirdWhere>
          label="Where it shows"
          choices={LOWER_THIRD_WHERE}
          value={d.where}
          names={WHERE_NAMES}
          testId="lower-third-where"
          onChoose={(where) => {
            changeDraft({ where });
          }}
        />
        <div className="space-y-3">
          <SectionTitle>How it looks</SectionTitle>
          <div className="flex flex-wrap gap-4">
            <Field label="Words">
              <ColorInput
                value={look.text}
                data-testid="lower-third-text-colour"
                onChange={(e) => {
                  changeDraft({ look: { ...look, text: e.target.value } });
                }}
              />
            </Field>
            <Field label="Band">
              <ColorInput
                value={look.band}
                data-testid="lower-third-band-colour"
                onChange={(e) => {
                  changeDraft({ look: { ...look, band: e.target.value } });
                }}
              />
            </Field>
            <Field label="How solid the band is" className="min-w-40 flex-1">
              <Slider
                min={0}
                max={100}
                step={5}
                value={Math.round(look.bandOpacity * 100)}
                format={(v) => `${String(v)}%`}
                onChange={(e) => {
                  changeDraft({ look: { ...look, bandOpacity: Number(e.target.value) / 100 } });
                }}
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-4">
            <Field label="Font">
              <Select
                value={look.font}
                data-testid="lower-third-font"
                onChange={(e) => {
                  changeDraft({ look: { ...look, font: e.target.value as LowerThirdFont } });
                }}
              >
                {LOWER_THIRD_FONTS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Weight">
              <Select
                value={String(look.weight)}
                onChange={(e) => {
                  changeDraft({ look: { ...look, weight: Number(e.target.value) as LowerThirdWeight } });
                }}
              >
                {([400, 500, 700] as const).map((w) => (
                  <option key={w} value={w}>
                    {WEIGHT_NAMES[w]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Size" className="min-w-48 flex-1">
              <Slider
                min={LOWER_THIRD_SIZE.min}
                max={LOWER_THIRD_SIZE.max}
                step={0.5}
                value={look.size}
                format={(v) => `${String(v)}% of the height`}
                data-testid="lower-third-size"
                onChange={(e) => {
                  changeDraft({ look: { ...look, size: Number(e.target.value) } });
                }}
              />
            </Field>
          </div>
          <Choices<LowerThirdAlign>
            label="Across the picture"
            choices={LOWER_THIRD_ALIGNS}
            value={look.align}
            names={ALIGN_NAMES}
            testId="lower-third-align"
            onChoose={(align) => {
              changeDraft({ look: { ...look, align } });
            }}
          />
          <Field label="From the bottom">
            <Slider
              min={LOWER_THIRD_BOTTOM.min}
              max={LOWER_THIRD_BOTTOM.max}
              step={1}
              value={look.bottom}
              format={(v) => `${String(v)}% of the height`}
              data-testid="lower-third-bottom"
              onChange={(e) => {
                changeDraft({ look: { ...look, bottom: Number(e.target.value) } });
              }}
            />
          </Field>
        </div>
      </section>
      <section aria-label="Animation" className="flex min-h-0 flex-col gap-2">
        <SectionTitle>Animation</SectionTitle>
        <LowerThirdPreview input={d} play={play} />
        <div className="flex items-center gap-2">
          <span
            className="min-w-0 flex-1 truncate text-sm text-fg"
            data-testid="lower-third-animation-chosen"
          >
            {chosen.name}
          </span>
          <Button
            variant="secondary"
            size="sm"
            icon={Play}
            onClick={() => {
              setPlay((n) => n + 1);
            }}
          >
            Play again
          </Button>
        </div>
        <Field
          label="Find an animation"
          hint={`${String(found.length)} of ${String(LOWER_THIRD_ANIMATIONS.length)}`}
        >
          <TextInput
            type="search"
            value={query}
            placeholder="fade, slide left, bounce…"
            data-testid="lower-third-search"
            onChange={(e) => {
              setQuery(e.target.value);
            }}
          />
        </Field>
        <ul
          aria-label="Animations"
          data-testid="lower-third-animations"
          className="max-h-72 min-h-0 space-y-0.5 overflow-y-auto rounded-md border border-line p-1"
        >
          {found.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                aria-pressed={a.id === d.animation}
                data-testid="lower-third-animation"
                data-id={a.id}
                className={cx(
                  rowButton,
                  a.id === d.animation ? 'bg-panel-3 text-fg' : 'text-muted hover:bg-panel-2 hover:text-fg',
                )}
                onClick={() => {
                  changeDraft({ animation: a.id });
                  setPlay((n) => n + 1);
                }}
              >
                {a.name}
              </button>
            </li>
          ))}
          {found.length === 0 && (
            <li className="px-2 py-1.5 text-sm text-muted">No animation is called that.</li>
          )}
        </ul>
      </section>
      {problem && (
        <Notice tone="danger" className="md:col-span-2">
          {problem}
        </Notice>
      )}
      {ask && (
        <KeepChangesDialog
          name="the lower third"
          lost={
            editing.saved === null
              ? 'This new lower third is not saved yet.'
              : `You changed ${String(Math.max(1, settingsChanged(editing.saved, editing.draft)))} setting${settingsChanged(editing.saved, editing.draft) === 1 ? '' : 's'}.`
          }
          live="Saving changes it at once on the screens if it is showing."
          onKeepEditing={() => {
            setAsk(false);
          }}
          onSave={() => {
            setAsk(false);
            void save();
          }}
          onThrowAway={() => {
            setAsk(false);
            close();
          }}
          saving={saving}
        />
      )}
    </Dialog>
  );
}

const rowButton = 'block w-full rounded-sm px-2 py-1.5 text-left text-sm';
