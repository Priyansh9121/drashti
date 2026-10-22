import { dispatch } from '../operator/actions';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { useLiveWindowUi } from './live-window-store';

/*
 * Another app's window up as the background was closed or hidden (Session 48): the screens keep its last
 * picture, never black without a word, and this says so in the window's flow, under the header, in Pro Mode
 * and Simple Mode alike, with Clear the window as its one primary. It goes when the window is open again,
 * or once it is off the screens.
 */

export function LiveWindowNotice() {
  const status = useLiveWindowUi((s) => s.status);
  if (status.state !== 'gone' || status.name === null) return null;
  return (
    <div className="shrink-0 px-3 pt-2" data-testid="live-window-gone">
      <Notice
        tone="warning"
        title={`The window “${status.name}” is closed or hidden`}
        actions={
          <Button
            variant="primary"
            size="sm"
            data-testid="live-window-clear"
            onClick={() => void dispatch({ type: 'clearLayer', layer: 'background' })}
          >
            Clear the window
          </Button>
        }
      >
        The screens keep its last picture. Open it again (not minimised) to show it live, or clear it.
      </Notice>
    </div>
  );
}
