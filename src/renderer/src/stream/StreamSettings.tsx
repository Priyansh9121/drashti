import { useEffect, useState } from 'react';
import type { DeviceChoice, StreamProfile, StreamProfileInput } from '../../../shared/stream';
import {
  SOUND_DELAY_MAX_MS,
  STREAM_PRESET_IDS,
  STREAM_PRESETS,
  YOUTUBE_RTMPS_URL,
} from '../../../shared/stream';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Select, Slider, TextInput } from '../ui/Field';
import { KeyRound, Plus, Trash2 } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { SectionTitle } from '../ui/Panel';
import { Loading } from '../ui/States';
import { Toggle } from '../ui/Toggle';
import { loadProfiles, streamAction, useStream, watchProgram } from './stream-store';

/*
 * Stream settings: profiles, each with a name, where it goes (the RTMPS
 * address), its key, a preset, the camera and sound input, the delay that
 * lines the sound up with the picture, and whether Drashti's own sound goes
 * in. The key is typed once and never shown again: the window is only told
 * that one is saved.
 */

const inputOf = (p: StreamProfile): StreamProfileInput => ({
  name: p.name,
  url: p.url,
  preset: p.preset,
  camera: p.camera,
  sound: p.sound,
  soundDelayMs: p.soundDelayMs,
  mixOwnSound: p.mixOwnSound,
});

/** The key: saved (never shown), or a field to paste one into. */
function KeyField({ profile }: { profile: StreamProfile }) {
  const storage = useStream((s) => s.profiles?.keyStorage);
  const [replacing, setReplacing] = useState(false);
  const [key, setKey] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  if (storage && !storage.available)
    return (
      <Notice tone="warning" data-testid="stream-key-unavailable">
        {storage.message}
      </Notice>
    );
  if (profile.hasKey && !replacing)
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="stream-key-saved">
        <span className="inline-flex items-center gap-1.5 text-sm text-success-fg">
          <KeyRound size={14} aria-hidden="true" />A key is saved for this profile.
        </span>
        <Button size="sm" onClick={() => setReplacing(true)}>
          Replace key
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() => void streamAction(() => window.drashti.stream.removeKey(profile.id))}
        >
          Remove key
        </Button>
      </div>
    );
  return (
    <form
      className="flex flex-wrap items-start gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const typed = key;
        setKey('');
        void window.drashti.stream.setKey(profile.id, typed).then((result) => {
          if (result.ok) {
            useStream.setState({ profiles: result.profiles });
            setReplacing(false);
            setMessage(null);
          } else setMessage(result.message);
        });
      }}
    >
      <Field
        label="Stream key"
        hint="From YouTube Studio: Go live > Stream > Stream key. It is kept in this computer’s secure storage and never shown again."
        error={message}
        className="min-w-60 flex-1"
      >
        <TextInput
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          data-testid="stream-key-input"
          onChange={(e) => {
            setKey(e.target.value);
          }}
        />
      </Field>
      <Button
        type="submit"
        variant="primary"
        className="mt-5"
        disabled={key.trim() === ''}
        data-testid="save-stream-key"
      >
        Save key
      </Button>
      {replacing && (
        <Button
          className="mt-5"
          onClick={() => {
            setReplacing(false);
            setKey('');
          }}
        >
          Keep the saved key
        </Button>
      )}
    </form>
  );
}

