import { useEffect, useState } from 'react';
import { formatDuration } from '../../../shared/format';
import type { MusicPlaylist } from '../../../shared/music';
import { useEngine } from '../engine/engine-store';
import { loadMedia, useMedia } from '../library/library-store';
import { useNow } from '../render/useNow';
import { engineNow } from '../render/clock';
import { Button, IconButton } from '../ui/Button';
import { ConfirmDialog, Dialog } from '../ui/Dialog';
import { Select, TextInput } from '../ui/Field';
import {
  ArrowDown,
  ArrowUp,
  ListMusic,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  X,
} from '../ui/icons';
import { Panel } from '../ui/Panel';
import { Checkbox } from '../ui/Toggle';
import { Truncate } from '../ui/Truncate';
import { connectMusic, musicAction, useMusic } from './music-store';

/*
 * Audio playlists (Session 14) in the live column: music on the audio layer,
 * one track after another, independent of the slides (music before the
 * sabha). Choose a list, play from a track, pause, next and previous, go
 * round again, shuffle; make lists from the library's sounds. Simple Mode
 * has only Play and Pause (MusicStrip).
 */

/** What the audio layer is playing from an audio playlist, if anything. */
export function useMusicPlaying() {
  return useEngine((s) => {
    const a = s.state?.layers.audio;
    return a?.music ? a : null;
  });
}

const dispatch = (type: 'pauseMusic' | 'resumeMusic' | 'musicNext' | 'musicPrevious') =>
  window.drashti.engine.dispatch({ type });

/** "2:31 left" for the track playing (paused: where it is); it ticks only while it shows. */
function TimeLeft() {
  const a = useMusicPlaying();
  useNow(1000);
  if (!a?.durationMs) return null;
  const into = a.pausedAtMs ?? engineNow() - a.startedAt;
  return (
    <span className="shrink-0 text-muted tabular-nums">{`${formatDuration(Math.max(0, a.durationMs - into))} left`}</span>
  );
}

