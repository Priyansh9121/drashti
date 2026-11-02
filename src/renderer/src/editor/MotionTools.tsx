import { useState } from 'react';
import type { ElementMotion } from '../../../shared/model';
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

export function MotionTools() {
  const doc = useEditor((s) => s.doc);
  const slideId = useEditor((s) => s.slideId);
  const ids = useEditor((s) => s.selection);
  const preview = useEditor((s) => s.previewAt);
  const slide = doc ? findSlide(doc, slideId) : undefined;
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
