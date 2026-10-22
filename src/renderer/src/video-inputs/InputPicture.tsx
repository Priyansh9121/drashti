import { KeptVideo } from '../render/KeptVideo';
import { type InputCapture, useInputCapture } from '../render/video-input';
import { cx } from '../ui/cx';
import { mayOpenInputs } from './words';
import { useVideoInputs } from './video-inputs-store';

/*
 * A small live picture of one of this computer's inputs (Session 50), in Add a Video Input… and Media's Video
 * inputs: 16:9, black around it. It shares the input's one capture on this page with LIVE, and opens nothing
 * before Drashti may use the cameras (on a Mac, never before macOS was asked, after Drashti said why).
 */

/**
 * One of this computer's inputs, by its name, for a small picture: its capture, or null while it may not open
 * (or for no input).
 */
export function useSmallPicture(device: string | null): InputCapture | null {
  const may = useVideoInputs((s) => mayOpenInputs(s.access));
  const capture = useInputCapture(may ? device : null);
  return may && device !== null ? capture : null;
}

export function InputPicture({ capture, className }: { capture: InputCapture | null; className?: string }) {
  return (
    <span
      className={cx('relative block aspect-video overflow-hidden rounded-md bg-black', className)}
      data-a11y-picture
      data-input-state={capture?.state ?? 'closed'}
      aria-hidden="true"
    >
      {capture && capture.state !== 'absent' && (
        <KeptVideo stream={capture.stream} live={capture.state === 'live'} fit="contain" keep={false} />
      )}
    </span>
  );
}
