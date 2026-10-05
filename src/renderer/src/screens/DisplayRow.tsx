import { useState } from 'react';
import { describeDisplay } from '../../../shared/display-match';
import type { DisplayInfo, ScreenGroupConfig } from '../../../shared/screens';
import { Button } from '../ui/Button';
import { Select } from '../ui/Field';
import { Monitor } from '../ui/icons';
import { Truncate } from '../ui/Truncate';
import { screensAction } from './screens-store';

/** A connected display in Screens: what it is, and which group it shows (or who uses it). */
export function DisplayRow({
  display,
  usedBy,
  groups,
  onUse,
}: {
  display: DisplayInfo;
  usedBy: string | null;
  groups: ScreenGroupConfig[];
  /** Put it in this group: this computer's display unless given (a node's, Session 13). */
  onUse?: (groupId: string) => void;
}) {
  const [groupId, setGroupId] = useState('');
  const target = groupId !== '' ? groupId : (groups[0]?.id ?? '');
  return (
    <li
      className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel-2 px-3 py-2"
      data-testid="display-row"
      data-display-id={display.id}
    >
      <Monitor size={18} aria-hidden="true" className="shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <Truncate text={describeDisplay(display)} className="text-sm font-medium" />
        <div className="text-xs text-muted">
          scale {display.scaleFactor}x{display.primary ? ' · main display' : ''}
          {display.internal ? ' · built in' : ''}
        </div>
      </div>
      {usedBy ? (
        <span className="text-xs text-muted">Used by “{usedBy}”</span>
      ) : groups.length === 0 ? (
        <span className="text-xs text-muted">Create a group first</span>
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
    </li>
  );
}
