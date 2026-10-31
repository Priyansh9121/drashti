import { useState } from 'react';
import type { EditorGuides } from '../../../shared/editor-guides';
import { Button, IconButton } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, NumberInput } from '../ui/Field';
import { Checkbox } from '../ui/Toggle';
import { FlipHorizontal2, FlipVertical2, Group, RotateCcw, RotateCw, Trash2, Ungroup } from '../ui/icons';
import { commit, useEditor } from './editor-store';
import { changeSlide, findSlide, rotateElements } from './ops';
import { boundsOf, centerOf, unionOf } from './geometry';
import { flipElements, groupElements, ungroupElements } from './arrange-ops';
import { Cluster, Divider } from './RibbonParts';
import { finishTextEditing } from './TextBoxEditor';

export function ArrangeTools() {
  const doc = useEditor((s) => s.doc);
  const slideId = useEditor((s) => s.slideId);
  const selection = useEditor((s) => s.selection);
  const aids = useEditor((s) => s.aids);
  const [guidesOpen, setGuidesOpen] = useState(false);
  const slide = doc ? findSlide(doc, slideId) : undefined;
  const selected = slide?.elements.filter((el) => selection.includes(el.id)) ?? [];
  const none = selected.length === 0;
  const edit = (what: 'group' | 'ungroup' | 'left' | 'right' | 'x' | 'y') => {
    finishTextEditing();
    const s = useEditor.getState();
    if (!s.doc || !s.slideId) return;
    if (what === 'group') commit(groupElements(s.doc, s.slideId, selection));
    else if (what === 'ungroup') commit(ungroupElements(s.doc, s.slideId, selection));
    else if (what === 'x' || what === 'y') commit(flipElements(s.doc, s.slideId, selection, what));
    else {
      const box = unionOf(selected.map(boundsOf));
      if (box) commit(rotateElements(s.doc, s.slideId, selection, centerOf(box), what === 'left' ? -90 : 90));
    }
  };
  const aid = (key: keyof typeof aids, checked: boolean) => {
    finishTextEditing();
    useEditor.setState({ aids: { ...useEditor.getState().aids, [key]: checked } });
    const s = useEditor.getState();
    const current = s.doc ? findSlide(s.doc, s.slideId) : undefined;
    if (key === 'guides' && checked && s.doc && current && !current.guides)
      commit(changeSlide(s.doc, current.id, { guides: { x: [s.doc.width / 2], y: [s.doc.height / 2] } }));
  };
  return (
    <>
      <Divider />
      <Cluster name="Together">
        <IconButton
          size="sm"
          icon={Group}
          label="Group the selected elements"
          data-testid="arrange-group-elements"
          disabled={selected.length < 2}
          onClick={() => edit('group')}
        />
        <IconButton
          size="sm"
          icon={Ungroup}
          label="Ungroup"
          data-testid="arrange-ungroup"
          disabled={!selected.some((el) => el.groupId)}
          onClick={() => edit('ungroup')}
        />
      </Cluster>
      <Divider />
      <Cluster name="Turn and flip">
        <IconButton
          size="sm"
          icon={RotateCcw}
          label="Turn left 90°"
          data-testid="arrange-turn-left"
          disabled={none}
          onClick={() => edit('left')}
        />
        <IconButton
          size="sm"
          icon={RotateCw}
          label="Turn right 90°"
          data-testid="arrange-turn-right"
          disabled={none}
          onClick={() => edit('right')}
        />
        <IconButton
          size="sm"
          icon={FlipHorizontal2}
          label="Flip across"
          data-testid="arrange-flip-x"
          disabled={none}
          onClick={() => edit('x')}
        />
        <IconButton
          size="sm"
          icon={FlipVertical2}
          label="Flip down"
          data-testid="arrange-flip-y"
          disabled={none}
          onClick={() => edit('y')}
        />
      </Cluster>
      <Divider />
      <Cluster name="Help placing">
        {(['snap', 'guides', 'rulers', 'grid'] as const).map((key) => (
          <Checkbox
            key={key}
            label={{ snap: 'Snap', guides: 'Guides', rulers: 'Rulers', grid: '50 px grid' }[key]}
            data-testid={`arrange-${key}`}
            checked={aids[key]}
            onChange={(e) => aid(key, e.target.checked)}
          />
        ))}
        <Button
          size="sm"
          variant="ghost"
          disabled={!slide}
          onClick={() => {
            aid('guides', true);
            setGuidesOpen(true);
          }}
        >
          Place guides…
        </Button>
      </Cluster>
      {guidesOpen && <GuideDialog onClose={() => setGuidesOpen(false)} />}
    </>
  );
}

function GuideDialog({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc);
  const slideId = useEditor((s) => s.slideId);
  const slide = doc ? findSlide(doc, slideId) : undefined;
  const guides = slide?.guides ?? { x: [], y: [] };
  const set = (next: EditorGuides, coalesce?: string) => {
    const s = useEditor.getState();
    if (s.doc && slide) commit(changeSlide(s.doc, slide.id, { guides: next }), coalesce ? { coalesce } : {});
  };
  return (
    <Dialog
      title="Place guides"
      size="sm"
      testId="editor-guide-settings"
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <p className="mb-3 text-sm text-muted">
        Positions in slide pixels. Saved with this slide; never shown to the audience.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {(['x', 'y'] as const).map((axis) => (
          <section
            key={axis}
            className="space-y-2"
            aria-label={axis === 'x' ? 'Vertical guides' : 'Horizontal guides'}
          >
            <p className="text-sm font-bold">{axis === 'x' ? 'Across' : 'Down'}</p>
            {guides[axis].map((n, i) => (
              <Field key={i} label={`Guide ${i + 1}`}>
                <div className="flex items-center gap-1">
                  <NumberInput
                    aria-label={`${axis === 'x' ? 'Across' : 'Down'} guide ${i + 1}`}
                    min={0}
                    max={axis === 'x' ? doc?.width : doc?.height}
                    value={n}
                    onChange={(e) => {
                      const max = (axis === 'x' ? doc?.width : doc?.height) ?? 16384;
                      set(
                        {
                          ...guides,
                          [axis]: guides[axis].map((value, at) =>
                            at === i ? Math.max(0, Math.min(max, Number(e.target.value))) : value,
                          ),
                        },
                        `guide:${axis}:${i}`,
                      );
                    }}
                  />
                  <IconButton
                    icon={Trash2}
                    size="sm"
                    label={`Remove ${axis === 'x' ? 'vertical' : 'horizontal'} guide ${i + 1}`}
                    onClick={() => set({ ...guides, [axis]: guides[axis].filter((_, at) => at !== i) })}
                  />
                </div>
              </Field>
            ))}
            <Button
              size="sm"
              disabled={guides[axis].length >= 32}
              onClick={() =>
                set({
                  ...guides,
                  [axis]: [...guides[axis], ((axis === 'x' ? doc?.width : doc?.height) ?? 0) / 2],
                })
              }
            >
              Add {axis === 'x' ? 'vertical' : 'horizontal'}
            </Button>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
