import { useState } from 'react';
import { initialEngineState } from '../../../shared/engine/state';
import { DEFAULT_LIVE_GROUP_LOOK } from '../../../shared/looks';
import type { ScreenGroupConfig } from '../../../shared/screens';
import type { EditDoc, EditSlide } from '../../../shared/slide-edit';
import { slidesOf } from '../../../shared/slide-edit';
import { renderEditedSlide } from '../../../shared/slide-design';
import { checkedTranslationView } from '../../../shared/prepared-translation-view';
import { translationProblems } from '../../../shared/prepared-translation-status';
import { useEngine } from '../engine/engine-store';
import { ProgramView } from '../program/ProgramView';
import { StageScreen } from '../render/StageScreen';
import { SlideView } from '../render/SlideView';
import { PlacedInParent } from '../render/Placed';
import { Field, Select } from '../ui/Field';

/** Uses the same checked projection and output renderers without dispatching a show command. */
export function TranslationPreview({
  doc,
  slide,
  groups,
}: {
  doc: EditDoc;
  slide: EditSlide;
  groups: ScreenGroupConfig[];
}) {
  const [destination, setDestination] = useState('presentation');
  const [streamLayout, setStreamLayout] = useState<'slides' | 'camera'>('slides');
  const stage = useEngine((value) => value.state?.stage);
  const timers = useEngine((value) => value.state?.timers);
  const group = groups.find(
    (value) =>
      destination === `group:${value.id}` ||
      value.screens.some((screen) => destination === `screen:${screen.id}`),
  );
  const screen = group?.screens.find((value) => destination === `screen:${value.id}`);
  const rendered = renderEditedSlide(doc, slide);
  const canvas = screen
    ? { width: screen.canvasWidth, height: screen.canvasHeight }
    : group?.role === 'stage' || group?.role === 'stream'
      ? { width: 1920, height: 1080 }
      : rendered;
  const where = {
    ...(group ? { groupId: group.id } : {}),
    ...(screen ? { outputId: screen.id } : {}),
    canvas,
    scaling: screen?.scaling ?? ('fit' as const),
  };
  const problems = translationProblems(rendered, where);
  const state = initialEngineState();
  state.layers = {
    ...state.layers,
    slide: {
      presentationId: doc.presentationId,
      slideIndex: 0,
      slide: rendered,
      notes: slide.notes,
      shownAt: 0,
    },
  };
  state.timers = timers ?? [];
  if (stage) state.stage = stage;
  const ordered = slidesOf(doc);
  const next = ordered[ordered.findIndex((value) => value.id === slide.id) + 1];
  if (next)
    state.next = {
      kind: 'slide',
      presentationId: doc.presentationId,
      slideIndex: 1,
      slide: renderEditedSlide(doc, next),
      background: null,
      itemId: null,
      notes: next.notes,
    };
  return (
    <div className="space-y-2">
      <Field label="Preview destination">
        <Select value={destination} onChange={(event) => setDestination(event.target.value)}>
          <option value="presentation">Presentation choice</option>
          {groups.map((value) => (
            <optgroup key={value.id} label={value.name}>
              <option value={`group:${value.id}`}>{value.name} · group choice</option>
              {value.screens.map((output) => (
                <option key={output.id} value={`screen:${output.id}`}>
                  {output.name}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </Field>
      {group?.role === 'stream' && (
        <Field label="Preview stream layout">
          <Select
            value={streamLayout}
            onChange={(event) => setStreamLayout(event.target.value === 'camera' ? 'camera' : 'slides')}
          >
            <option value="slides">Slides</option>
            <option value="camera">Camera and words</option>
          </Select>
        </Field>
      )}
      <p className="text-sm text-muted">
        Saved checked words only. Missing, unchecked or held translations stay hidden.
      </p>
      {problems.map((problem) => (
        <p key={problem} role="status" className="text-sm text-muted">
          {problem}
        </p>
      ))}
      <div
        className="relative overflow-hidden rounded bg-black"
        style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }}
        data-testid="translation-preview"
        data-a11y-picture
        aria-hidden="true"
      >
        <PlacedInParent content={canvas} mode="fit" className="absolute inset-0">
          {group?.role === 'stage' ? (
            <StageScreen
              state={state}
              canvas={canvas}
              look={DEFAULT_LIVE_GROUP_LOOK}
              translationGroupId={group.id}
              translationOutputId={screen?.id}
            />
          ) : group?.role === 'stream' ? (
            <ProgramView
              state={state}
              canvas={canvas}
              layout={streamLayout}
              languages={null}
              camera={null}
              translationGroupId={group.id}
            />
          ) : (
            <PlacedInParent content={rendered} mode={where.scaling} className="absolute inset-0">
              <SlideView slide={checkedTranslationView(rendered, where)} media="still" />
            </PlacedInParent>
          )}
        </PlacedInParent>
      </div>
    </div>
  );
}
