import { useEffect, useId, useRef, useState } from 'react';
import {
  FULL_LEVELS,
  silentWords,
  SOUND_KINDS,
  type SoundKind,
  type SoundLevel,
} from '../../../shared/sound';
import { useEngine } from '../engine/engine-store';
import { useNotice } from '../operator/actions';
import { cx } from '../ui/cx';
import { Volume2, VolumeX } from '../ui/icons';
import { latestSender } from './latest-sender';

/*
 * The sound's two levels (X33, the owner's ask of 19 Nov 2026: "a volume button for both audio and video ... including a
 * mute checkbox like a green or red toggle"), just above Audio under LIVE, in Pro and Simple Mode alike: Audio's (the
 * audio playlists and every sound) and Video's (the videos' sound), each 0 to 100 % with its switch, green with "Sound
 * on" or red with "Muted", an icon on each, so it never rests on colour alone. What they are is the engine's state
 * (shared/sound.ts), the one place every page that plays sound reads; the status bar says what is muted (MutedStatus).
 */

const NAMES: Readonly<Record<SoundKind, string>> = { audio: 'Audio', video: 'Video' };

/** How long a level just moved shows where the hand left it, before the engine's word on it (ms). */
const SETTLE_MS = 600;

async function sendLevel(kind: SoundKind, level: number): Promise<void> {
  const result = await window.drashti.sound.setLevel(kind, level);
  if (!result.ok) useNotice.setState({ text: result.message });
}

/** Each level as it moves: a few a second at most, ending where it is let go (latest-sender.ts). */
const senders: Readonly<Record<SoundKind, (level: number) => void>> = {
  audio: latestSender((level) => void sendLevel('audio', level)),
  video: latestSender((level) => void sendLevel('video', level)),
};

async function setMuted(kind: SoundKind, muted: boolean): Promise<void> {
  const result = await window.drashti.sound.setMuted(kind, muted);
  if (!result.ok) useNotice.setState({ text: result.message });
}

export function SoundLevels() {
  const levels = useEngine((s) => s.state?.sound?.levels) ?? FULL_LEVELS;
  return (
    <div role="group" aria-label="Sound levels" className="space-y-1.5 px-3 py-2" data-testid="sound-levels">
      {SOUND_KINDS.map((kind) => (
        <LevelLine key={kind} kind={kind} level={levels[kind]} />
      ))}
    </div>
  );
}

/** One level: its name, its slider and its percent, and its switch. */
function LevelLine({ kind, level }: { kind: SoundKind; level: SoundLevel }) {
  const id = useId();
  const said = Math.round(level.level * 100);
  // Where the hand left it, until the engine has said it (a moment after the last move).
  const [moving, setMoving] = useState<number | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (settle.current) clearTimeout(settle.current);
    },
    [],
  );
  const shown = moving ?? said;
  return (
    <div className="flex min-w-0 items-center gap-2" data-testid={`sound-level-${kind}`}>
      <span id={`${id}-name`} className="w-10 shrink-0 text-sm font-medium text-fg">
        {NAMES[kind]}
      </span>
      <input
        id={`${id}-level`}
        type="range"
        min={0}
        max={100}
        step={1}
        value={shown}
        aria-labelledby={`${id}-name`}
        aria-valuetext={`${String(shown)} %`}
        data-testid={`sound-level-${kind}-slider`}
        onChange={(e) => {
          const value = Number(e.target.value);
          setMoving(value);
          senders[kind](value / 100);
          if (settle.current) clearTimeout(settle.current);
          settle.current = setTimeout(() => {
            settle.current = null;
            setMoving(null);
          }, SETTLE_MS);
        }}
        // 24 px tall, a target (WCAG 2.5.8; targets, alpha.24: 6 px until then) in the 28 px row its Mute switch gives
        // the line; the track is drawn as before, in the middle (targets-24.spec.ts).
        className="h-6 min-w-16 flex-1 cursor-pointer accent-primary"
      />
      <output htmlFor={`${id}-level`} className="w-10 shrink-0 text-right text-xs text-muted tabular-nums">
        {`${String(shown)} %`}
      </output>
      <MuteSwitch kind={kind} muted={level.muted} nameId={`${id}-name`} />
    </div>
  );
}

/**
 * A level's switch: on, its sound plays (green, "Sound on"); off, it is muted (red, "Muted"), at once, with a short
 * ramp, never stopping what plays; on again, it plays at its level. Its name is the level's and its words.
 */
function MuteSwitch({ kind, muted, nameId }: { kind: SoundKind; muted: boolean; nameId: string }) {
  const wordsId = useId();
  const Icon = muted ? VolumeX : Volume2;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!muted}
      aria-labelledby={`${nameId} ${wordsId}`}
      data-testid={`sound-mute-${kind}`}
      data-space-next=""
      data-muted={muted ? 'true' : 'false'}
      onClick={() => void setMuted(kind, !muted)}
      className={cx(
        'inline-flex h-7 w-24 shrink-0 items-center justify-center gap-1 rounded-md border px-1.5 text-xs font-bold',
        muted ? 'border-danger bg-danger-bg text-danger-fg' : 'border-success bg-success-bg text-success-fg',
      )}
    >
      <Icon size={14} aria-hidden="true" className="shrink-0" />
      <span id={wordsId}>{muted ? 'Muted' : 'Sound on'}</span>
    </button>
  );
}

/**
 * What cannot be heard, said in the status bar in red while it is (X33), so the hall is never silent unseen: a kind
 * muted, or left at 0 % (shared/sound.ts silentWords).
 */
export function MutedStatus() {
  const levels = useEngine((s) => s.state?.sound?.levels);
  const words = silentWords(levels);
  return (
    <span
      role="status"
      data-testid="sound-muted-status"
      className={cx(
        'shrink-0',
        words !== '' &&
          'flex items-center gap-1.5 rounded-sm border border-danger bg-danger-bg px-1.5 py-0.5 font-bold text-danger-fg',
      )}
    >
      {words !== '' && <VolumeX size={13} aria-hidden="true" className="shrink-0" />}
      {words}
    </span>
  );
}
