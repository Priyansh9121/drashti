import { useState } from 'react';
import type { SlideBackdrop } from '../../../shared/model';
import { cutText } from '../../../shared/text';
import { editDocSchema } from '../../../shared/slide-edit';
import { resizePresentation } from '../../../shared/slide-size';
import { Button, IconButton } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, NumberInput, Select } from '../ui/Field';
import { Checkbox } from '../ui/Toggle';
import { ImagePlus, Layers, LayoutTemplate, Trash2 } from '../ui/icons';
import { commit, currentLook, noteMade, showSlide, useEditor } from './editor-store';
import { applyLayout, ensureMaster } from './design-ops';
import { changeSlide, findSlide } from './ops';
import { finishTextEditing } from './TextBoxEditor';
import { MediaPicker } from './MediaPicker';
import { Cluster, Divider } from './RibbonParts';

const GRADIENT: Extract<SlideBackdrop, { kind: 'gradient' }> = {
  kind: 'gradient',
  from: '#172554',
  to: '#4c1d95',
  angle: 90,
};

export function DesignTools() {
  const doc = useEditor((s) => s.doc);
  const slideId = useEditor((s) => s.slideId);
  const slide = doc ? findSlide(doc, slideId) : undefined;
  const [picking, setPicking] = useState<{ presentationId: string; slideId: string } | null>(null);
  const [sizing, setSizing] = useState(false);
  const backdrop = slide?.design?.backdrop;
  const master = doc?.master;
  const isMaster = master?.id === slideId;
  const locked = !slide || Boolean(slide.deck);
  const cue = slide?.cues.some((c) => c.kind === 'background');
  const kind = backdrop?.kind ?? (cue ? 'cue' : slide?.background != null ? 'solid' : 'none');
  const background = (value: SlideBackdrop | null, color: string | null = null) => {
    finishTextEditing();
    const s = useEditor.getState();
    const at = s.doc ? findSlide(s.doc, s.slideId) : undefined;
    if (!s.doc || !at || at.deck) return;
    const { backdrop: _old, ...design } = at.design ?? {};
    commit(
      changeSlide(s.doc, at.id, {
        background: color,
        design: { ...design, ...(value ? { backdrop: value } : {}) },
        cues: at.cues.filter((c) => c.kind !== 'background'),
      }),
    );
  };
  const gradient = (patch: Partial<typeof GRADIENT>) => {
    const s = useEditor.getState();
    const old = s.doc ? findSlide(s.doc, s.slideId)?.design?.backdrop : undefined;
    background({ ...(old?.kind === 'gradient' ? old : GRADIENT), ...patch });
  };
  return (
    <>
      <Divider />
      <Cluster name="Background design">
        <div className="flex flex-col gap-1">
          <Select
            aria-label="Background design"
            data-testid="design-background-kind"
            className="h-7 w-36"
            value={kind}
            disabled={locked}
            onChange={(e) => {
              const choice = e.target.value;
              if (choice === 'picture') {
                finishTextEditing();
                const s = useEditor.getState();
                if (s.doc && s.slideId)
                  setPicking({ presentationId: s.doc.presentationId, slideId: s.slideId });
              } else if (choice === 'gradient') background(GRADIENT);
              else if (choice === 'solid') background(null, slide?.background ?? '#000000');
              else if (choice === 'none') background(null);
            }}
          >
            <option value="none">Transparent / master</option>
            <option value="solid">Colour</option>
            <option value="gradient">Gradient</option>
            <option value="picture">Picture</option>
            {cue && <option value="cue">Existing background</option>}
          </Select>
          {backdrop?.kind === 'gradient' && (
            <div className="flex items-center gap-1">
              <input
                type="color"
                aria-label="Gradient first colour"
                data-testid="design-gradient-from"
                value={cutText(backdrop.from, 7)}
                onChange={(e) => gradient({ from: e.target.value })}
                className="h-7 w-7 rounded border border-field bg-panel"
              />
              <input
                type="color"
                aria-label="Gradient last colour"
                data-testid="design-gradient-to"
                value={cutText(backdrop.to, 7)}
                onChange={(e) => gradient({ to: e.target.value })}
                className="h-7 w-7 rounded border border-field bg-panel"
              />
              <NumberInput
                aria-label="Gradient angle"
                data-testid="design-gradient-angle"
                className="h-7 w-16"
                min={0}
                max={360}
                value={backdrop.angle}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) gradient({ angle: Math.max(0, Math.min(360, n)) });
                }}
              />
            </div>
          )}
          {backdrop?.kind === 'picture' && (
            <div className="flex items-center gap-1">
              <IconButton
                size="sm"
                icon={ImagePlus}
                label="Choose another background picture"
                onClick={() => {
                  if (doc && slide) setPicking({ presentationId: doc.presentationId, slideId: slide.id });
                }}
              />
              <Select
                aria-label="Fit the background picture"
                className="h-7 w-28"
                value={backdrop.fit}
                onChange={(e) => {
                  const fit = e.target.value;
                  if (fit === 'fit' || fit === 'fill' || fit === 'stretch') background({ ...backdrop, fit });
                }}
              >
                <option value="fill">Fill the slide</option>
                <option value="fit">Whole picture</option>
                <option value="stretch">Stretch</option>
              </Select>
            </div>
          )}
        </div>
      </Cluster>
      <Divider />
      <Cluster name="Size and layout">
        <div className="flex flex-col gap-1">
          <Button
            size="sm"
            variant="ghost"
            icon={LayoutTemplate}
            data-testid="design-size"
            disabled={!doc || doc.groups.some((g) => g.slides.some((s) => s.deck))}
            onClick={() => {
              finishTextEditing();
              setSizing(true);
            }}
          >
            Slide size…
          </Button>
          <Select
            aria-label="Place the words"
            data-testid="design-layout"
            className="h-7 w-36"
            disabled={locked}
            value={slide?.design?.layout ?? ''}
            onChange={(e) => {
              const layout = e.target.value;
              if (layout !== 'words' && layout !== 'heading-words' && layout !== 'two-columns') return;
              finishTextEditing();
              const s = useEditor.getState();
              const look = currentLook();
              if (!s.doc || !s.slideId || !look) return;
              const before = new Set(findSlide(s.doc, s.slideId)?.elements.map((el) => el.id));
              const next = applyLayout(s.doc, s.slideId, layout, look);
              for (const el of findSlide(next, s.slideId)?.elements ?? [])
                if (!before.has(el.id)) noteMade(el.id);
              commit(next);
            }}
          >
            <option value="">Keep placements</option>
            <option value="words">Words</option>
            <option value="heading-words">Heading and words</option>
            <option value="two-columns">Two columns</option>
          </Select>
        </div>
      </Cluster>
      <Divider />
      <Cluster name="Shared master">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              icon={Layers}
              data-testid="design-master"
              disabled={!doc || isMaster}
              onClick={() => {
                finishTextEditing();
                const s = useEditor.getState();
                if (!s.doc) return;
                const next = ensureMaster(s.doc);
                commit(next);
                useEditor.setState({ masterReturnId: s.slideId });
                if (next.master) showSlide(next.master.id);
              }}
            >
              Edit master
            </Button>
            <IconButton
              size="sm"
              icon={Trash2}
              label="Remove the master"
              disabled={!master}
              onClick={() => {
                finishTextEditing();
                const s = useEditor.getState();
                if (!s.doc) return;
                const first = s.doc.groups.flatMap((g) => g.slides)[0]?.id;
                commit({ ...s.doc, master: null });
                if (isMaster && first) showSlide(first);
              }}
            />
          </div>
          {master && !isMaster && (
            <Checkbox
              label="Use master"
              checked={!slide?.design?.skipMaster}
              disabled={locked}
              onChange={(e) => {
                finishTextEditing();
                const s = useEditor.getState();
                const at = s.doc ? findSlide(s.doc, s.slideId) : undefined;
                if (s.doc && at)
                  commit(
                    changeSlide(s.doc, at.id, { design: { ...at.design, skipMaster: !e.target.checked } }),
                  );
              }}
            />
          )}
          {master && !isMaster && (
            <Button
              size="sm"
              variant="ghost"
              data-testid="design-follow-master"
              disabled={locked}
              onClick={() => background(null)}
            >
              Use master background
            </Button>
          )}
        </div>
      </Cluster>
      {picking && (
        <MediaPicker
          title="Choose this slide’s background picture"
          picturesOnly
          onClose={() => setPicking(null)}
          onChoose={(media) => {
            if (media.kind !== 'image') return;
            const s = useEditor.getState();
            const at = s.doc ? findSlide(s.doc, picking.slideId) : undefined;
            if (s.doc?.presentationId === picking.presentationId && at) {
              commit(
                changeSlide(s.doc, at.id, {
                  background: null,
                  design: { ...at.design, backdrop: { kind: 'picture', mediaId: media.id, fit: 'fill' } },
                  cues: at.cues.filter((c) => c.kind !== 'background'),
                }),
              );
            }
            setPicking(null);
          }}
        />
      )}
      {sizing && doc && <SizeDialog onClose={() => setSizing(false)} />}
    </>
  );
}

