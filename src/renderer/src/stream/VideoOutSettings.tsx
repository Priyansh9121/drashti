import { useEffect, useState } from 'react';
import type { VideoOutStatus, VideoOutWay } from '../../../shared/video-out';
import { VIDEO_OUT_NAME_MAX } from '../../../shared/video-out';
import { Field, TextInput } from '../ui/Field';
import { Notice } from '../ui/Notice';
import { SectionTitle } from '../ui/Panel';
import { Toggle } from '../ui/Toggle';

/*
 * Stream settings › Send to other software (x30): the stream's picture to other software, off until someone turns
 * it on. Shown only where this computer's Drashti has a way to send (none: nothing shown).
 */

const WAY_WORDS: Record<VideoOutWay, string> = {
  syphon: 'by Syphon, to other apps on this Mac',
  spout: 'by Spout, to other apps on this computer',
  ndi: 'by NDI® on the local network',
  'stand-in': 'to the tests’ stand-in receiver',
};

function stateWords(status: VideoOutStatus): string {
  switch (status.state) {
    case 'off':
      return 'Off';
    case 'starting':
      return 'Starting…';
    case 'sending':
      return status.size
        ? `Sending, ${String(status.size.width)} × ${String(status.size.height)}`
        : 'Sending';
    case 'stopped':
      return 'Stopped';
    case 'unavailable':
      return 'Not available on this computer';
  }
}

export function VideoOutSettings() {
  const [status, setStatus] = useState<VideoOutStatus | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void window.drashti.stream.videoOut().then((s) => {
      if (!live) return;
      setStatus(s);
      setName(s.settings.name);
    });
    const off = window.drashti.stream.onVideoOut((s) => {
      setStatus(s);
    });
    return () => {
      live = false;
      off();
    };
  }, []);
  if (!status?.way) return null;
  const save = async (on: boolean, next: string) => {
    const result = await window.drashti.stream.setVideoOut({ on, name: next });
    if (result.ok) {
      setStatus(result.status);
      setName(result.status.settings.name);
      setError(null);
    } else setError(result.message);
  };
  return (
    <section className="space-y-2" aria-label="Send to other software" data-testid="video-out">
      <SectionTitle>Send to other software</SectionTitle>
      <p className="text-xs text-muted">
        The stream’s picture, as YouTube gets it, {WAY_WORDS[status.way]}. Off until it is turned on; the
        hall’s screens and the stream stay as they are.
      </p>
      <Toggle
        checked={status.settings.on}
        label="Send the stream’s picture"
        data-testid="video-out-switch"
        onChange={(on) => {
          void save(on, name);
        }}
      />
      <Field label="Name other software lists it by" error={error}>
        <TextInput
          value={name}
          maxLength={VIDEO_OUT_NAME_MAX}
          data-testid="video-out-name"
          onChange={(e) => {
            setName(e.target.value);
          }}
          onBlur={() => {
            if (name !== status.settings.name) void save(status.settings.on, name);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name !== status.settings.name) void save(status.settings.on, name);
          }}
        />
      </Field>
      <p className="text-xs text-muted" data-testid="video-out-state" data-state={status.state}>
        {stateWords(status)}
      </p>
      {status.message && <Notice tone="warning">{status.message}</Notice>}
    </section>
  );
}
