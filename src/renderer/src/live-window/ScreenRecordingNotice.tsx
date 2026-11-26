import { SCREEN_RECORDING_STEPS, screenRecordingAfterUpdate } from '../../../shared/live-window';
import { Button } from '../ui/Button';
import { RotateCw, Settings } from '../ui/icons';
import { Notice } from '../ui/Notice';

/*
 * The box that asks for macOS's Screen Recording (Session 48), as Show a Window… and Picture in Picture…'s window
 * choice show it: why, what to do, then Open System Settings and Look again. On a Mac it then says what to do when
 * Drashti is already on in the list after an update (QA24-SCREENREC-1: macOS ties the switch to the build that was
 * allowed); Windows and Linux never say it.
 */

export interface ScreenRecordingNoticeProps {
  /** Why Drashti asks (the main process's words, SCREEN_RECORDING_WHY). */
  message: string;
  /** The computer's platform (AppInfo's): 'darwin', 'win32' or 'linux'. */
  platform: string;
  testId: string;
  /** The Open System Settings button's test id, where a test presses it. */
  openTestId?: string;
  onOpen: () => void;
  onAgain: () => void;
}

export function ScreenRecordingNotice({
  message,
  platform,
  testId,
  openTestId,
  onOpen,
  onAgain,
}: ScreenRecordingNoticeProps) {
  const afterUpdate = screenRecordingAfterUpdate(platform);
  return (
    <Notice
      tone="info"
      title="Let Drashti see other apps’ windows"
      data-testid={testId}
      actions={
        <>
          <Button variant="primary" size="sm" icon={Settings} data-testid={openTestId} onClick={onOpen}>
            Open System Settings
          </Button>
          <Button size="sm" icon={RotateCw} onClick={onAgain}>
            Look again
          </Button>
        </>
      }
    >
      <p>
        {message} {SCREEN_RECORDING_STEPS}
      </p>
      {afterUpdate && (
        <p className="mt-1" data-testid="screen-recording-after-update">
          {afterUpdate}
        </p>
      )}
    </Notice>
  );
}
