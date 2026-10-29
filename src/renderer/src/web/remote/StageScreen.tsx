import { useCallback, useEffect, useState } from 'react';
import {
  STAGE_MESSAGE_SIZES,
  STAGE_SIZE_NAMES,
  type StageMessageSize,
} from '../../../../shared/stage-message';
import { useEngine } from '../../engine/engine-store';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Eraser } from '../../ui/icons';
import { api } from '../device';
import { onListsChanged, onOnline } from '../feed';
import { tap } from '../taps';
import { StageTimerList } from './StageTimers';

/*
 * The stage screen (Session 54, D5), as the operator window's Stage screen panel has it: a message for the
 * performers on the stage screens only (the audience never sees it), shown, said while it is up, and cleared.
 * Since Session 55 its Layout too: the one layout every stage screen shows, chosen here at once as in the panel.
 * Making and changing layouts stays in Drashti (stage layouts are the setup). A3's Start, Pause and Reset for the
 * stage layout's own timer go under the message, in this section. Since Session 55 (Part 15) the message as the Stage
 * screen panel has it: its own size, a flash as it comes up, Show and Hide, and the last few a tap away.
 */

const post = (path: string, body?: unknown) => () => api<{ rev?: number }>(path, { method: 'POST', body });

/** Standard, the stage screen Drashti comes with, in the picker. */
const STANDARD = 'standard';

/** The Layout picker (Session 55): the layouts by name, the one every stage screen shows chosen. */
function LayoutPicker() {
  const chosen = useEngine((s) => s.state?.stage?.layout?.id ?? STANDARD);
  const [layouts, setLayouts] = useState<{ id: string; name: string }[] | null>(null);
  const load = useCallback(() => {
    void api<{ layouts: { id: string; name: string }[] }>('/api/v1/stage-layouts').then((r) => {
      if (r.ok) setLayouts(r.layouts);
    });
  }, []);
  useEffect(() => {
    load();
    const offOnline = onOnline(load);
    // Layouts made, renamed or deleted in Drashti.
    const offLists = onListsChanged((what) => {
      if (what === 'setup') load();
    });
    return () => {
      offOnline();
      offLists();
    };
  }, [load]);
  if (layouts === null) return null;
  return (
    <label className="flex flex-col gap-1 text-base text-muted">
      Layout
      <select
        value={chosen}
        data-testid="remote-stage-layout"
        onChange={(e) => {
          const layoutId = e.target.value === STANDARD ? null : e.target.value;
          void tap(post('/api/v1/stage-layouts/choose', { layoutId }));
        }}
        className="h-12 rounded-lg border border-field bg-panel-3 px-3 text-base text-fg"
      >
        <option value={STANDARD}>Standard</option>
        {layouts.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}

const NO_RECENT: string[] = [];

export function StageScreen() {
  const shown = useEngine((s) => s.state?.stageMessage ?? null);
  const recent = useEngine((s) => s.state?.stageRecent) ?? NO_RECENT;
  const [text, setText] = useState('');
  const [size, setSize] = useState<StageMessageSize>('standard');
  const [flash, setFlash] = useState(false);
  const show = (words: string) => {
    if (words.trim() !== '') void tap(post('/api/v1/stage-message', { text: words, size, flash }));
  };
  return (
    <section className="space-y-2" aria-labelledby="stage-title" data-testid="remote-stage">
      <h2 id="stage-title" className="text-base font-bold tracking-wider text-muted uppercase">
        Stage screen
      </h2>
      <LayoutPicker />
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          show(text);
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
      {/* Its own size and a flash (Session 55), as in the Stage screen panel. */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-base text-muted">
          Size
          <select
            aria-label="Size of the stage message"
            value={size}
            onChange={(e) => {
              setSize(e.target.value as StageMessageSize);
            }}
            className="h-12 rounded-lg border border-field bg-panel-3 px-3 text-base text-fg"
          >
            {STAGE_MESSAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {STAGE_SIZE_NAMES[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-12 items-center gap-2 text-base text-fg">
          <input
            type="checkbox"
            checked={flash}
            onChange={(e) => {
              setFlash(e.target.checked);
            }}
            className="size-5"
          />
          Flash as it comes up
        </label>
      </div>
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
            Hide
          </Button>
        </div>
      )}
      {/* The last few, a tap away: one tap shows it again on every stage screen (Session 55). */}
      {recent.length > 0 && (
        <div data-testid="remote-stage-recent" className="space-y-1">
          <p className="text-sm text-muted">Shown before, a tap away</p>
          <div className="flex flex-wrap gap-2">
            {recent.map((r) => (
              <Button
                key={r}
                size="lg"
                className="min-h-12 max-w-full"
                variant={r === shown ? 'live' : 'secondary'}
                onClick={() => {
                  show(r);
                }}
              >
                <span className="truncate" translate="no">
                  {r}
                </span>
              </Button>
            ))}
          </div>
        </div>
      )}
      <StageTimerList />
    </section>
  );
}
