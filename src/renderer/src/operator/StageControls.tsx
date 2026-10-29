import { useEffect, useState } from 'react';
import { useEngine } from '../engine/engine-store';
import { PlacedInParent } from '../render/Placed';
import { StageScreen } from '../render/StageScreen';
import { useFirstGroupLook } from '../screens/screens-store';
import { DEFAULT_LIVE_GROUP_LOOK } from '../../../shared/looks';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Field, Select, TextInput } from '../ui/Field';
import { LayoutTemplate, Tv } from '../ui/icons';
import { useHallPicture } from '../stage/hall-picture';
import {
  chooseStageLayout,
  connectStageLayouts,
  openStageLayouts,
  STANDARD,
  useStageLayouts,
} from '../stage/stage-layouts-store';
import { chooseInput, useChosenInput, useVideoInputs } from '../video-inputs/video-inputs-store';
import { Notice } from '../ui/Notice';
import { Panel } from '../ui/Panel';
import { Truncate } from '../ui/Truncate';
import { dispatch } from './actions';
import { StageTimerControls } from './StageTimerControls';
import { AudienceTimerControls } from './AudienceTimerControls';
import { Checkbox } from '../ui/Toggle';
import { STAGE_MESSAGE_SIZES, STAGE_SIZE_NAMES, type StageMessageSize } from '../../../shared/stage-message';

/** What the stage screens show the performers, small (also on the Stage screen's card in Screens). */
export function StagePreview({ className = 'w-3/5' }: { className?: string }) {
  const state = useEngine((s) => s.state);
  // As the first stage group shows it in the live Look: its layout and languages.
  const first = useFirstGroupLook('stage');
  // A layout's audience picture box: the hall's picture, as the stage screens are told it (Session 50).
  const hall = useHallPicture();
  return (
    <div
      className={`relative aspect-video overflow-hidden rounded-md border border-line-strong bg-black ${className}`}
      data-testid="stage-preview"
      data-a11y-picture
      aria-hidden="true"
    >
      {state && (
        <PlacedInParent content={{ width: 1920, height: 1080 }} mode="fit" className="absolute inset-0">
          <div className="relative h-[1080px] w-[1920px]">
            <StageScreen
              state={state}
              look={first?.look ?? DEFAULT_LIVE_GROUP_LOOK}
              canvas={{ width: 1920, height: 1080 }}
              hall={hall}
            />
          </div>
        </PlacedInParent>
      )}
    </div>
  );
}

/**
 * Edit layouts… (Session 26a): the stage layout editor, at the layout every stage screen shows now (Session 55), as
 * Screens' Edit stage layouts… opens it.
 */
function EditLayoutButton() {
  const chosen = useEngine((s) => s.state?.stage?.layout?.id ?? STANDARD);
  return (
    <Button
      size="sm"
      icon={LayoutTemplate}
      data-testid="stage-edit-layout"
      onClick={() => {
        openStageLayouts(chosen);
      }}
    >
      Edit layouts…
    </Button>
  );
}

/**
 * Layout (Session 55): the one stage layout every stage screen shows, chosen here at once, and kept over a restart;
 * Standard is the stage screen Drashti comes with. No longer chosen per Look.
 */
