import type { ComponentProps } from 'react';
import { AudienceBox } from './AudienceBox';
import { StageInputBox } from './StageInputBox';
import { StageLayoutCanvas } from './StageLayoutCanvas';

/** Live picture adapters stay outside the reusable stage text/layout drawing. */
export function StageLayoutView(
  props: Omit<ComponentProps<typeof StageLayoutCanvas>, 'audience' | 'videoInput'>,
) {
  return (
    <StageLayoutCanvas
      {...props}
      audience={<AudienceBox state={props.state} hall={props.hall} />}
      videoInput={<StageInputBox input={props.state.stage?.input} />}
    />
  );
}
