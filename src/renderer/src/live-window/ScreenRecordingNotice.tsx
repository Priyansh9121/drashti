import { SCREEN_RECORDING_STEPS } from '../../../shared/live-window';
import { Button } from '../ui/Button';
import { RotateCw, Settings } from '../ui/icons';
import { Notice } from '../ui/Notice';

/*
 * The box that asks for macOS's Screen Recording (Session 48), as Show a Window… and Picture in Picture…'s window
 * choice show it: why, what to do, then Open System Settings and Look again.
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
  testId,
  openTestId,
  onOpen,
  onAgain,
}: ScreenRecordingNoticeProps) {
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
      {message} {SCREEN_RECORDING_STEPS}
    </Notice>
  );
}
