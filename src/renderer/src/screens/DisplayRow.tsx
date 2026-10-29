import { useState } from 'react';
import { describeDisplay } from '../../../shared/display-match';
import type { DisplayInfo, DisplayUse, ScreenGroupConfig } from '../../../shared/screens';
import { DISPLAY_JOB_WORDS, DISPLAY_JOBS, jobOf } from '../../../shared/screens';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { Select } from '../ui/Field';
import { Monitor } from '../ui/icons';
import { Truncate } from '../ui/Truncate';
import { screensAction } from './screens-store';

/** Where a display is offered, the one the controls are on says so (Session 50; Set Up Screens… too). */
export const CONTROLS_HERE = 'The controls are on this display';

/**
 * A display's job in one click (Session 55): Audience, Stage or Not used, as Set Up Screens… offers them. Given by
 * hand, it is remembered by the display; one on the controls' display asks first (Cover the controls?), and then
 * Keep these screens? asks too.
 */
function JobSwitch({
  display,
  use,
  describedBy,
}: {
  display: DisplayInfo;
  use: DisplayUse;
  describedBy?: string | undefined;
}) {
  const job = jobOf(use);
  const name = display.label || `display ${String(display.id)}`;
  return (
    <div
      role="radiogroup"
      aria-label={`What ${name} shows`}
      aria-describedby={describedBy}
      data-testid="display-job"
      data-job={job}
      className="flex flex-wrap gap-1.5"
    >
      {DISPLAY_JOBS.map((j) => (
        <label
          key={j}
          data-testid={`display-job-${j}`}
          className={cx(
            'flex min-h-8 cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1 text-sm',
            'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
            job === j ? 'border-second/70 bg-panel-3 font-medium' : 'border-line hover:bg-panel-3',
          )}
        >
          <input
            type="radio"
            name={`display-job-${String(display.id)}`}
            value={j}
            checked={job === j}
            className="accent-accent"
            onChange={() =>
              void screensAction((consent) => window.drashti.screens.setJob(display.id, j, consent))
            }
          />
          {DISPLAY_JOB_WORDS[j]}
        </label>
      ))}
    </div>
  );
}

/**
 * A connected display in Screens: what it is, its job in one click (this computer's own: `use`, Session 55), and
 * which group it shows (or who uses it). A display no screen uses can also be added to a group of its own choosing.
 */
export function DisplayRow({
  display,
  usedBy,
  groups,
  onUse,
  controls = false,
  use,
}: {
  display: DisplayInfo;
  usedBy: string | null;
  groups: ScreenGroupConfig[];
  /** Put it in this group: this computer's display unless given (a node's, Session 13). */
  onUse?: (groupId: string) => void;
  /** The controls are on this display (Session 50). */
  controls?: boolean;
  /** What it does now (this computer's displays, Session 55): its job, in one click. */
  use?: DisplayUse;
}) {
  const [groupId, setGroupId] = useState('');
  const target = groupId !== '' ? groupId : (groups[0]?.id ?? '');
  const markId = `display-controls-${String(display.id)}`;
  return (
    <li
      className="space-y-2 rounded-lg border border-line bg-panel-2 px-3 py-2"
      data-testid="display-row"
      data-display-id={display.id}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Monitor size={18} aria-hidden="true" className="shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <Truncate text={describeDisplay(display)} className="text-sm font-medium" />
          <div className="text-xs text-muted">
            scale {display.scaleFactor}x{display.primary ? ' · main display' : ''}
            {display.internal ? ' · built in' : ''}
          </div>
        </div>
        {controls && (
          <span id={markId} data-testid="display-controls-here">
            <Badge tone="warning">{CONTROLS_HERE}</Badge>
          </span>
        )}
        {usedBy ? (
          <span className="text-xs text-muted">
            Used by “{usedBy}”{use?.role === 'keyfill' ? ' (key and fill)' : ''}
          </span>
        ) : groups.length === 0 ? (
          use ? null : (
            <span className="text-xs text-muted">Create a group first</span>
          )
        ) : (
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted" htmlFor={`group-for-${display.id}`}>
              Add to
            </label>
            <Select
              id={`group-for-${display.id}`}
              className="max-w-40"
              value={target}
              onChange={(e) => {
                setGroupId(e.target.value);
              }}
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
            <Button
              variant="primary"
              onClick={() => {
                if (onUse) onUse(target);
                else
                  void screensAction((consent) =>
                    window.drashti.screens.assignDisplay(target, display.id, consent),
                  );
              }}
            >
              Use this display
            </Button>
          </div>
        )}
      </div>
      {use && <JobSwitch display={display} use={use} describedBy={controls ? markId : undefined} />}
    </li>
  );
}
