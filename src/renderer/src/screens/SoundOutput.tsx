import { useEffect } from 'react';
import { Select } from '../ui/Field';
import { Notice } from '../ui/Notice';
import { SectionTitle } from '../ui/Panel';
import { Loading } from '../ui/States';
import { chooseOutput, connectSound, useSound } from './sound-store';

/**
 * Where Drashti's sound goes (usually the mixer): the one audio player plays
 * everything there. The status bar says where it goes, and warns while the
 * chosen output is not connected.
 */
export function SoundOutput() {
  const status = useSound((s) => s.status);
  useEffect(() => {
    connectSound();
  }, []);
  if (!status)
    return (
      <section className="space-y-2" data-testid="sound-output">
        <SectionTitle>Sound output</SectionTitle>
        <Loading label="Looking for sound outputs…" />
      </section>
    );
  const { chosen, devices, state, checked } = status;
  // "Default - ..." is the same as the system default below.
  const listed = devices.filter((d) => d.id !== 'default');
  const missing = state === 'missing' && chosen !== null;
  const value = chosen ? (listed.find((d) => d.label === chosen.label)?.id ?? chosen.id) : '';
  return (
    <section className="space-y-2" data-testid="sound-output">
      <SectionTitle>Sound output</SectionTitle>
      <label className="flex items-center gap-2 text-sm">
        <span className="shrink-0 text-muted">Play sound on</span>
        <Select
          aria-label="Sound output"
          className="min-w-64"
          value={value}
          onChange={(e) => {
            const id = e.target.value;
            void chooseOutput(id === '' ? null : (listed.find((d) => d.id === id) ?? null));
          }}
        >
          <option value="">System default</option>
          {missing && !listed.some((d) => d.id === value) && (
            <option value={chosen.id}>{`${chosen.label} (not connected)`}</option>
          )}
          {listed.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </Select>
      </label>
      {!checked && <p className="text-xs text-muted">Looking for sound outputs…</p>}
      {missing && (
        <Notice tone="warning">
          {`"${chosen.label}" is not connected. Sound is playing on the system default until it is back.`}
        </Notice>
      )}
      <p className="text-xs text-muted">
        Only this output makes sound: the screens are silent, and videos&apos; sound plays here in step with
        them.
      </p>
    </section>
  );
}
