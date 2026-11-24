import { useEffect } from 'react';
import { Button } from '../ui/Button';
import { AlertTriangle } from '../ui/icons';
import { connectCaptions, openCaptions, useCaptions } from './captions-store';

/*
 * The status bar's line while captions that are on show nothing (cap-threads: on CI's two-core Windows today's
 * captions rested again and again, and the operator saw no word of it): resting because this computer cannot keep up,
 * no sound input, no model yet, or stopped. In Pro Mode, Live Captions… opens the dialog, which says more.
 */
export function CaptionsWarning({ canOpen }: { canOpen: boolean }) {
  const line = useCaptions((s) => s.line);
  useEffect(() => {
    connectCaptions();
  }, []);
  if (!line) return null;
  return (
    <span
      role="status"
      title={line}
      data-testid="captions-warning"
      className="flex min-w-0 items-center gap-1.5 rounded-sm bg-warning-bg px-1.5 py-0.5 text-warning-fg"
    >
      <AlertTriangle size={13} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{line}</span>
      {canOpen && (
        <Button size="sm" className="h-5 shrink-0" data-testid="captions-warning-open" onClick={openCaptions}>
          Live Captions…
        </Button>
      )}
    </span>
  );
}
