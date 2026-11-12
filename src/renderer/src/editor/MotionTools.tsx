import { useState } from 'react';
import { type DeckEffect, type DeckSlide, stepCount } from '../../../shared/deck';
import type { ElementMotion, SlideElement } from '../../../shared/model';
import { elementMotionSchema } from '../../../shared/model-schema';
import { hasElementMotion } from '../../../shared/element-motion';
import { renderEditedSlide } from '../../../shared/slide-design';
import { engineNow } from '../render/clock';
import { Button } from '../ui/Button';
import { NumberInput, Select } from '../ui/Field';
import { Play, Square } from '../ui/icons';
import { commit, useEditor } from './editor-store';
import { findSlide, mapElements } from './ops';
import { finishTextEditing } from './TextBoxEditor';
import { Cluster, Divider } from './RibbonParts';
import { emptyClicks } from './empty-clicks';

const EFFECTS = {
  in: [
    ['fade', 'Fade'],
    ['rise', 'Rise'],
    ['zoom', 'Grow'],
  ],
  emphasis: [
    ['pulse', 'Breathe'],
    ['turn', 'Rock'],
  ],
  out: [
    ['fade', 'Fade'],
    ['sink', 'Lower'],
    ['shrink', 'Shrink'],
  ],
} as const;
type Phase = keyof ElementMotion;
const NAMES: Record<Phase, string> = { in: 'Comes in', emphasis: 'Draws attention', out: 'Goes out' };
const DEFAULT_START: Record<Phase, number> = { in: 0, emphasis: 1000, out: 2000 };

function Seconds({
  value,
  disabled,
  label,
  testId,
  min,
  max,
  onChange,
}: {
  value: number;
  disabled: boolean;
  label: string;
  testId: string;
  min: number;
  max: number;
  onChange: (ms: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <NumberInput
      className="h-7 w-14"
      unit="s"
      aria-label={label}
      data-testid={testId}
      min={min / 1000}
      max={max / 1000}
      step={0.05}
      disabled={disabled}
      value={draft ?? String(value / 1000)}
      onFocus={() => setDraft(String(value / 1000))}
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = Number(e.target.value) * 1000;
        if (e.target.value.trim() && Number.isFinite(n) && n >= min && n <= max) onChange(Math.round(n));
      }}
    />
  );
}

const IMPORTED_EFFECTS: Record<DeckEffect['kind'], string> = {
  appear: 'Appear',
  fade: 'Fade',
  fly: 'Fly',
  wipe: 'Wipe',
  zoom: 'Zoom',
  spin: 'Spin',
  pulse: 'Pulse',
  float: 'Float',
  split: 'Split',
  'grow-shrink': 'Grow/Shrink',
  shape: 'Shape',
  wheel: 'Wheel',
  bars: 'Random Bars',
  bounce: 'Bounce',
};

/** An imported effect's name, and the paragraph it builds when the deck builds its box paragraph by paragraph. */
function importedEffect(effect: DeckEffect): string {
  const name = effect.kind === 'zoom' && effect.degrees ? 'Grow & Turn' : IMPORTED_EFFECTS[effect.kind];
  const [first, last] = effect.paragraphs ?? [];
  if (first === undefined || last === undefined) return name;
  return first === last
    ? `${name} · paragraph ${String(first + 1)}`
    : `${name} · paragraphs ${String(first + 1)}–${String(last + 1)}`;
}

