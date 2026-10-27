import { CALENDAR_LANG_NAMES } from '../../../../shared/calendar';
import { fieldOf, type MessageTemplate, templateFields } from '../../../../shared/messages';
import type { TimerState } from '../../../../shared/timers';
import { useEngine } from '../../engine/engine-store';

/*
 * A message's fields that are filled by themselves, said as the operator window's Messages panel says them
 * (Session 54, D5): "{starts}: timer “Sabha starts in”", "{date}: today’s Samvat date (Gujarati)". The fields typed
 * in have their boxes in the message's row.
 */

const NO_TIMERS: TimerState[] = [];

export function MessageFields({ template }: { template: MessageTemplate }) {
  const timers = useEngine((s) => s.state?.timers) ?? NO_TIMERS;
  const filled = templateFields(template.template).flatMap((n) => {
    const f = fieldOf(template, n);
    if (f.kind === 'timer')
      return [`{${n}}: timer “${timers.find((t) => t.id === f.timerId)?.name ?? 'removed'}”`];
    if (f.kind === 'samvat') return [`{${n}}: today’s Samvat date (${CALENDAR_LANG_NAMES[f.lang]})`];
    return [];
  });
  return filled.map((line) => (
    <p key={line} className="text-base text-muted" data-testid="remote-message-filled">
      {line}
    </p>
  ));
}