function SizeDialog({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc);
  const [size, setSize] = useState({ width: doc?.width ?? 1920, height: doc?.height ?? 1080 });
  const [preset, setPreset] = useState('custom');
  const [fit, setFit] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const valid = [size.width, size.height].every((n) => Number.isInteger(n) && n >= 16 && n <= 16384);
  const keep = () => {
    finishTextEditing();
    const s = useEditor.getState();
    if (!s.doc || !valid) return;
    const next = resizePresentation(s.doc, size, fit);
    if (!editDocSchema.safeParse(next).success) {
      setProblem(
        'That size puts some text or an effect past its size limit. Choose another size, or keep the content at its pixel size.',
      );
      return;
    }
    commit(next);
    onClose();
  };
  return (
    <Dialog
      title="Slide size for this presentation"
      size="sm"
      testId="slide-size-dialog"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={keep} disabled={!valid}>
            Keep size
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Size">
          <Select
            data-testid="slide-size-preset"
            value={preset}
            onChange={(e) => {
              const value = e.target.value;
              setPreset(value);
              if (value === 'wide') setSize({ width: 1920, height: 1080 });
              if (value === 'standard') setSize({ width: 1440, height: 1080 });
            }}
          >
            <option value="custom">Custom</option>
            <option value="wide">Wide, 16:9</option>
            <option value="standard">Standard, 4:3</option>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {(['width', 'height'] as const).map((key) => (
            <Field key={key} label={key === 'width' ? 'Width (px)' : 'Height (px)'}>
              <NumberInput
                min={16}
                max={16384}
                value={size[key]}
                onChange={(e) => {
                  setPreset('custom');
                  setSize({ ...size, [key]: Number(e.target.value) });
                }}
              />
            </Field>
          ))}
        </div>
        <Checkbox
          label="Fit and centre the existing content"
          checked={fit}
          onChange={(e) => setFit(e.target.checked)}
        />
        <p className="text-sm text-muted">
          One size for every slide and the master. With fit off, the elements keep their pixel positions and
          sizes.
        </p>
        {problem && (
          <p role="alert" className="text-sm text-warning-fg">
            {problem}
          </p>
        )}
      </div>
    </Dialog>
  );
}
