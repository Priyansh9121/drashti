import { useEngine } from '../engine/engine-store';
import { dispatch } from '../operator/actions';
import { Button } from '../ui/Button';
import { Settings } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { useVideoInputs } from './video-inputs-store';
import { settingsLabel, stoppedInput, stoppedWords } from './words';

/*
 * The video input on the screens stopped (Session 50: unplugged, or taken by another app): the screens keep its
 * last picture, never black without a word, and this says so in the window's flow, under the header, in Pro Mode
 * and Simple Mode alike, with Clear the input as its one primary (and where to turn the camera on, when it was
 * refused). It goes by itself when the input comes back, or once it is off the screens.
 */

export function VideoInputNotice({ platform }: { platform: string }) {
  const status = useVideoInputs((s) => s.status);
  const upId = useEngine((s) =>
    s.state?.layers.background?.kind === 'input' ? s.state.layers.background.inputId : null,
  );
  const stopped = stoppedInput(status, upId);
  if (!stopped) return null;
  const refused = status.access === 'denied' || status.access === 'restricted';
  return (
    <div className="shrink-0 px-3 pt-2" data-testid="video-input-stopped">
      <Notice
        tone="warning"
        title={`The video input “${stopped.name}” has stopped`}
        actions={
          <>
            <Button
              variant="primary"
              size="sm"
              data-testid="video-input-clear"
              onClick={() => void dispatch({ type: 'clearLayer', layer: 'background' })}
            >
              Clear the input
            </Button>
            {refused && (
              <Button
                size="sm"
                icon={Settings}
                onClick={() => void window.drashti.videoInputs.openSettings()}
              >
                {settingsLabel(platform)}
              </Button>
            )}
          </>
        }
      >
        {stoppedWords(status.access, platform)}
      </Notice>
    </div>
  );
}
