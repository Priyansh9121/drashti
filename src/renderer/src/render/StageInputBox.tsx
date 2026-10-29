import { memo, useRef } from 'react';
import type { StageInput } from '../../../shared/stage-layouts';
import { PictureBoxLine } from './AudienceBox';
import { KeptVideo } from './KeptVideo';
import { useLiveHere } from './live-here';
import { OBJECT_FIT } from './media-style';
import { useElementSize } from './useElementSize';
import { useVideoInput } from './video-input';

/*
 * A stage layout's video input box (Session 55): the chosen video input, live (at the mandir the video mixer's
 * programme output), whatever the audience screens show. On this computer it is opened as every picture of an input
 * is (render/video-input.ts): once per page, shared by every picture of it there (the audience picture box's
 * background too), and in the same format by every page, so Chromium captures the device once for them all (the
 * hall's screens, the stage screens, LIVE and the stream's page) and each draws the frames as they come: never a
 * second capture of the device, and no frame waits for another page. A node's screen and a tablet cannot draw it (it
 * is on Drashti's computer): they name it, as the audience picture box names what it cannot draw. With no video input
 * on this computer, the box says so. Fitted inside with black around it, or filling the box, as Media has the input.
 */

/** What the box says with no video input on this computer. */
export const NO_STAGE_INPUT = 'No video input on this computer';

/** What the box says where it cannot be drawn (a node's screen, a tablet), in the phone remote's words. */
export const stageInputNamed = (name: string): string => `Video input: ${name}`;

export const StageInputBox = memo(function StageInputBox({ input }: { input: StageInput | undefined }) {
  const area = useRef<HTMLDivElement>(null);
  const size = useElementSize(area);
  const live = useLiveHere();
  const sized = size.width > 0 && size.height > 0;
  return (
    <div
      ref={area}
      data-testid="stage-video-input"
      data-input-id={input?.inputId ?? ''}
      style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', background: '#000000' }}
    >
      {input && live && <LiveInput input={input} />}
      {sized && (!input || !live) && (
        <PictureBoxLine
          box={size}
          words={input ? stageInputNamed(input.name) : NO_STAGE_INPUT}
          testId="stage-video-input-line"
        />
      )}
    </div>
  );
});

function LiveInput({ input }: { input: StageInput }) {
  const capture = useVideoInput(input);
  return (
    <div
      data-stage-input={input.inputId}
      data-input-state={capture.state}
      style={{ position: 'absolute', inset: 0 }}
    >
      {capture.state !== 'absent' && (
        <KeptVideo stream={capture.stream} live={capture.state === 'live'} fit={OBJECT_FIT[input.fit]} />
      )}
    </div>
  );
}
