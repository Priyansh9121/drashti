import { useEffect } from 'react';
import { chooseOutput, connectSound, useSound } from './sound-store';

/** Where Drashti's sound goes (usually the mixer): the one audio player plays everything there. */
export function SoundOutput() {
  const status = useSound((s) => s.status);
  useEffect(() => {
    connectSound();
  }, []);
  if (!status) return null;
  const { chosen, devices, state, checked } = status;
  // "Default - ..." is the same as the system default below.
  const listed = devices.filter((d) => d.id !== 'default');
  const missing = state === 'missing' && chosen !== null;
  const value = chosen ? (listed.find((d) => d.label === chosen.label)?.id ?? chosen.id) : '';
  return (
    <section className="space-y-2" data-testid="sound-output">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Sound output</h3>
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted">Play sound on</span>
        <select
          aria-label="Sound output"
          className="min-w-64 rounded-md border border-line bg-panel px-2 py-1 text-sm text-white"
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
        </select>
      </label>
      {!checked && <p className="text-xs text-muted">Looking for sound outputs…</p>}
      {missing && (
        <p
          role="alert"
          className="rounded-md border border-amber-600 bg-amber-900/60 px-3 py-2 text-sm text-amber-100"
        >
          {`"${chosen.label}" is not connected. Sound is playing on the system default until it is back.`}
        </p>
      )}
      <p className="text-xs text-muted">
        Only this output makes sound: the screens are silent, and videos&apos; sound plays here in step with
        them.
      </p>
    </section>
  );
}

/** A warning in the header while the chosen sound output is missing. */
export function SoundWarning({ onOpen }: { onOpen: () => void }) {
  const status = useSound((s) => s.status);
  useEffect(() => {
    connectSound();
  }, []);
  if (status?.state !== 'missing' || !status.chosen) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="sound-warning"
      className="rounded-md bg-amber-900/60 px-2 py-1 text-xs text-amber-100"
    >
      {`Sound output "${status.chosen.label}" not connected`}
    </button>
  );
}
