import { useEffect } from 'react';
import type { StreamLayout, StreamStatus } from '../../../shared/stream';
import { STREAM_PRESETS } from '../../../shared/stream';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { radioKeys, radioTabIndex } from '../ui/radio';
import { Dialog } from '../ui/Dialog';
import { Camera, Mic, Presentation, Settings } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { SectionTitle } from '../ui/Panel';
import { Loading } from '../ui/States';
import { usePreview } from './preview';
import { OnAirControls, RecordingControls } from './StreamControls';
import { closeStreamPanel, loadProfiles, streamAction, useStream } from './stream-store';

/*
 * The Stream panel: the Program's live preview, the sound level, the layout,
 * and (from the controls below it) going live and recording. A sheet on the
 * right, beside the show, like Screens.
 */

const LAYOUTS: { id: StreamLayout; label: string; hint: string; icon: typeof Camera }[] = [
  {
    id: 'camera',
    label: 'Camera and words',
    hint: 'The camera, with the slide’s words along the bottom',
    icon: Camera,
  },
  { id: 'slides', label: 'Slides', hint: 'The slides as the hall sees them', icon: Presentation },
];

/** Camera or Slides: switchable at any time, also on air. */
function LayoutSwitch({ layout }: { layout: StreamLayout }) {
  return (
    <div
      role="radiogroup"
      aria-label="What the stream shows"
      className="grid grid-cols-2 gap-2"
      onKeyDown={radioKeys(
        LAYOUTS.map((l) => l.id),
        layout,
        (id) => void streamAction(() => window.drashti.stream.setLayout(id)),
      )}
    >
      {LAYOUTS.map((l, i) => {
        const on = l.id === layout;
        const Icon = l.icon;
        return (
          <button
            key={l.id}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={radioTabIndex(
              on,
              i,
              LAYOUTS.some((x) => x.id === layout),
            )}
            data-testid={`stream-layout-${l.id}`}
            onClick={() => void streamAction(() => window.drashti.stream.setLayout(l.id))}
            className={cx(
              'flex items-start gap-2 rounded-lg border px-3 py-2 text-left',
              on ? 'border-accent bg-panel-3' : 'border-field bg-panel-2 hover:border-muted',
            )}
          >
            <Icon size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-fg">{l.label}</span>
              <span className="block text-xs text-muted">{l.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The level in words: above 0 dB the sound is clipped (too loud from the mixer). */
const levelWords = (db: number) => (db <= -60 ? 'Silent' : db > 0 ? 'Too loud' : `${Math.round(db)} dB`);

/** The stream's sound, from silence (-60 dB and below) to full (0 dB). */
function LevelMeter({ db }: { db: number }) {
  const shown = Math.max(-60, Math.min(0, db));
  const fill = ((shown + 60) / 60) * 100;
  const tone = db > -3 ? 'bg-danger' : db > -12 ? 'bg-warning' : 'bg-success';
  return (
    <div className="flex items-center gap-2">
      <Mic size={14} aria-hidden="true" className="shrink-0 text-muted" />
      <div
        role="meter"
        aria-label="Sound level"
        aria-valuemin={-60}
        aria-valuemax={0}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={levelWords(db)}
        data-testid="stream-level"
        data-db={Math.round(db)}
        className="relative h-2.5 flex-1 overflow-hidden rounded-full border border-line-strong bg-panel-3"
      >
        <div className={cx('h-full', tone)} style={{ width: `${fill}%` }} />
      </div>
      <span className={cx('w-16 text-right text-xs tabular-nums', db > 0 ? 'text-danger-fg' : 'text-muted')}>
        {levelWords(db)}
      </span>
    </div>
  );
}

const cameraWords: Record<StreamStatus['inputs']['camera'], string> = {
  none: 'No camera chosen',
  starting: 'Starting…',
  on: 'On',
  missing: 'Not connected',
  blocked: 'Not allowed',
  failed: 'Would not start',
};

function Inputs({ status }: { status: StreamStatus }) {
  const profile = useStream((s) => s.profiles?.profiles.find((p) => p.id === status.profileId));
  const rows = [
    { label: 'Camera', name: profile?.camera?.label, state: status.inputs.camera, icon: Camera },
    { label: 'Sound input', name: profile?.sound?.label, state: status.inputs.sound, icon: Mic },
  ];
  return (
    <ul className="space-y-1 text-sm" data-testid="stream-inputs">
      {rows.map((r) => {
        const Icon = r.icon;
        const good = r.state === 'on';
        const none = r.state === 'none';
        return (
          <li key={r.label} className="flex items-center gap-2">
            <Icon size={14} aria-hidden="true" className="shrink-0 text-muted" />
            <span className="w-24 shrink-0 text-muted">{r.label}</span>
            <span className="min-w-0 flex-1 truncate text-fg">{r.name ?? 'None'}</span>
            <span
              className={cx(
                'shrink-0 text-xs',
                good ? 'text-success-fg' : none ? 'text-faint' : 'text-warning-fg',
              )}
              data-testid={`stream-${r.label === 'Camera' ? 'camera' : 'sound'}-state`}
            >
              {r.state === 'none' && r.label === 'Sound input'
                ? 'No sound input chosen'
                : cameraWords[r.state]}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function StreamPanel() {
  const status = useStream((s) => s.status);
  const profiles = useStream((s) => s.profiles);
  const error = useStream((s) => s.error);
  const preview = usePreview();
  useEffect(() => {
    void loadProfiles();
  }, []);
  const profile = profiles?.profiles.find((p) => p.id === profiles.activeId) ?? null;
  const preset = profile ? STREAM_PRESETS[profile.preset] : null;
  return (
    <Dialog
      title="Stream"
      subtitle="What goes to YouTube: the camera or the slides, with the sound from the mixer."
      placement="right"
      size="lg"
      onClose={closeStreamPanel}
      closeLabel="Close stream"
      bodyClassName="space-y-5"
      testId="stream-panel"
      headerActions={
        <Button
          icon={Settings}
          data-testid="open-stream-settings"
          onClick={() => {
            useStream.setState({ settingsOpen: true });
          }}
        >
          Stream settings
        </Button>
      }
    >
      {error && (
        <Notice tone="danger" onDismiss={() => useStream.setState({ error: null })}>
          {error}
        </Notice>
      )}
      <section className="space-y-2">
        <SectionTitle>Program</SectionTitle>
        <div
          className="relative aspect-video w-full overflow-hidden rounded-lg border border-line-strong bg-black"
          data-a11y-picture
        >
          {preview.frame ? (
            <img
              src={preview.frame}
              alt="What the stream shows now"
              data-testid="stream-preview"
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Loading label="Starting the stream’s picture…" />
            </div>
          )}
        </div>
        <LevelMeter db={preview.levelDb} />
      </section>
      {status ? (
        <>
          <OnAirControls status={status} />
          <RecordingControls status={status} />
          <section className="space-y-2">
            <SectionTitle>Layout</SectionTitle>
            <LayoutSwitch layout={status.layout} />
          </section>
          <section className="space-y-2">
            <SectionTitle>Inputs</SectionTitle>
            <Inputs status={status} />
            {status.inputs.message && <Notice tone="warning">{status.inputs.message}</Notice>}
            {profile && preset && (
              <p className="text-xs text-muted" data-testid="stream-profile">
                Profile: {profile.name} · {preset.label} ({preset.height}p, {preset.videoKbps / 1000} Mbps)
              </p>
            )}
          </section>
        </>
      ) : (
        <Loading />
      )}
    </Dialog>
  );
}
