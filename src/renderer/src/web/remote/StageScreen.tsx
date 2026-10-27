import { useState } from 'react';
import { useEngine } from '../../engine/engine-store';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Eraser } from '../../ui/icons';
import { api } from '../device';
import { tap } from '../taps';
import { StageTimerList } from './StageTimers';

/*
 * The stage screen (Session 54, D5), as the operator window's Stage screen panel has it: a message for the
 * performers on the stage screens only (the audience never sees it), shown, said while it is up, and cleared.
 * Edit layout… stays in Drashti (stage layouts are the setup). A3's Start, Pause and Reset for the stage layout's
 * own timer go under the message, in this section.
 */

const post = (path: string, body?: unknown) => () => api<{ rev?: number }>(path, { method: 'POST', body });

export function StageScreen() {
  const shown = useEngine((s) => s.state?.stageMessage ?? null);
  const [text, setText] = useState('');
  return (
    <section className="space-y-2" aria-labelledby="stage-title" data-testid="remote-stage">
      <h2 id="stage-title" className="text-base font-bold tracking-wider text-muted uppercase">
        Stage screen
      </h2>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() !== '') void tap(post('/api/v1/stage-message', { text }));
        }}
      >
        <input
          aria-label="Message for the stage"
          placeholder="Seen on stage screens only"
          value={text}
          maxLength={300}
          enterKeyHint="send"
          onChange={(e) => {
            setText(e.target.value);
          }}
          className="h-12 min-w-0 flex-1 rounded-lg border border-field bg-panel-3 px-3 text-base text-fg"
          data-testid="remote-stage-text"
        />
        <Button type="submit" size="lg" className="min-h-12" disabled={text.trim() === ''}>
          Show
        </Button>
      </form>
      {shown !== null && (
        <div
          role="status"
          data-testid="remote-stage-message"
          className="flex items-center gap-2 rounded-lg border border-warning/60 bg-warning-bg py-1 pr-1 pl-3 text-warning-fg"
        >
          <Badge tone="warning">On stage</Badge>
          <span className="min-w-0 flex-1 truncate text-base" translate="no">
            {shown}
          </span>
          <Button
            size="lg"
            className="min-h-12"
            instant
            icon={Eraser}
            data-testid="remote-stage-clear"
            onClick={() => void tap(post('/api/v1/stage-message/clear'))}
          >
            Clear
          </Button>
        </div>
      )}
      <StageTimerList />
    </section>
  );
}
