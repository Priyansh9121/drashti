import type { EngineState } from '../../../../shared/engine/state';
import { cx } from '../../ui/cx';
import { api } from '../device';
import { tap } from '../taps';
import { type RemoteClear, remoteClears } from './remote-clears';
import { useMirror } from './mirror-store';

/*
 * The clears (Session 54, D5): the operator window's bottom bar on the phone, in its order with its keys' names
 * (remote-clears.ts), filling the width in rows (three on a phone, more on a tablet). A layer's clear is lit while its
 * layer has something up (its edge in LIVE's red, a dot, and "on screen" read out) and dimmed with nothing to
 * clear, as the desktop's; Clear all is the strong one, Put it back takes its place in the warning colour while it
 * can be; the Logo and Black-out turn LIVE's red while on and say so in words ("Black-out is on", Session 26g), with
 * no aria-pressed. Show controls: each changes in the same frame as the screens, with no fade. Plain buttons drawn
 * in the Button variants' colours, so the words and the key can wrap in a narrow column (Button keeps one line).
 * Until Session 54 the remote had five of these (Clear slide, Clear all, Black-out, Logo and Put it back), in
 * another order and with no keys.
 */

const post = (path: string, body?: unknown) => () => api<{ rev?: number }>(path, { method: 'POST', body });

/** What each one asks Drashti to do. */
function request(c: RemoteClear, state: EngineState | null): ReturnType<typeof post> {
  switch (c.action) {
    case 'putBack':
      return post('/api/v1/put-back');
    case 'clearAll':
      return post('/api/v1/clear/all');
    case 'toggleLogo':
      return post('/api/v1/logo', { on: state?.logo == null });
    case 'toggleBlackout':
      return post('/api/v1/blackout', { on: !(state?.blackout ?? false) });
    default:
      return post(`/api/v1/clear/${c.layer ?? 'slide'}`);
  }
}

/** Each one's colours: a layer's clear as the desktop's bar draws it; the rest as their Button variants. */
function look(c: RemoteClear): string {
  if (c.layer) return c.lit ? 'border-live bg-layer text-fg' : 'border-layer-edge bg-transparent text-faint';
  if (c.action === 'putBack') return 'border-warning bg-warning-bg text-warning-fg';
  if (c.action === 'clearAll') return 'border-primary-edge bg-panel-2 font-bold text-fg';
  return c.lit ? 'border-live bg-live text-white' : 'border-field bg-panel-2 text-fg';
}

const TEST_ID: Partial<Record<RemoteClear['action'], string>> = {
  putBack: 'remote-put-back',
  clearAll: 'remote-clear-all',
  toggleLogo: 'remote-logo',
  toggleBlackout: 'remote-blackout',
};

export function Clears({ state }: { state: EngineState | null }) {
  const keys = useMirror((s) => s.keys);
  return (
    <div
      role="group"
      aria-label="Show controls"
      className="grid grid-cols-[repeat(auto-fill,minmax(6.25rem,1fr))] gap-2"
      data-testid="remote-actions"
    >
      {remoteClears(state, keys).map((c) => {
        // Dimmed with nothing to clear, as the desktop's. The Logo stays to be pressed with none chosen, as the
        // window's does, and says why (Session 54, D5 review: it had been greyed with no reason).
        const off = c.layer !== undefined || c.action === 'clearAll' ? !c.lit : false;
        return (
          <button
            key={c.action}
            type="button"
            disabled={off}
            data-lit={c.lit ? 'true' : undefined}
            data-testid={c.layer ? `remote-clear-${c.layer}` : TEST_ID[c.action]}
            // A layer's clear is named as the desktop's is ("Clear slide", with "(on screen)" while lit); the rest
            // by their words and key.
            aria-label={c.layer ? `Clear ${c.words.toLowerCase()}${c.lit ? ' (on screen)' : ''}` : undefined}
            onClick={() => void tap(request(c, state))}
            className={cx(
              'relative flex min-h-14 flex-col items-center justify-center rounded-lg border px-2 py-1.5 text-center text-base leading-6 font-medium select-none',
              'disabled:cursor-not-allowed',
              !c.layer && 'disabled:opacity-40',
              look(c),
            )}
          >
            <span>{c.words}</span>
            {/* Read out "Clear all F1", its words and key apart, as the desktop's button is. */}
            {c.key !== '' && ' '}
            {c.key !== '' && (
              <kbd className="mt-0.5 inline-flex min-w-7 items-center justify-center rounded-sm border border-current/40 px-1 font-sans text-base leading-6 font-medium">
                {c.key}
              </kbd>
            )}
            {/* A lit layer's dot, beside its key, in a corner its word leaves free. */}
            {c.layer && c.lit && (
              <span
                aria-hidden="true"
                className="absolute right-1.5 bottom-1.5 h-2 w-2 rounded-full bg-live"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