export function MusicPanel() {
  const view = useMusic((s) => s.view);
  const shownId = useMusic((s) => s.shownId);
  const playing = useMusicPlaying();
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);
  useEffect(() => {
    connectMusic();
  }, []);
  const lists = view?.playlists ?? [];
  const shown =
    lists.find((p) => p.id === shownId) ??
    lists.find((p) => p.id === playing?.music?.playlistId) ??
    lists.find((p) => p.id === view?.lastId) ??
    lists[0] ??
    null;
  const isShownPlaying = playing?.music?.playlistId === shown?.id;
  const paused = playing?.pausedAtMs !== undefined;
  return (
    <Panel
      help="music"
      title="Music"
      icon={ListMusic}
      collapsible
      remember="music"
      bodyClassName="space-y-2 px-3 pb-3"
      data-testid="music-panel"
      actions={
        <Button
          variant="ghost"
          size="sm"
          icon={Plus}
          data-testid="music-new"
          onClick={() => void musicAction(() => window.drashti.music.create('Music before sabha'))}
        >
          New
        </Button>
      }
    >
      {playing && (
        <p className="flex items-center gap-1.5 text-xs" role="status" data-testid="music-now">
          {paused ? <Pause size={12} aria-hidden="true" /> : <Play size={12} aria-hidden="true" />}
          <Truncate text={`${paused ? 'Paused: ' : ''}${playing.title}`} className="min-w-0 flex-1" />
          <TimeLeft />
        </p>
      )}
      {!shown ? (
        <p className="text-xs text-muted">
          No music yet. <strong>New</strong> makes a list of sounds from the library to play one after another
          (before the sabha, say), apart from the slides.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-1.5">
            {renaming ? (
              <TextInput
                autoFocus
                aria-label="Name of the music"
                defaultValue={shown.name}
                className="min-w-0 flex-1"
                onBlur={(e) => {
                  setRenaming(false);
                  void musicAction(() => window.drashti.music.rename(shown.id, e.target.value));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') setRenaming(false);
                }}
              />
            ) : (
              <Select
                aria-label="Which music"
                className="min-w-0 flex-1"
                data-testid="music-choose"
                value={shown.id}
                onChange={(e) => {
                  useMusic.setState({ shownId: e.target.value });
                }}
              >
                {lists.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
            <IconButton icon={Pencil} label="Rename" size="sm" onClick={() => setRenaming(true)} />
            <IconButton icon={Trash2} label="Remove this music" size="sm" onClick={() => setRemoving(true)} />
          </div>
          <div className="flex items-center gap-1.5" role="group" aria-label="Play the music">
            <IconButton
              icon={SkipBack}
              label="Previous track"
              disabled={!isShownPlaying}
              onClick={() => void dispatch('musicPrevious')}
            />
            {isShownPlaying && !paused ? (
              <Button
                variant="primary"
                icon={Pause}
                data-testid="music-pause"
                onClick={() => void dispatch('pauseMusic')}
              >
                Pause
              </Button>
            ) : (
              <Button
                variant="primary"
                icon={Play}
                data-testid="music-play"
                disabled={shown.tracks.length === 0}
                onClick={() =>
                  void (isShownPlaying
                    ? dispatch('resumeMusic')
                    : musicAction(() => window.drashti.music.play(shown.id, 0)))
                }
              >
                Play
              </Button>
            )}
            <IconButton
              icon={SkipForward}
              label="Next track"
              disabled={!isShownPlaying}
              onClick={() => void dispatch('musicNext')}
            />
            <span className="flex-1" />
            <OptionToggle playlist={shown} option="loop" />
            <OptionToggle playlist={shown} option="shuffle" />
          </div>
          <Tracks playlist={shown} playingIndex={isShownPlaying ? (playing?.music?.index ?? null) : null} />
          <Button
            size="sm"
            icon={Plus}
            data-testid="music-add"
            onClick={() => {
              useMusic.setState({ adding: true });
            }}
          >
            Add sounds…
          </Button>
        </>
      )}
      <AddSoundsDialog playlistId={shown?.id ?? null} />
      {removing && shown && (
        <ConfirmDialog
          title={`Remove “${shown.name}”?`}
          confirmLabel="Remove"
          onCancel={() => setRemoving(false)}
          onConfirm={() => {
            setRemoving(false);
            void musicAction(() => window.drashti.music.remove(shown.id));
          }}
        >
          The list goes; its sounds stay in the library. If it is playing, the music stops.
        </ConfirmDialog>
      )}
    </Panel>
  );
}

function OptionToggle({ playlist, option }: { playlist: MusicPlaylist; option: 'loop' | 'shuffle' }) {
  const on = playlist[option];
  return (
    <IconButton
      icon={option === 'loop' ? Repeat : Shuffle}
      label={
        option === 'loop'
          ? on
            ? 'Going round again at the end (press to stop at the end)'
            : 'Stops at the end (press to go round again)'
          : on
            ? 'Shuffled (press to play in order, from the next Play)'
            : 'In order (press to shuffle, from the next Play)'
      }
      size="sm"
      aria-pressed={on}
      data-testid={`music-${option}`}
      className={on ? 'text-accent' : 'text-muted'}
      onClick={() =>
        void musicAction(() =>
          window.drashti.music.setOptions(playlist.id, {
            loop: option === 'loop' ? !on : playlist.loop,
            shuffle: option === 'shuffle' ? !on : playlist.shuffle,
          }),
        )
      }
    />
  );
}

function Tracks({ playlist, playingIndex }: { playlist: MusicPlaylist; playingIndex: number | null }) {
  const playing = useMusicPlaying();
  if (playlist.tracks.length === 0)
    return <p className="text-xs text-muted">No sounds in it yet: Add sounds… below.</p>;
  return (
    <ol
      className="max-h-56 space-y-1 overflow-y-auto"
      aria-label={`Tracks of ${playlist.name}`}
      data-testid="music-tracks"
    >
      {playlist.tracks.map((t, i) => {
        const isPlaying = playingIndex !== null && playing?.mediaId === t.mediaId && playing.title === t.name;
        return (
          <li
            key={t.id}
            data-testid="music-track"
            data-playing={isPlaying ? 'true' : undefined}
            className="flex items-center gap-1 rounded-md border border-line bg-panel-2 px-1.5 py-1"
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm disabled:opacity-50"
              disabled={!t.playable}
              aria-label={`Play from ${t.name}`}
              onClick={() => void musicAction(() => window.drashti.music.play(playlist.id, i))}
            >
              {isPlaying ? (
                <Play size={12} aria-hidden="true" className="shrink-0 text-live" />
              ) : (
                <span className="w-3 shrink-0 text-right text-xs text-muted tabular-nums">{i + 1}</span>
              )}
              <Truncate text={t.name} className="min-w-0 flex-1" />
              <span className="shrink-0 text-xs text-muted tabular-nums">
                {!t.playable ? 'Cannot play' : t.durationMs ? formatDuration(t.durationMs) : ''}
              </span>
            </button>
            <IconButton
              icon={ArrowUp}
              label="Up"
              size="sm"
              disabled={i === 0}
              onClick={() => void musicAction(() => window.drashti.music.moveTrack(t.id, i - 1))}
            />
            <IconButton
              icon={ArrowDown}
              label="Down"
              size="sm"
              disabled={i === playlist.tracks.length - 1}
              onClick={() => void musicAction(() => window.drashti.music.moveTrack(t.id, i + 1))}
            />
            <IconButton
              icon={X}
              label={`Take ${t.name} out`}
              size="sm"
              onClick={() => void musicAction(() => window.drashti.music.removeTrack(t.id))}
            />
          </li>
        );
      })}
    </ol>
  );
}

/** Add sounds from the media library to the list (ticked, in the library's order). */
function AddSoundsDialog({ playlistId }: { playlistId: string | null }) {
  const adding = useMusic((s) => s.adding);
  const media = useMedia((s) => s.media);
  const [ticked, setTicked] = useState<string[]>([]);
  useEffect(() => {
    if (adding) void loadMedia();
  }, [adding]);
  if (!adding || !playlistId) return null;
  const sounds = media.filter((m) => m.kind === 'audio');
  const close = () => {
    setTicked([]);
    useMusic.setState({ adding: false });
  };
  return (
    <Dialog
      title="Add sounds"
      size="md"
      onClose={close}
      closeLabel="Close add sounds"
      testId="music-add-dialog"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            data-testid="music-add-ticked"
            disabled={ticked.length === 0}
            onClick={() => {
              void musicAction(() => window.drashti.music.addTracks(playlistId, ticked, null)).then((r) => {
                if (r.ok) close();
              });
            }}
          >
            Add {ticked.length > 0 ? String(ticked.length) : ''}
          </Button>
        </>
      }
    >
      {sounds.length === 0 ? (
        <p className="text-sm text-muted">
          The library has no sounds yet: import some (MP3, M4A, WAV) by dragging them onto the library.
        </p>
      ) : (
        <ul className="max-h-96 space-y-1 overflow-y-auto" aria-label="Sounds in the library">
          {sounds.map((m) => (
            <li key={m.id}>
              <Checkbox
                label={m.name}
                checked={ticked.includes(m.id)}
                disabled={m.missing || m.unplayable !== null}
                onChange={(e) => {
                  setTicked((was) => (e.target.checked ? [...was, m.id] : was.filter((x) => x !== m.id)));
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

/** Simple Mode's music: Play and Pause, for the list played last (or the first). */
export function MusicStrip() {
  const view = useMusic((s) => s.view);
  const playing = useMusicPlaying();
  useEffect(() => {
    connectMusic();
  }, []);
  const lists = view?.playlists ?? [];
  if (lists.length === 0) return null;
  const name = playing?.music?.name ?? lists.find((p) => p.id === view?.lastId)?.name ?? lists[0]?.name ?? '';
  const paused = playing?.pausedAtMs !== undefined;
  return (
    <div
      className="mx-3 mt-3 flex items-center gap-3 rounded-lg border border-line bg-panel-2 p-2"
      data-testid="simple-music"
    >
      <ListMusic size={22} aria-hidden="true" className="shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <Truncate text={`Music: ${name}`} className="text-base font-medium" />
        {playing && (
          <Truncate text={`${paused ? 'Paused: ' : ''}${playing.title}`} className="text-sm text-muted" />
        )}
      </div>
      {playing && !paused ? (
        <Button
          size="lg"
          icon={Pause}
          data-testid="simple-music-pause"
          onClick={() => void dispatch('pauseMusic')}
        >
          Pause music
        </Button>
      ) : (
        <Button
          size="lg"
          icon={Play}
          data-testid="simple-music-play"
          onClick={() => void musicAction(() => window.drashti.music.play(null))}
        >
          Play music
        </Button>
      )}
    </div>
  );
}
