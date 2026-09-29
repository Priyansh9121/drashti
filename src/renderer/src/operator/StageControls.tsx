import { useState } from 'react';
import { useEngine } from '../engine/engine-store';
import { Button } from '../ui/Button';
import { dispatch } from './actions';

/** A message for the performers, on stage screens only: the audience never sees it. */
export function StageMessageControl() {
  const shown = useEngine((s) => s.state?.stageMessage ?? null);
  const [text, setText] = useState('');
  return (
    <section aria-label="Stage message" className="space-y-2" data-testid="stage-message-control">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Stage message</h2>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() !== '') void dispatch({ type: 'setStageMessage', text });
        }}
      >
        <input
          aria-label="Message for the stage"
          placeholder="Seen on stage screens only"
          value={text}
          maxLength={300}
          onChange={(e) => {
            setText(e.target.value);
          }}
          className="min-w-0 flex-1 rounded-md border border-line bg-ink px-2 py-1 text-sm text-white placeholder:text-muted focus-visible:outline-2 focus-visible:outline-accent"
        />
        <Button type="submit" disabled={text.trim() === ''}>
          Show
        </Button>
      </form>
      {shown !== null && (
        <div className="flex items-center gap-2 rounded-md border border-accent/60 bg-accent/10 px-2 py-1 text-sm">
          <span className="min-w-0 flex-1 truncate" data-testid="stage-message-shown" title={shown}>
            On stage: {shown}
          </span>
          <Button
            tone="ghost"
            className="px-2 py-0.5 text-xs"
            onClick={() => void dispatch({ type: 'clearStageMessage' })}
          >
            Clear
          </Button>
        </div>
      )}
    </section>
  );
}