function DeviceSelect({
  label,
  value,
  devices,
  none,
  onChange,
  testId,
}: {
  label: string;
  value: DeviceChoice | null;
  devices: DeviceChoice[];
  none: string;
  onChange: (d: DeviceChoice | null) => void;
  testId: string;
}) {
  // A chosen device that is not connected stays listed, so it is not lost by accident.
  const all = value && !devices.some((d) => d.id === value.id) ? [...devices, value] : devices;
  return (
    <Field label={label}>
      <Select
        data-testid={testId}
        value={value?.id ?? ''}
        onChange={(e) => {
          onChange(all.find((d) => d.id === e.target.value) ?? null);
        }}
      >
        <option value="">{none}</option>
        {all.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
            {devices.some((x) => x.id === d.id) ? '' : ' (not connected)'}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function ProfileForm({ profile, active }: { profile: StreamProfile; active: boolean }) {
  const status = useStream((s) => s.status);
  const [draft, setDraft] = useState<StreamProfileInput>(() => inputOf(profile));
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<StreamProfileInput>) => {
    setDraft((d) => ({ ...d, ...patch }));
  };
  const changed = JSON.stringify(draft) !== JSON.stringify(inputOf(profile));
  return (
    <div className="space-y-4" data-testid="stream-profile-form">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void streamAction(() => window.drashti.stream.saveProfile(profile.id, draft)).then((r) => {
            setError(r.ok ? null : r.message);
          });
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Profile name">
            <TextInput
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
              data-testid="stream-name"
            />
          </Field>
          <Field label="Internet" hint={STREAM_PRESETS[draft.preset].note}>
            <Select
              value={draft.preset}
              data-testid="stream-preset"
              onChange={(e) => set({ preset: e.target.value === 'weak' ? 'weak' : 'good' })}
            >
              {STREAM_PRESET_IDS.map((id) => (
                <option key={id} value={id}>
                  {STREAM_PRESETS[id].label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          label="Address"
          hint={`From YouTube Studio: Go live > Stream > Stream URL. For YouTube it is ${YOUTUBE_RTMPS_URL}.`}
        >
          <TextInput
            value={draft.url}
            onChange={(e) => set({ url: e.target.value })}
            data-testid="stream-url"
          />
        </Field>
        <SectionTitle>Camera and sound</SectionTitle>
        {!status?.programOn && <Loading label="Looking for cameras and sound inputs…" />}
        <div className="grid grid-cols-2 gap-3">
          <DeviceSelect
            label="Camera (or capture card)"
            value={draft.camera}
            devices={status?.inputs.cameras ?? []}
            none="No camera"
            onChange={(camera) => set({ camera })}
            testId="stream-camera"
          />
          <DeviceSelect
            label="Sound input (the mixer’s line in)"
            value={draft.sound}
            devices={status?.inputs.microphones ?? []}
            none="No sound input"
            onChange={(sound) => set({ sound })}
            testId="stream-sound"
          />
        </div>
        <Field
          label="Sound delay"
          hint="Holds the sound back to line it up with the camera’s picture: raise it if lips move after the words are heard."
        >
          <Slider
            min={0}
            max={SOUND_DELAY_MAX_MS}
            step={10}
            value={draft.soundDelayMs}
            format={(v) => `${v} ms`}
            data-testid="stream-delay"
            onChange={(e) => set({ soundDelayMs: Number(e.target.value) })}
          />
        </Field>
        <div className="space-y-1">
          <Toggle
            checked={draft.mixOwnSound}
            onChange={(mixOwnSound) => set({ mixOwnSound })}
            label="Put Drashti’s own sound in the stream (videos and audio cues)"
            data-testid="stream-own-sound"
          />
          <p className="text-xs text-faint">
            For a mandir whose mixer cannot send the hall’s sound to this computer. Leave it off when the
            mixer’s feed already has it, or it is heard twice.
          </p>
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={!changed} data-testid="save-stream-profile">
            Save profile
          </Button>
          {!active && (
            <Button
              onClick={() =>
                void streamAction(() => window.drashti.stream.useProfile(profile.id)).then((r) => {
                  setError(r.ok ? null : r.message);
                })
              }
            >
              Use this profile
            </Button>
          )}
        </div>
      </form>
      <section className="space-y-2">
        <SectionTitle>Stream key</SectionTitle>
        <KeyField key={profile.id} profile={profile} />
      </section>
    </div>
  );
}

export function StreamSettings() {
  const open = useStream((s) => s.settingsOpen);
  return open ? <SettingsDialog /> : null;
}

function SettingsDialog() {
  const profiles = useStream((s) => s.profiles);
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    void loadProfiles();
    // The device lists come from the stream's page: keep it running while the settings are open.
    return watchProgram();
  }, []);
  const id = shown ?? profiles?.activeId ?? null;
  const profile = profiles?.profiles.find((p) => p.id === id) ?? null;
  return (
    <Dialog
      title="Stream settings"
      subtitle="Where the stream goes, and what it takes in."
      size="md"
      onClose={() => useStream.setState({ settingsOpen: false })}
      closeLabel="Close stream settings"
      testId="stream-settings"
      bodyClassName="space-y-4"
    >
      {!profiles || !profile ? (
        <Loading />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Profile" className="min-w-48 flex-1">
              <Select
                value={profile.id}
                data-testid="stream-profile-select"
                onChange={(e) => {
                  setShown(e.target.value);
                }}
              >
                {profiles.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.id === profiles.activeId ? ' (in use)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              icon={Plus}
              onClick={() =>
                void streamAction(() =>
                  window.drashti.stream.saveProfile(null, {
                    ...inputOf(profile),
                    name: `${profile.name} (copy)`.slice(0, 80),
                  }),
                ).then((r) => {
                  if (r.ok) setShown(r.profiles.activeId);
                })
              }
            >
              New profile
            </Button>
            <Button
              icon={Trash2}
              variant="danger"
              disabled={profiles.profiles.length <= 1}
              onClick={() =>
                void streamAction(() => window.drashti.stream.removeProfile(profile.id)).then((r) => {
                  if (r.ok) setShown(null);
                })
              }
            >
              Remove profile
            </Button>
          </div>
          <ProfileForm key={profile.id} profile={profile} active={profile.id === profiles.activeId} />
        </>
      )}
    </Dialog>
  );
}