function LayoutPicker({ onProblem }: { onProblem: (problem: string | null) => void }) {
  const layouts = useStageLayouts((s) => s.layouts);
  const chosen = useEngine((s) => s.state?.stage?.layout ?? null);
  useEffect(() => {
    connectStageLayouts();
  }, []);
  // The chosen one is offered even before the list is read, so the field never shows another.
  const listed = layouts ?? (chosen ? [chosen] : []);
  return (
    <Field label="Layout" className="min-w-0 flex-1">
      <Select
        data-testid="stage-layout-choice"
        value={chosen?.id ?? STANDARD}
        onChange={(e) => {
          const id = e.target.value === STANDARD ? null : e.target.value;
          void chooseStageLayout(id).then(onProblem);
        }}
      >
        <option value={STANDARD}>Standard</option>
        {listed.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/**
 * Video input (Session 55): the one a stage layout's video input box shows and LIVE's one press puts up on the
 * audience. Offered only on a computer with video inputs in Media; the first is chosen until another is.
 */
function InputPicker({ onProblem }: { onProblem: (problem: string | null) => void }) {
  const inputs = useVideoInputs((s) => s.inputs);
  const chosen = useChosenInput();
  if (!inputs || inputs.length === 0 || !chosen) return null;
  return (
    <Field label="Video input" className="min-w-0 flex-1">
      <Select
        data-testid="stage-input-choice"
        value={chosen.id}
        onChange={(e) => {
          void chooseInput(e.target.value).then(onProblem);
        }}
      >
        {inputs.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

const NO_RECENT: string[] = [];

/**
 * The stage screen: what the performers see, and a message for them only (the audience never sees it). Since Session 55
 * (Part 15) the message as the old program had its own: its size, a flash as it comes up, Show on every stage screen
 * and Hide, and the last few a tap away; and a timer for the audience, started, shown and hidden here too.
 */
export function StageMessageControl() {
  const shown = useEngine((s) => s.state?.stageMessage ?? null);
  const recent = useEngine((s) => s.state?.stageRecent) ?? NO_RECENT;
  // Stage off (Session 55): every stage screen shows the audience picture, said here.
  const off = useEngine((s) => s.state?.stage?.off === true);
  const [text, setText] = useState('');
  const [size, setSize] = useState<StageMessageSize>('standard');
  const [flash, setFlash] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const show = (words: string) => {
    if (words.trim() !== '') void dispatch({ type: 'setStageMessage', text: words, size, flash });
  };
  return (
    <Panel
      help="stage"
      title="Stage screen"
      icon={Tv}
      collapsible
      remember="stage"
      bodyClassName="space-y-2 px-3 pb-3"
      data-testid="stage-message-control"
    >
      <div className="flex items-end gap-2">
        <StagePreview />
        <EditLayoutButton />
      </div>
      {off && (
        <p className="text-xs text-warning-fg" data-testid="stage-off-note">
          Stage is off: every stage screen shows the audience picture.
        </p>
      )}
      {/* One layout for every stage screen, and the video input (Session 55). */}
      <div className="flex flex-wrap items-end gap-2">
        <LayoutPicker onProblem={setProblem} />
        <InputPicker onProblem={setProblem} />
      </div>
      {problem && (
        <Notice tone="danger" compact>
          {problem}
        </Notice>
      )}
      {/* The stage layout's timers, with Start, Pause and Reset (Session 54). */}
      <StageTimerControls />
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          show(text);
        }}
      >
        <TextInput
          aria-label="Message for the stage"
          placeholder="Seen on stage screens only"
          value={text}
          maxLength={300}
          onChange={(e) => {
            setText(e.target.value);
          }}
          className="flex-1"
        />
        <Button type="submit" disabled={text.trim() === ''}>
          Show
        </Button>
      </form>
      {/* Its own size, and a flash as it comes up (Session 55). */}
      <div className="flex flex-wrap items-center gap-3">
        <Field label="Size" layout="inline">
          <Select
            aria-label="Size of the stage message"
            value={size}
            onChange={(e) => {
              setSize(e.target.value as StageMessageSize);
            }}
          >
            {STAGE_MESSAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {STAGE_SIZE_NAMES[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Checkbox
          label="Flash as it comes up"
          className="text-xs"
          checked={flash}
          onChange={(e) => {
            setFlash(e.target.checked);
          }}
        />
      </div>
      {shown !== null && (
        <div className="flex items-center gap-2 rounded-md border border-warning/60 bg-warning-bg px-2 py-1 text-sm text-warning-fg">
          <Badge tone="warning">On stage</Badge>
          <Truncate text={shown} className="flex-1" data-testid="stage-message-shown" />
          <Button variant="ghost" size="sm" onClick={() => void dispatch({ type: 'clearStageMessage' })}>
            Hide
          </Button>
        </div>
      )}
      {/* The last few, a tap away: one press shows it again on every stage screen (Session 55). */}
      {recent.length > 0 && (
        <div data-testid="stage-recent" className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-muted">Shown before:</span>
          {recent.map((r) => (
            <Button
              key={r}
              size="sm"
              variant={r === shown ? 'live' : 'ghost'}
              className="max-w-full"
              title={r}
              onClick={() => {
                show(r);
              }}
            >
              <span className="max-w-40 truncate">{r}</span>
            </Button>
          ))}
        </div>
      )}
      {/* A timer for the audience (Session 55, Part 15), under the stage message. */}
      <AudienceTimerControls />
    </Panel>
  );
}
