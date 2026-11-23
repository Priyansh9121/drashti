import { useState, type ReactNode } from 'react';
import { initialEngineState } from '../../../shared/engine/state';
import { STAGE_HEIGHT, STAGE_WIDTH, stageShows } from '../../../shared/stage-layouts';
import type { ScreenGroupConfig } from '../../../shared/screens';
import type { EditDoc, EditSlide } from '../../../shared/slide-edit';
import { slidesOf } from '../../../shared/slide-edit';
import { renderEditedSlide } from '../../../shared/slide-design';
import { checkedTranslationView } from '../../../shared/prepared-translation-view';
import { preparedOutputState } from '../../../shared/prepared-output-state';
import { translationProblems } from '../../../shared/prepared-translation-status';
import { languageView } from '../../../shared/language-view';
import { programPicture } from '../../../shared/program';
import { useEngine } from '../engine/engine-store';
import { MovingLowerThird } from '../render/LowerThird';
import { StageView } from '../render/StageView';
import { StageLayoutCanvas } from '../render/StageLayoutCanvas';
import { SlideView } from '../render/SlideView';
import { PlacedInParent } from '../render/Placed';
import { Field, Select } from '../ui/Field';

/** Reuses output text drawing; captures and show commands are not part of a words preview. */
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
    ...(group?.role === 'stage' ? {} : { canvas, scaling: screen?.scaling ?? ('fit' as const) }),
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
  const projected = preparedOutputState(state, where);
  const drawing = (
    <SlideView
      slide={languageView(checkedTranslationView(rendered, where), group?.languages ?? null)}
      media="still"
    />
  );
  let picture: ReactNode = (
    <PlacedInParent content={rendered} mode={screen?.scaling ?? 'fit'} className="absolute inset-0">
      {drawing}
    </PlacedInParent>
  );
  if (group?.role === 'stream') {
    const program = programPicture(projected, streamLayout, group.languages ?? null);
    if (program.kind === 'camera' && program.lowerThird.length)
      picture = (
        <MovingLowerThird
          lines={program.lowerThird}
          shownKey={rendered.id}
          shownAt={0}
          leaving={null}
          canvas={canvas}
          movement="calm"
        />
      );
  } else if (group?.role === 'stage') {
    const hallGroup = groups.find((value) => value.role === 'audience');
    const hallScreen = hallGroup?.screens[0];
    const hall = hallGroup
      ? {
          groupId: hallGroup.id,
          canvasWidth: hallScreen?.canvasWidth ?? 1920,
          canvasHeight: hallScreen?.canvasHeight ?? 1080,
          scaling: hallScreen?.scaling ?? ('fit' as const),
        }
      : null;
    const audience = (
      <SlideView
        slide={checkedTranslationView(
          rendered,
          hallGroup ? { groupId: hallGroup.id, outputId: hallScreen?.id } : {},
        )}
        media="still"
      />
    );
    const layout = stageShows(state.stage) === 'layout' ? state.stage?.layout : null;
    picture =
      stageShows(state.stage) === 'audience' ? (
        audience
      ) : layout ? (
        <PlacedInParent
          content={{ width: STAGE_WIDTH, height: STAGE_HEIGHT }}
          mode="fit"
          className="absolute inset-0"
        >
          <StageLayoutCanvas
            layout={layout}
            state={projected}
            languages={group.languages ?? null}
            hall={hall}
            audience={audience}
            videoInput={<p className="text-center text-white">Video input picture</p>}
          />
        </PlacedInParent>
      ) : (
        <StageView state={projected} languages={group.languages ?? null} />
      );
  }
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
          {picture}
        </PlacedInParent>
      </div>
    </div>
  );
}