/** An imported slide's PowerPoint animations: how many clicks, each effect in order, and what plays them. */
export function ImportedMotion({ deck, elements }: { deck: DeckSlide; elements?: readonly SlideElement[] }) {
  const clicks = stepCount(deck) - 1;
  const effects = deck.motion?.effects ?? [];
  const empty = elements ? emptyClicks(deck, elements) : [];
  const emptyNote =
    empty.length === 1
      ? `Click ${String(empty[0])} has nothing left to move. Next shows no change there. Check it before going live.`
      : empty.length > 1
        ? `Clicks ${empty.slice(0, -1).join(', ')} and ${String(empty.at(-1))} have nothing left to move. Next shows no change there. Check them before going live.`
        : null;
  const notes = [
    emptyNote,
    deck.motion?.approximate
      ? deck.steps.length
        ? 'This slide keeps PowerPoint’s video until you edit it.'
        : 'This slide uses the closest effects Drashti can play.'
      : null,
    effects.some((effect) => effect.paragraphs)
      ? 'An added paragraph comes in with the point before it.'
      : null,
  ].filter((note) => note !== null);
  return (
    <>
      <Divider />
      <Cluster name="PowerPoint animations">
        <div className="flex items-start gap-2 text-xs text-muted" data-testid="imported-motion">
          <div className="w-52 shrink-0 space-y-1">
            <p>{clicks === 1 ? '1 click' : `${String(clicks)} clicks`}</p>
            {effects.length > 0 && (
              <ol
                aria-label="PowerPoint animation order"
                className="max-h-16 overflow-y-auto"
                // A line can wrap at this width (an effect's name and its paragraph range), so even a short
                // list can scroll. The keys reach it whenever it is there.
                tabIndex={0}
              >
                {effects.map((effect, index) => (
                  <li key={index}>
                    {effect.step === 0 ? 'With the slide' : `Click ${String(effect.step)}`} ·{' '}
                    {importedEffect(effect)}
                  </li>
                ))}
              </ol>
            )}
          </div>
          {notes.length > 0 && (
            <ul
              aria-label="PowerPoint animation notes"
              className="max-h-21 w-52 shrink-0 space-y-1 overflow-y-auto"
              tabIndex={0}
            >
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </div>
      </Cluster>
    </>
  );
}

export function MotionTools() {
  const doc = useEditor((s) => s.doc);
  const slideId = useEditor((s) => s.slideId);
  const ids = useEditor((s) => s.selection);
  const preview = useEditor((s) => s.previewAt);
  const slide = doc ? findSlide(doc, slideId) : undefined;
  if (doc && slide?.deck?.motion)
    return <ImportedMotion deck={slide.deck} elements={renderEditedSlide(doc, slide).elements} />;
  const selected = slide?.elements.filter((el) => ids.includes(el.id)) ?? [];
  const disabled = !selected.length || Boolean(slide?.deck);
  const update = (phase: Phase, field: 'kind' | 'delayMs' | 'durationMs', value: string | number) => {
    finishTextEditing();
    const s = useEditor.getState();
    const at = s.doc ? findSlide(s.doc, s.slideId) : undefined;
    if (!s.doc || !at || at.deck) return;
    const next = mapElements(s.doc, at.id, s.selection, (el) => {
      if (field === 'kind' && value === 'none') {
        const { [phase]: _gone, ...motion } = el.motion ?? {};
        const { motion: _old, ...rest } = el;
        return hasElementMotion(motion) ? { ...rest, motion } : rest;
      }
      const old = el.motion?.[phase] ?? {
        kind: EFFECTS[phase][0][0],
        delayMs: DEFAULT_START[phase],
        durationMs: 600,
      };
      const parsed = elementMotionSchema.safeParse({ ...el.motion, [phase]: { ...old, [field]: value } });
      return parsed.success ? { ...el, motion: parsed.data } : el;
    });
    commit(
      next,
      field === 'kind'
        ? {}
        : { coalesce: `element-motion:${at.id}:${s.selection.join(',')}:${phase}:${field}` },
    );
  };
  const canPreview =
    doc &&
    slide &&
    !slide.deck &&
    renderEditedSlide(doc, slide).elements.some((el) => hasElementMotion(el.motion));
  return (
    <>
      <Divider />
      {(['in', 'emphasis', 'out'] as const).map((phase) => {
        const step = selected[0]?.motion?.[phase];
        const kind = step?.kind ?? 'none';
        const mixed = selected.some((el) => (el.motion?.[phase]?.kind ?? 'none') !== kind);
        return (
          <Cluster key={phase} name={NAMES[phase]}>
            <div className="flex flex-col gap-1">
              <Select
                className="h-7 w-32"
                aria-label={`${NAMES[phase]} effect`}
                data-testid={`motion-element-${phase}`}
                disabled={disabled}
                value={mixed ? 'mixed' : kind}
                onChange={(e) => update(phase, 'kind', e.target.value)}
              >
                {mixed && (
                  <option value="mixed" disabled>
                    Mixed
                  </option>
                )}
                <option value="none">None</option>
                {EFFECTS[phase].map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </Select>
              <div className="flex items-center gap-1">
                <Seconds
                  label={`${NAMES[phase]} starts after (seconds)`}
                  testId={`motion-${phase}-delay`}
                  value={step?.delayMs ?? DEFAULT_START[phase]}
                  min={0}
                  max={3_600_000}
                  disabled={disabled || kind === 'none'}
                  onChange={(n) => update(phase, 'delayMs', n)}
                />
                <Seconds
                  label={`${NAMES[phase]} lasts (seconds)`}
                  testId={`motion-${phase}-duration`}
                  value={step?.durationMs ?? 600}
                  min={50}
                  max={60_000}
                  disabled={disabled || kind === 'none'}
                  onChange={(n) => update(phase, 'durationMs', n)}
                />
              </div>
              <div className="flex justify-around text-2xs text-faint">
                <span>Starts at</span>
                <span>Lasts</span>
              </div>
            </div>
          </Cluster>
        );
      })}
      <Divider />
      <Cluster name="From the slide going up">
        <div className="flex max-w-36 flex-col gap-1">
          <Button
            size="sm"
            variant="ghost"
            icon={preview === null ? Play : Square}
            data-testid="motion-preview"
            disabled={!canPreview}
            onClick={() => {
              finishTextEditing();
              useEditor.setState((s) => ({ previewAt: s.previewAt === null ? engineNow() : null }));
            }}
          >
            {preview === null ? 'Preview' : 'Stop preview'}
          </Button>
          <span className="text-2xs leading-tight text-muted">
            Seconds from the slide going up. Animated slides stay whole, including on the stream.
          </span>
        </div>
      </Cluster>
    </>
  );
}
