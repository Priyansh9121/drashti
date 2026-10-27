import { useState } from 'react';
import { useEngine } from '../engine/engine-store';
import { PlacedInParent } from '../render/Placed';
import { StageScreen } from '../render/StageScreen';
import { useFirstGroupLook } from '../screens/screens-store';
import { DEFAULT_LIVE_GROUP_LOOK } from '../../../shared/looks';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { TextInput } from '../ui/Field';
import { LayoutTemplate, Tv } from '../ui/icons';
import { useHallPicture } from '../stage/hall-picture';
import { openStageLayouts, STANDARD } from '../stage/stage-layouts-store';
import { Panel } from '../ui/Panel';
import { Truncate } from '../ui/Truncate';
import { dispatch } from './actions';
import { StageTimerControls } from './StageTimerControls';

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
 * Edit layout… (Session 26a): the stage layout editor, at the layout the stage screens use now (the
 * live Look's first stage group's), as Screens' Edit stage layouts… opens it. Saving a layout is an
 * admin's, as there.
 */
function EditLayoutButton() {
  const first = useFirstGroupLook('stage');
  return (
    <Button
      size="sm"
      icon={LayoutTemplate}
      data-testid="stage-edit-layout"
      onClick={() => {
        openStageLayouts(first?.look.stageLayout?.id ?? STANDARD);
      }}
    >
      Edit layout…
    </Button>
  );
}

/** The stage screen: what the performers see, and a message for them only (the audience never sees it). */
export function StageMessageControl() {
  const shown = useEngine((s) => s.state?.stageMessage ?? null);
  const [text, setText] = useState('');
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
      {/* The stage layout's timers, with Start, Pause and Reset (Session 54). */}
      <StageTimerControls />
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() !== '') void dispatch({ type: 'setStageMessage', text });
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
      {shown !== null && (
        <div className="flex items-center gap-2 rounded-md border border-warning/60 bg-warning-bg px-2 py-1 text-sm text-warning-fg">
          <Badge tone="warning">On stage</Badge>
          <Truncate text={shown} className="flex-1" data-testid="stage-message-shown" />
          <Button variant="ghost" size="sm" onClick={() => void dispatch({ type: 'clearStageMessage' })}>
            Clear
          </Button>
        </div>
      )}
    </Panel>
  );
}
