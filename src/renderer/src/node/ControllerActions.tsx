import { useRef, useState } from 'react';
import type { EngineCommand } from '../../../shared/engine/commands';
import type { EngineState } from '../../../shared/engine/state';
import type { NodeView } from '../../../shared/nodes';
import { playingNow } from '../../../shared/engine/playing';
import { useEngine } from '../engine/engine-store';
import { Button } from '../ui/Button';

type SharedView = NonNullable<NodeView['controller']>;

/** An explicit press, never an optimistic show change, retry or reconnect queue. */
export function ControllerActions({ view, state }: { view: SharedView; state: EngineState }) {
  const rev = useEngine((s) => s.rev);
  const session = useEngine((s) => s.session);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [answer, setAnswer] = useState('');
  const show = view.areas?.includes('show') ?? false;
  const media = view.areas?.includes('media') ?? false;
  if (!show && !media) return null;
  const disabled = busy || !view.connected || !session || Boolean(state.stopped);
  const send = (command: EngineCommand): void => {
    if (disabled || pending.current || !session) return;
    pending.current = true;
    setBusy(true);
    setAnswer('Waiting for Main…');
    void window.drashti.node
      .action({ id: crypto.randomUUID(), session, rev, command })
      .then(
        (reply) => {
          setAnswer(reply.message);
        },
        () => {
          setAnswer('Main has not answered. Check LIVE before pressing again.');
        },
      )
      .finally(() => {
        pending.current = false;
        setBusy(false);
      });
  };
  return (
    <div className="space-y-2 border-t border-line pt-2" data-testid="controller-actions">
      {show && (
        <div className="flex flex-wrap gap-2" aria-label="Show controls">
          <Button
            size="sm"
            instant
            variant="primary"
            disabled={disabled || !state.next}
            onClick={() => {
              send({ type: 'next' });
            }}
          >
            Next
          </Button>
          <Button
            size="sm"
            instant
            variant="secondary"
            disabled={disabled}
            onClick={() => {
              send({ type: 'back' });
            }}
          >
            Back
          </Button>
          <Button
            size="sm"
            instant
            variant="secondary"
            disabled={disabled}
            onClick={() => {
              send({ type: 'previousItem' });
            }}
          >
            Previous item
          </Button>
          <Button
            size="sm"
            instant
            variant="secondary"
            disabled={disabled}
            onClick={() => {
              send({ type: 'nextItem' });
            }}
          >
            Next item
          </Button>
          <Button
            size="sm"
            instant
            variant={state.blackout ? 'live' : 'secondary'}
            disabled={disabled}
            aria-pressed={state.blackout}
            onClick={() => {
              send({ type: 'toggleBlackout' });
            }}
          >
            Black-out
          </Button>
          <Button
            size="sm"
            instant
            variant={state.wallpaper ? 'live' : 'secondary'}
            disabled={disabled}
            aria-pressed={state.wallpaper}
            onClick={() => {
              send({ type: 'toggleWallpaper' });
            }}
          >
            Wallpaper
          </Button>
          <Button
            size="sm"
            instant
            variant="secondary"
            disabled={disabled}
            onClick={() => {
              send({ type: 'clearAll' });
            }}
          >
            Clear all
          </Button>
          <Button
            size="sm"
            instant
            variant="secondary"
            disabled={disabled}
            onClick={() => {
              send({ type: 'putBack' });
            }}
          >
            Put it back
          </Button>
        </div>
      )}
      {media && (
        <div className="space-y-2" aria-label="Media playback">
          {playingNow(state).map((playing) => {
            const layer = playing.ref.layer;
            const name =
              layer === 'background'
                ? 'video'
                : layer === 'audio'
                  ? 'sound'
                  : layer === 'pip'
                    ? 'box video'
                    : 'slide media';
            const key = layer === 'slide' ? `${layer}-${playing.mediaId}` : layer;
            return (
              <div key={key} className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold capitalize">{name}</span>
                <Button
                  size="sm"
                  instant
                  variant="secondary"
                  disabled={disabled}
                  data-testid={`controller-${playing.paused ? 'resume' : 'pause'}-${key}`}
                  onClick={() => {
                    send({ type: playing.paused ? 'resumePlaying' : 'pausePlaying', playing: playing.ref });
                  }}
                >
                  {playing.paused ? `Play ${name}` : `Pause ${name}`}
                </Button>
                {(layer === 'background' || layer === 'audio') && (
                  <>
                    <Button
                      size="sm"
                      instant
                      variant="secondary"
                      disabled={disabled}
                      aria-label={`Back 15 s · ${name}`}
                      onClick={() => {
                        send({ type: 'skip', layer, jump: 'back' });
                      }}
                    >
                      Back 15 s
                    </Button>
                    <Button
                      size="sm"
                      instant
                      variant="secondary"
                      disabled={disabled}
                      aria-label={`Forward 15 s · ${name}`}
                      onClick={() => {
                        send({ type: 'skip', layer, jump: 'forward' });
                      }}
                    >
                      Forward 15 s
                    </Button>
                    <Button
                      size="sm"
                      instant
                      variant="secondary"
                      disabled={disabled}
                      onClick={() => {
                        send({ type: 'clearLayer', layer });
                      }}
                    >
                      Take {name} off
                    </Button>
                  </>
                )}
              </div>
            );
          })}
          {playingNow(state).length === 0 && (
            <p className="text-xs text-muted">No video or sound is playing on Main.</p>
          )}
        </div>
      )}
      <p className="text-xs text-muted">
        Main checks each press. If the show moved, check LIVE and press again.
      </p>
      <p role="status" aria-live="polite" className="text-sm" data-testid="controller-action-result">
        {answer}
      </p>
    </div>
  );
}
