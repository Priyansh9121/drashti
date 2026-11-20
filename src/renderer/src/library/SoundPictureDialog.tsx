import { useEffect, useState } from 'react';
import {
  DELAY_MS,
  delayWords,
  NO_PLAYBACK_SETTINGS,
  type PlaybackSettings,
  TONE_DB,
} from '../../../shared/playback-settings';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { RotateCcw } from '../ui/icons';
import { addSoundPictureToMenu, closeSoundPicture, playbackKeeper, useSoundPicture } from './sound-picture';

/*
 * Sound and picture… (alpha.20: the owner's Q60-34 and his "Yes, all A" to Q60-39 P2 A and P6 (a) A): a video's or a
 * sound's own Bass and Treble (−12 to +12 dB), Voice boost, and its sound's and captions' delay against the picture
 * (−2 to +2 s in 10 ms steps), kept with the file wherever it plays, heard alike in the hall and on the stream (never on
 * the stream's microphones). Each change is kept as it is made and eases in while it plays. Reset puts them all back.
 */

const dbWords = (db: number): string =>
  db === 0 ? '0 dB' : `${db > 0 ? '+' : '−'}${String(Math.abs(db))} dB`;

export function SoundPictureDialog() {
  const file = useSoundPicture((s) => s.file);
  useEffect(() => {
    addSoundPictureToMenu();
  }, []);
  if (!file) return null;
  return <SoundPictureWindow key={file.id} id={file.id} name={file.name} video={file.kind === 'video'} />;
}

function SoundPictureWindow({ id, name, video }: { id: string; name: string; video: boolean }) {
  const [settings, setSettings] = useState<PlaybackSettings | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [keeping] = useState(() =>
    playbackKeeper(id, (mediaId, next) => window.drashti.media.setPlayback(mediaId, next), setProblem),
  );
  useEffect(() => {
    let live = true;
    void window.drashti.media.playback(id).then(
      (kept) => {
        if (live) setSettings(kept ?? NO_PLAYBACK_SETTINGS);
      },
      () => undefined,
    );
    return () => {
      live = false;
      keeping.close();
    };
  }, [id, keeping]);
  /** Shown at once; kept a moment after the last change. */
  const change = (next: PlaybackSettings) => {
    setSettings(next);
    keeping.keep(next);
  };
  const s = settings ?? NO_PLAYBACK_SETTINGS;
  const slider = (
    key: 'bassDb' | 'trebleDb' | 'soundDelayMs' | 'captionDelayMs',
    label: string,
    range: { min: number; max: number; step: number },
    words: string,
  ) => (
    <div className="space-y-1" data-setting={key}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <label htmlFor={`sound-picture-${key}`} className="font-medium text-fg">
          {label}
        </label>
        <span className="text-muted tabular-nums" data-testid={`sound-picture-${key}-words`}>
          {words}
        </span>
      </div>
      <input
        id={`sound-picture-${key}`}
        type="range"
        className="w-full"
        min={range.min}
        max={range.max}
        step={range.step}
        value={s[key]}
        aria-valuetext={words}
        disabled={settings === null}
        onChange={(e) => {
          change({ ...s, [key]: Number(e.currentTarget.value) });
        }}
      />
    </div>
  );
  return (
    <Dialog
      title={`Sound and picture: ${name}`}
      onClose={closeSoundPicture}
      size="md"
      testId="sound-picture"
      footer={
        <>
          <Button
            icon={RotateCcw}
            disabled={settings === null}
            onClick={() => {
              change(NO_PLAYBACK_SETTINGS);
            }}
          >
            Reset
          </Button>
          <Button variant="primary" onClick={closeSoundPicture}>
            Done
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Kept with this file wherever it plays, heard alike in the hall and on the stream; never on the
          stream’s microphones.
        </p>
        {slider('bassDb', 'Bass', { ...TONE_DB, step: 1 }, dbWords(s.bassDb))}
        {slider('trebleDb', 'Treble', { ...TONE_DB, step: 1 }, dbWords(s.trebleDb))}
        <label className="flex items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            checked={s.voice}
            disabled={settings === null}
            onChange={(e) => {
              change({ ...s, voice: e.currentTarget.checked });
            }}
          />
          Voice boost (clearer speech: less rumble, a lift where voices are)
        </label>
        {slider('soundDelayMs', 'Sound delay', DELAY_MS, delayWords(s.soundDelayMs, 'sound'))}
        {video &&
          slider('captionDelayMs', 'Caption delay', DELAY_MS, delayWords(s.captionDelayMs, 'captions'))}
        {problem && (
          <p className="text-sm text-danger-fg" role="alert" data-testid="sound-picture-problem">
            {problem}
          </p>
        )}
      </div>
    </Dialog>
  );
}
