import { useEffect } from 'react';
import type { MidiAction } from '../../../shared/midi';
import { inputName, MIDI_ACTION_NAMES, sameInput } from '../../../shared/midi';
import { connectMacros, useMacros } from '../macros/macros-store';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Select } from '../ui/Field';
import { Notice } from '../ui/Notice';
import { SectionTitle } from '../ui/Panel';
import { learn, openMidi, saveMidi, useMidi } from './midi-store';

/*
 * The MIDI controller (Pro Mode): the device to listen to, and what its
 * notes and controllers do. Learn, then press a pad, key or button on the
 * controller: it now does that. Next, Back, Clear all, Black-out and Logo
 * also work in Simple Mode; macros do not.
 */

const same = (a: MidiAction, b: MidiAction) => JSON.stringify(a) === JSON.stringify(b);

export function MidiDialog({ onClose }: { onClose: () => void }) {
  const s = useMidi();
  const macros = useMacros((x) => x.macros);
  useEffect(() => {
    connectMacros();
    void openMidi();
    return () => {
      learn(null);
    };
  }, []);
  const target = (action: MidiAction, name: string) => ({ action, name });
  const targets = [
    ...(Object.keys(MIDI_ACTION_NAMES) as (keyof typeof MIDI_ACTION_NAMES)[]).map((kind) =>
      target({ kind }, MIDI_ACTION_NAMES[kind]),
    ),
    ...(macros ?? []).map((m) => target({ kind: 'macro', macroId: m.id }, `Macro: ${m.name}`)),
  ];
  const deviceNames = [...new Set([...s.devices, ...(s.settings.deviceName ? [s.settings.deviceName] : [])])];
  return (
    <Dialog
      title="MIDI controller"
      subtitle="A pad, keyboard or foot switch plugged into this computer, mapped to Next, Back and more."
      size="md"
      onClose={onClose}
      closeLabel="Close MIDI"
      testId="midi-dialog"
      bodyClassName="space-y-4"
    >
      {s.access === 'unsupported' && <Notice tone="warning">MIDI is not available on this computer.</Notice>}
      {s.access === 'refused' && <Notice tone="warning">The computer did not let Drashti use MIDI.</Notice>}
      {s.problem && <Notice tone="danger">{s.problem}</Notice>}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Device" className="min-w-56 flex-1">
          <Select
            value={s.settings.deviceName ?? ''}
            data-testid="midi-device"
            onChange={(e) => {
              void saveMidi({ ...s.settings, deviceName: e.target.value === '' ? null : e.target.value });
            }}
          >
            <option value="">None</option>
            {deviceNames.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        {s.settings.deviceName !== null &&
          (s.connected ? (
            <Badge tone="success">Connected</Badge>
          ) : (
            <Badge tone="warning">Not connected: it is used when it is plugged in</Badge>
          ))}
      </div>
      <p className="text-xs text-muted" aria-live="polite" data-testid="midi-last">
        {s.learning
          ? 'Press a pad, key or button on the controller…'
          : s.last
            ? `Last from the controller: ${inputName(s.last)}`
            : 'Nothing from the controller yet.'}
      </p>
      <section className="space-y-2">
        <SectionTitle>What the controller does</SectionTitle>
        <ul className="divide-y divide-line rounded-lg border border-line" data-testid="midi-mappings">
          {targets.map((t) => {
            const mapped = s.settings.mappings.find((m) => same(m.action, t.action));
            const learning = s.learning !== null && same(s.learning, t.action);
            return (
              <li
                key={JSON.stringify(t.action)}
                className="flex items-center gap-2 px-3 py-2"
                data-testid="midi-target"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{t.name}</span>
                <span className="text-xs text-muted" data-testid="midi-input">
                  {mapped ? inputName(mapped.input) : 'Not mapped'}
                </span>
                <Button
                  size="sm"
                  variant={learning ? 'warning' : 'secondary'}
                  aria-pressed={learning}
                  disabled={s.settings.deviceName === null}
                  onClick={() => {
                    learn(learning ? null : t.action);
                  }}
                >
                  {learning ? 'Cancel' : 'Learn'}
                </Button>
                {mapped && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void saveMidi({
                        ...s.settings,
                        mappings: s.settings.mappings.filter((m) => !sameInput(m.input, mapped.input)),
                      });
                    }}
                  >
                    Forget
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted">
          Next, Back, Clear all, Black-out and Logo work in Simple Mode too. Macros do not: Simple Mode runs
          none.
        </p>
      </section>
    </Dialog>
  );
}
