import { useEffect } from 'react';
import type { DeviceChoice, StreamProfile } from '../../../shared/stream';
import type { ScreenGroupConfig } from '../../../shared/screens';
import { STREAM_PRESETS } from '../../../shared/stream';
import { Field, Select } from '../ui/Field';
import { Radio } from '../ui/icons';
import { loadProfiles, streamAction, useStream, watchProgram } from '../stream/stream-store';
import type { LookInfo } from '../../../shared/looks';
import { GroupLookSettings } from './LookSettings';

/*
 * The stream's group in Screens: drawn off screen (it has no displays), with
 * the languages its lower third and slides show, and the camera and sound
 * input it takes in (those of the stream profile in use).
 */

function InputSelect({
  label,
  value,
  devices,
  none,
  testId,
  onChange,
}: {
  label: string;
  value: DeviceChoice | null;
  devices: DeviceChoice[];
  none: string;
  testId: string;
  onChange: (d: DeviceChoice | null) => void;
}) {
  const all = value && !devices.some((d) => d.id === value.id) ? [...devices, value] : devices;
  return (
    <Field label={label} className="min-w-0 flex-1">
      <Select
        value={value?.id ?? ''}
        data-testid={testId}
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

export function StreamGroupCard({ group, look }: { group: ScreenGroupConfig; look: LookInfo | null }) {
  const status = useStream((s) => s.status);
  const profiles = useStream((s) => s.profiles);
  useEffect(() => {
    void loadProfiles();
    // The camera and sound input lists come from the stream's page.
    return watchProgram();
  }, []);
  const profile: StreamProfile | undefined = profiles?.profiles.find((p) => p.id === profiles.activeId);
  const save = (patch: Partial<StreamProfile>) => {
    if (!profile) return;
    const { id: _id, hasKey: _hasKey, ...input } = { ...profile, ...patch };
    void streamAction(() => window.drashti.stream.saveProfile(profile.id, input));
  };
  const preset = profile ? STREAM_PRESETS[profile.preset] : STREAM_PRESETS.good;
  return (
    <section className="space-y-2 rounded-xl border border-line bg-panel-2 p-3" data-testid="stream-group">
      <div className="flex items-center gap-2">
        <Radio size={16} aria-hidden="true" className="text-muted" />
        <h3 className="text-base font-bold">{group.name}</h3>
        <span className="text-xs text-muted">
          The stream, drawn off screen at {preset.width} × {preset.height}
        </span>
      </div>
      {look && <GroupLookSettings look={look} groupId={group.id} role="stream" />}
      {profile && (
        <div className="flex flex-wrap gap-3">
          <InputSelect
            label="Camera (or capture card)"
            value={profile.camera}
            devices={status?.inputs.cameras ?? []}
            none="No camera"
            testId="screens-stream-camera"
            onChange={(camera) => save({ camera })}
          />
          <InputSelect
            label="Sound input (the mixer’s line in)"
            value={profile.sound}
            devices={status?.inputs.microphones ?? []}
            none="No sound input"
            testId="screens-stream-sound"
            onChange={(sound) => save({ sound })}
          />
        </div>
      )}
      {status?.inputs.message && <p className="text-xs text-warning-fg">{status.inputs.message}</p>}
    </section>
  );
}
