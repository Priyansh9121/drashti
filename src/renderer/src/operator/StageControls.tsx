import { useState } from 'react';
import { useEngine } from '../engine/engine-store';
import { PlacedInParent } from '../render/Placed';
import { StageScreen } from '../render/StageScreen';
import { useFirstGroupLook } from '../screens/screens-store';
import { DEFAULT_LIVE_GROUP_LOOK } from '../../../shared/looks';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { TextInput } from '../ui/Field';
import { Tv } from '../ui/icons';
import { Panel } from '../ui/Panel';
import { Truncate } from '../ui/Truncate';
import { dispatch } from './actions';

/** What the stage screens show the performers, small. */
function StagePreview() {
  const state = useEngine((s) => s.state);
  // As the first stage group shows it in the live Look: its layout and languages.
  const first = useFirstGroupLook('stage');
  return (
    <div
      className="relative aspect-video w-3/5 overflow-hidden rounded-md border border-line-strong bg-black"
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
            />
          </div>
        </PlacedInParent>
      )}
    </div>
  );
}

/** The stage screen: what the performers see, and a message for them only (the audience never sees it). */
export function StageMessageControl() {
  const shown = useEngine((s) => s.state?.stageMessage ?? null);
  const [text, setText] = useState('');
  return (
    <Panel
      title="Stage screen"
      icon={Tv}
      collapsible
      remember="stage"
      bodyClassName="space-y-2 px-3 pb-3"
      data-testid="stage-message-control"
    >
      <StagePreview />
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
