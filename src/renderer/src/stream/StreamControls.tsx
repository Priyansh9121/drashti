import { useEffect, useState } from 'react';
import type { StreamStatus } from '../../../shared/stream';
import { STREAM_PRESETS } from '../../../shared/stream';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { ConfirmDialog } from '../ui/Dialog';
import { CircleDot, FolderOpen, HardDrive, Radio, Square, Wifi, WifiOff } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { SectionTitle } from '../ui/Panel';
import { streamAction, useStream } from './stream-store';

/*
 * Going live and recording. Go Live and End always ask first: a stream is
 * public. No key starts or ends one. Recording can go with the stream or
 * without it, and a dropped connection never stops it.
 */

/** Now, once a second (for the time on air). */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(t);
    };
  }, []);
  return now;
}

/** 1:02:03, or 2:03 under an hour. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

function gigabytes(bytes: number | null): string {
  return bytes === null ? '—' : `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function Figure({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-md border border-line bg-panel-2 px-2.5 py-1.5">
      <div className="text-2xs font-bold tracking-wide text-muted uppercase">{label}</div>
      <div className="text-sm text-fg tabular-nums" data-testid={testId}>
        {value}
      </div>
    </div>
  );
}

const healthWords: Record<StreamStatus['live']['health'], string> = {
  good: 'Good',
  struggling: 'Struggling',
  reconnecting: 'Reconnecting',
  off: '—',
};

function GoLiveConfirm({ status, onDone }: { status: StreamStatus; onDone: () => void }) {
  const profile = useStream((s) => s.profiles?.profiles.find((p) => p.id === s.profiles?.activeId));
  const preset = profile ? STREAM_PRESETS[profile.preset] : null;
  return (
    <ConfirmDialog
      title="Go live on YouTube?"
      confirmLabel="Go live"
      confirmVariant="primary"
      testId="go-live-confirm"
      onCancel={onDone}
      onConfirm={() => {
        onDone();
        void streamAction(() => window.drashti.stream.goLive({ confirmed: true }));
      }}
    >
      <p>Everyone with the stream’s link will see and hear it, from now until you end it.</p>
      <p className="text-muted">
        {profile?.name ?? 'Profile'}
        {preset ? ` · ${preset.label} (${preset.height}p)` : ''} · showing{' '}
        {status.layout === 'camera' ? 'the camera and words' : 'the slides'}
      </p>
    </ConfirmDialog>
  );
}

function EndConfirm({ onDone }: { onDone: () => void }) {
  return (
    <ConfirmDialog
      title="End the stream?"
      confirmLabel="End the stream"
      testId="end-confirm"
      onCancel={onDone}
      onConfirm={() => {
        onDone();
        void streamAction(() => window.drashti.stream.end({ confirmed: true }));
      }}
    >
      <p>The stream stops for everyone watching. Recording, if it is on, carries on.</p>
    </ConfirmDialog>
  );
}

export function OnAirControls({ status }: { status: StreamStatus }) {
  const [asking, setAsking] = useState<'live' | 'end' | null>(null);
  const now = useNow();
  const profile = useStream((s) => s.profiles?.profiles.find((p) => p.id === s.profiles?.activeId));
  const live = status.live;
  const on = live.state !== 'off';
  const noKey = profile !== undefined && !profile.hasKey;
  const healthTone =
    live.health === 'good' ? 'text-success-fg' : live.health === 'off' ? 'text-muted' : 'text-warning-fg';
  return (
    <section className="space-y-2" data-testid="stream-on-air">
      <SectionTitle>On air</SectionTitle>
      {status.resume && !on && (
        <Notice
          tone="warning"
          actions={
            <>
              {status.resume.live && (
                <Button size="sm" variant="primary" onClick={() => setAsking('live')}>
                  Go live again
                </Button>
              )}
              <Button size="sm" onClick={() => void window.drashti.stream.dismissResume()}>
                Dismiss
              </Button>
            </>
          }
        >
          Drashti stopped unexpectedly at {new Date(status.resume.stoppedAt).toLocaleTimeString()} while{' '}
          {status.resume.live ? 'on air' : 'recording'} with “{status.resume.profileName}”.
        </Notice>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {on ? (
          <Button
            variant="danger"
            size="lg"
            icon={Square}
            data-testid="end-stream"
            onClick={() => setAsking('end')}
          >
            End the stream…
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            icon={Radio}
            data-testid="go-live"
            disabled={noKey || !status.ffmpeg.available}
            onClick={() => setAsking('live')}
          >
            Go live…
          </Button>
        )}
        <span className="text-sm text-muted" data-testid="stream-live-state" aria-live="polite">
          {live.state === 'live'
            ? 'On air'
            : live.state === 'starting'
              ? 'Starting…'
              : live.state === 'reconnecting'
                ? 'Reconnecting…'
                : 'Not on air'}
        </span>
      </div>
      {noKey && !on && (
        <p className="text-xs text-warning-fg">Paste the stream key in Stream settings to go live.</p>
      )}
      {!status.ffmpeg.available && (
        <Notice tone="danger">
          Drashti’s copy of FFmpeg is missing, so it cannot stream or record. Install Drashti again.
        </Notice>
      )}
      {live.message && (
        <Notice tone={live.state === 'reconnecting' ? 'warning' : 'info'}>
          <span data-testid="stream-live-message">{live.message}</span>
        </Notice>
      )}
      {on && (
        <div className="grid grid-cols-3 gap-2">
          <Figure
            label="On air for"
            value={live.since ? clock(now - live.since) : '—'}
            testId="stream-on-air-for"
          />
          <div className="rounded-md border border-line bg-panel-2 px-2.5 py-1.5">
            <div className="text-2xs font-bold tracking-wide text-muted uppercase">Connection</div>
            <div className={cx('flex items-center gap-1 text-sm', healthTone)} data-testid="stream-health">
              {live.health === 'good' ? (
                <Wifi size={14} aria-hidden="true" />
              ) : (
                <WifiOff size={14} aria-hidden="true" />
              )}
              {healthWords[live.health]}
            </div>
          </div>
          <Figure
            label="Sending"
            value={live.bitrateKbps !== null ? `${(live.bitrateKbps / 1000).toFixed(1)} Mbps` : '—'}
            testId="stream-bitrate"
          />
          <Figure
            label="Frames a second"
            value={live.fps !== null ? live.fps.toFixed(0) : '—'}
            testId="stream-fps"
          />
          <Figure label="Frames dropped" value={String(live.droppedFrames)} testId="stream-dropped" />
          <Figure label="Reconnections" value={String(live.reconnects)} testId="stream-reconnects" />
        </div>
      )}
      {status.encoder && <p className="text-xs text-muted">Encoder: {status.encoder}</p>}
      {asking === 'live' && <GoLiveConfirm status={status} onDone={() => setAsking(null)} />}
      {asking === 'end' && <EndConfirm onDone={() => setAsking(null)} />}
    </section>
  );
}

export function RecordingControls({ status }: { status: StreamStatus }) {
  const now = useNow();
  const rec = status.recording;
  const on = rec.state !== 'off';
  return (
    <section className="space-y-2" data-testid="stream-recording">
      <SectionTitle>Recording</SectionTitle>
      <div className="flex flex-wrap items-center gap-2">
        {on ? (
          <Button
            size="lg"
            icon={Square}
            data-testid="stop-recording"
            onClick={() => void streamAction(() => window.drashti.stream.stopRecording())}
          >
            Stop recording
          </Button>
        ) : (
          <Button
            size="lg"
            icon={CircleDot}
            data-testid="start-recording"
            disabled={!rec.folder || !status.ffmpeg.available}
            onClick={() => void streamAction(() => window.drashti.stream.startRecording())}
          >
            Record
          </Button>
        )}
        <Button
          icon={FolderOpen}
          disabled={on}
          data-testid="recording-folder"
          onClick={() => void streamAction(() => window.drashti.stream.pickFolder())}
        >
          {rec.folder ? 'Change folder…' : 'Choose a folder…'}
        </Button>
      </div>
      <p className="truncate text-xs text-muted" title={rec.folder ?? undefined}>
        {rec.folder ? `Recordings go in ${rec.folder}` : 'Choose where recordings go first.'}
      </p>
      {rec.message && <Notice tone="warning">{rec.message}</Notice>}
      {on && (
        <div className="grid grid-cols-3 gap-2">
          <Figure
            label="Recording for"
            value={rec.since ? clock(now - rec.since) : '—'}
            testId="recording-for"
          />
          <div className="rounded-md border border-line bg-panel-2 px-2.5 py-1.5">
            <div className="text-2xs font-bold tracking-wide text-muted uppercase">Disk free</div>
            <div
              className="flex items-center gap-1 text-sm text-fg tabular-nums"
              data-testid="recording-free"
            >
              <HardDrive size={14} aria-hidden="true" className="text-muted" />
              {gigabytes(rec.freeBytes)}
            </div>
          </div>
          <Figure
            label="Time left"
            value={
              rec.secondsLeft === null
                ? '—'
                : rec.secondsLeft > 99 * 3600
                  ? 'Many hours'
                  : clock(rec.secondsLeft * 1000)
            }
            testId="recording-left"
          />
        </div>
      )}
      {on && rec.file && <p className="truncate text-xs text-faint">File: {rec.file}</p>}
    </section>
  );
}
