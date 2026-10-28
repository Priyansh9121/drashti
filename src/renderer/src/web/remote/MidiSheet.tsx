import { inputName, MIDI_ACTION_NAMES, MIDI_LEARNABLE, type MidiLearnable } from '../../../../shared/midi';
import { MIDI_NOT_LISTED, type RemoteMidi } from '../../../../shared/network-desktop';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { KeyboardMusic, Trash2, X } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { changeMidi, closeSheet, useDesktop } from './desktop-store';
import { PhoneSheet } from './PhoneSheet';

/*
 * MIDI from a phone (Session 54, the phone as a full Drashti), as MIDI… sets it up on the Drashti computer: the
 * controller's device, chosen among those the computer's window lists (never one the phone names); its mappings,
 * each forgotten here; and Learn, which waits for a press on the controller at the computer. Pro Mode's: in Simple
 * Mode Drashti refuses the changes, and says so here.
 */

const ACCESS_WORDS: Partial<Record<NonNullable<RemoteMidi['seen']>['access'], string>> = {
  refused: 'The Drashti computer refused MIDI to Drashti: allow it there, then open this again.',
  unsupported: 'MIDI cannot be used on the Drashti computer.',
};

export function MidiSheet() {
  const midi = useDesktop((s) => s.midi);
  const problem = useDesktop((s) => s.problem);
  const busy = useDesktop((s) => s.busy);
  return (
    <PhoneSheet
      title="MIDI"
      subtitle="The controller plugged into the Drashti computer"
      testId="remote-midi-sheet"
      onClose={closeSheet}
    >
      {problem && (
        <Notice
          tone="warning"
          data-testid="remote-midi-problem"
          onDismiss={() => useDesktop.setState({ problem: null })}
        >
          {problem}
        </Notice>
      )}
      {midi === null ? (
        <p className="text-base text-muted">Reading MIDI…</p>
      ) : (
        <>
          <Devices midi={midi} busy={busy} />
          <Learning midi={midi} busy={busy} />
          <Mappings midi={midi} busy={busy} />
        </>
      )}
    </PhoneSheet>
  );
}

/** The device listened to: none, or one the computer lists now (the chosen one shown even while unplugged). */
function Devices({ midi, busy }: { midi: RemoteMidi; busy: boolean }) {
  const chosen = midi.settings.deviceName;
  const listed = midi.seen?.devices ?? [];
  const names = chosen !== null && !listed.includes(chosen) ? [chosen, ...listed] : listed;
  const said = midi.seen ? ACCESS_WORDS[midi.seen.access] : MIDI_NOT_LISTED;
  return (
    <section
      className="space-y-2"
      aria-labelledby="remote-midi-device-title"
      data-testid="remote-midi-devices"
    >
      <h3 id="remote-midi-device-title" className="text-base font-bold text-fg">
        Device
      </h3>
      {said && <Notice tone="info">{said}</Notice>}
      {midi.seen && listed.length === 0 && !said && (
        <p className="text-base text-muted">No MIDI device is plugged into the Drashti computer.</p>
      )}
      <div role="group" aria-label="MIDI device" className="grid grid-cols-1 gap-2">
        {[null, ...names].map((name) => {
          const on = name === chosen;
          const unplugged = name !== null && !listed.includes(name);
          return (
            <Button
              key={name ?? ''}
              size="lg"
              wrap
              className={cx('min-h-12 w-full justify-start', on && 'ring-2 ring-accent')}
              variant={on ? 'strong' : 'secondary'}
              aria-pressed={on}
              disabled={busy}
              icon={KeyboardMusic}
              data-testid="remote-midi-device"
              data-device={name ?? ''}
              onClick={() => void changeMidi('/api/v1/midi/device', { deviceName: name })}
            >
              {name === null ? 'None' : unplugged ? `${name} (not plugged in)` : name}
            </Button>
          );
        })}
      </div>
    </section>
  );
}

/** Learn: the next press on the controller at the computer does this; Cancel stops waiting. */
function Learning({ midi, busy }: { midi: RemoteMidi; busy: boolean }) {
  const learning = midi.learning;
  // The computer refused MIDI, or has none: nothing could be learned (the device's notice says why).
  const cannot = midi.seen?.access === 'refused' || midi.seen?.access === 'unsupported';
  const choose = (action: MidiLearnable | null) => void changeMidi('/api/v1/midi/learn', { action });
  return (
    <section className="space-y-2" aria-labelledby="remote-midi-learn-title" data-testid="remote-midi-learn">
      <h3 id="remote-midi-learn-title" className="text-base font-bold text-fg">
        Learn
      </h3>
      {learning ? (
        <div className="space-y-2" role="status" data-testid="remote-midi-learning">
          <p className="text-base text-fg">
            Press the pad or key for <span className="font-bold">{MIDI_ACTION_NAMES[learning]}</span> on the
            MIDI controller at the Drashti computer now.
          </p>
          <Button size="lg" className="min-h-12 w-full" icon={X} onClick={() => choose(null)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {MIDI_LEARNABLE.map((action) => (
            <Button
              key={action}
              size="lg"
              wrap
              className="min-h-12 w-full"
              disabled={busy || cannot || midi.settings.deviceName === null}
              data-testid={`remote-midi-learn-${action}`}
              onClick={() => choose(action)}
            >
              {MIDI_ACTION_NAMES[action]}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}

/** What each note or controller does now, each forgotten here. */
function Mappings({ midi, busy }: { midi: RemoteMidi; busy: boolean }) {
  const mappings = midi.settings.mappings;
  return (
    <section
      className="space-y-2"
      aria-labelledby="remote-midi-mappings-title"
      data-testid="remote-midi-mappings"
    >
      <h3 id="remote-midi-mappings-title" className="text-base font-bold text-fg">
        What the controller does
      </h3>
      {mappings.length === 0 ? (
        <p className="text-base text-muted">Nothing yet: choose the device, then Learn.</p>
      ) : (
        <ul className="space-y-2">
          {mappings.map((m, index) => (
            <li
              key={`${inputName(m.input)}:${m.action.kind}`}
              className="flex items-center gap-2"
              data-testid="remote-midi-mapping"
            >
              <span className="min-w-0 flex-1 text-base text-fg">
                {m.action.kind === 'macro' ? 'A macro (no longer used)' : MIDI_ACTION_NAMES[m.action.kind]}:{' '}
                {inputName(m.input)}
              </span>
              <Button
                size="lg"
                variant="danger"
                className="min-h-12"
                icon={Trash2}
                disabled={busy}
                aria-label={`Forget ${inputName(m.input)}`}
                data-testid="remote-midi-forget"
                onClick={() => void changeMidi('/api/v1/midi/forget', { index })}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
