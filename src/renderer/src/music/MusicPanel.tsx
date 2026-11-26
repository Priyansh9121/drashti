import { useMode } from '../operator/mode-store';
import { useMemo } from 'react';
import { musicLeftMs } from '../../../shared/playlist-playback';
import { useNow } from '../render/useNow';
import { PlaylistFind, useRowFind } from '../playlists/PlaylistFind';
import { exportPlaylistFile, importPlaylistFile } from '../playlists/m3u-actions';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { formatDuration } from '../../../shared/format';
import type { MusicPlaylist } from '../../../shared/music';
import { useEngine } from '../engine/engine-store';
import { SkipButtons } from '../markers/SkipButtons';
import { TrackBar } from '../markers/PlayingBars';
import { skipsOf } from '../markers/skips';
import { connectConversions, jobFor, useConvert } from '../library/convert-store';
import { jobBusy } from '../library/converting';
import { loadMedia, useMedia } from '../library/library-store';
import { Button, IconButton } from '../ui/Button';
import { ConfirmDialog, Dialog } from '../ui/Dialog';
import { TextInput } from '../ui/Field';
import { cx } from '../ui/cx';
import { rowClass } from '../ui/ListRow';
import { isMenuKey, Menu, MenuButton, menuBelow, menuPlace, type MenuPlace } from '../ui/Menu';
import { fileMenuProps } from '../files/FileMenu';
import { trackTarget } from '../files/targets';
import { plural } from '../ui/text';
import {
  ArrowDown,
  ArrowUp,
  Import,
  Link2,
  ListMusic,
  ListPlus,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
} from '../ui/icons';
import { Checkbox } from '../ui/Toggle';
import { Truncate } from '../ui/Truncate';
import {
  clickedMany,
  connectMusic,
  deleteManyMusic,
  deleteMusic,
  musicAction,
  shownMusic,
  takeOutTrack,
  takeOutTracks,
  useMusic,
} from './music-store';
import { isRemoveKey } from '../playlists/playlist-shared';
import { BoxOverlay, boxChoice, ChosenBar, isSelectAll, rowsTouching, useBoxSelect } from '../ui/select-many';
import { createAudioPlaylist, dropSounds, importSounds, takesSounds } from './audio-actions';
import { TrackDelete } from './TrackDelete';
import { TrashButton } from '../ui/TrashButton';
import { openLinkForAudio } from '../links/link-store';

/*
 * Audio playlists (Session 14) in the live column: music on the audio layer,
 * one track after another, independent of the slides (music before the
 * sabha). Choose a list, play from a track, pause, next and previous, go
 * round again, shuffle; make lists from the library's sounds. Simple Mode
 * had none in Session 55 (Part 18), and has them again under its LIVE since
 * Session 56, as Pro Mode does (music/AudioGroup.tsx; the owner: "build
 * nothing new for it, just make it reachable"). Session 55 (Part 13): the lists are
 * straight under Audio, with no Music heading or ? of their own; with none,
 * Audio asks for one: Create playlist, Import sounds…, From a Link… (YouTube
 * as MP3, Dropbox), or sounds dropped there.
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

/** A track that cannot play: “Converting…” while Drashti converts it (Session 50), and it plays after. */
function CannotPlay({ mediaId }: { mediaId: string }) {
  const busy = useConvert((s) => jobBusy(jobFor(s.jobs, mediaId)));
  useEffect(() => {
    connectConversions();
  }, []);
  return (
    <span data-testid={busy ? 'track-converting' : undefined}>{busy ? 'Converting…' : 'Cannot play'}</span>
  );
}

/** The audio playlists, straight under Audio (Session 55, Part 13: no heading of their own). */
export function MusicPanel({ platform = 'darwin' }: { platform?: string } = {}) {
  const pro = useMode((s) => s.mode === 'pro');
  const view = useMusic((s) => s.view);
  const shownId = useMusic((s) => s.shownId);
  const playing = useMusicPlaying();
  // The audio playlists Delete asks about: the shown one, or the chosen ones together (Session 44).
  const [removing, setRemoving] = useState<string[] | null>(null);
  useEffect(() => {
    connectMusic();
  }, []);
  const lists = view?.playlists ?? [];
  const shown = shownMusic(view, shownId, playing?.music?.playlistId ?? null);
  const isShownPlaying = playing?.music?.playlistId === shown?.id;
  const paused = playing?.pausedAtMs !== undefined;
  const skips = useEngine((s) => skipsOf(s.state, 'music'));
  return (
    <div className="space-y-2 px-3 pb-3" data-testid="music-panel">
      {playing && (
        <p className="flex items-center gap-1.5 text-xs" role="status" data-testid="music-now">
          {paused ? <Pause size={12} aria-hidden="true" /> : <Play size={12} aria-hidden="true" />}
          <Truncate text={`${paused ? 'Paused: ' : ''}${playing.title}`} className="min-w-0 flex-1" />
        </p>
      )}
      {/* The track's time bar (Session 54), its elapsed time and time left: a click or a drag moves it. */}
      {playing && <TrackBar />}
      {!shown ? (
        // None yet: it asks for one (Session 55, Part 13), each way in a button, and sounds dropped here start one.
        <AudioDrop playlistId={null} className="rounded-md border border-dashed border-line-strong px-3 py-3">
          <div className="space-y-2" data-testid="music-empty">
            <p className="text-xs text-muted">
              No audio playlists yet. Make one, bring sounds in, or drop sounds here to start one.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" icon={ListPlus} onClick={() => void createAudioPlaylist()}>
                Create playlist
              </Button>
              <Button size="sm" icon={Import} onClick={() => void importSounds(null)}>
                Import sounds…
              </Button>
              <Button
                size="sm"
                icon={Link2}
                title="A sound from YouTube (as MP3) or Dropbox"
                onClick={() => {
                  openLinkForAudio(null);
                }}
              >
                From a Link…
              </Button>
            </div>
          </div>
        </AudioDrop>
      ) : (
        <>
          <AudioPlaylists
            platform={platform}
            lists={lists}
            shown={shown}
            playingId={playing?.music?.playlistId ?? null}
            onDelete={(ids) => {
              setRemoving(ids);
            }}
          />
          {/* One row (Session 51): previous, Play or Pause, next, Back 15 s and Forward 15 s, then loop
              and shuffle. It fits the live column at 1024 wide; dragged narrower, loop and shuffle go to a line of
              their own first. */}
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Play the music">
            <IconButton
              icon={SkipBack}
              label="Previous track"
              disabled={!isShownPlaying}
              onClick={() => void dispatch('musicPrevious')}
            />
            {isShownPlaying && !paused ? (
              <Button
                variant="secondary"
                icon={Pause}
                data-testid="music-pause"
                onClick={() => void dispatch('pauseMusic')}
              >
                Pause
              </Button>
            ) : (
              <Button
                variant="secondary"
                icon={Play}
                data-testid="music-play"
                disabled={shown.tracks.length === 0}
                onClick={() =>
                  void (isShownPlaying
                    ? dispatch('resumeMusic')
                    : musicAction(() => window.drashti.music.play(shown.id)))
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
            {/* Back 15 s, Forward 15 s (Session 50) for the track playing: icons named by their
                tooltips, as previous and next are (with their words, the row would not fit). */}
            <div
              className="flex items-center gap-1"
              role="group"
              aria-label="Move in the track playing"
              data-testid="music-skips"
            >
              <SkipButtons layer="audio" shown={isShownPlaying ? skips : null} compact />
            </div>
            <span className="ml-auto flex items-center gap-1">
              <OptionToggle playlist={shown} option="loop" />
              <OptionToggle playlist={shown} option="shuffle" />
            </span>
          </div>
          {pro && isShownPlaying && playing && <MusicEndsAt playlist={shown} playing={playing} />}
          <AudioDrop playlistId={shown.id}>
            <Tracks
              key={`${shown.id}-${pro ? 'pro' : 'simple'}`}
              platform={platform}
              playlist={shown}
              playingIndex={isShownPlaying ? (playing?.music?.index ?? null) : null}
            />
          </AudioDrop>
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
      {removing && removing.length > 0 && (
        <ConfirmDialog
          title={
            removing.length === 1
              ? `Delete music “${lists.find((p) => p.id === removing[0])?.name ?? ''}”?`
              : `Delete ${String(removing.length)} audio playlists?`
          }
          confirmLabel="Delete"
          onCancel={() => {
            setRemoving(null);
          }}
          onConfirm={() => {
            const ids = removing;
            setRemoving(null);
            const [only] = ids;
            if (ids.length === 1 && only !== undefined)
              void deleteMusic(only, lists.find((p) => p.id === only)?.name ?? '');
            else
              void deleteManyMusic(
                ids,
                ids.map((id) => lists.find((p) => p.id === id)?.name ?? ''),
              );
          }}
        >
          {removing.length === 1 ? 'The list goes' : 'The lists go'}; the sounds stay in the library. If one
          is playing, the music stops. Undo brings {removing.length === 1 ? 'it' : 'them'} back.
        </ConfirmDialog>
      )}
    </div>
  );
}

/** Audio's + (Session 44): exactly two choices, a new audio playlist or sounds from the computer. */
export function AudioAddMenu() {
  const pro = useMode((s) => s.mode === 'pro');
  return (
    <MenuButton
      label="Add to Audio"
      title="Create playlist or import"
      icon={Plus}
      testId="audio-add"
      entries={[
        { label: 'Create playlist', icon: ListPlus, onSelect: () => void createAudioPlaylist() },
        {
          label: 'Import',
          icon: Import,
          onSelect: () => {
            const { view, shownId } = useMusic.getState();
            const id = shownMusic(view, shownId, null)?.id ?? null;
            void (pro ? importPlaylistFile(true, id) : importSounds(id));
          },
        },
      ]}
    />
  );
}

/** Takes sounds dropped on it (files, or sounds from the library's sheet) into `playlistId` (a new one when null). */
function AudioDrop({
  playlistId,
  className,
  children,
}: {
  playlistId: string | null;
  className?: string;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      data-testid="audio-drop"
      data-playlist-id={playlistId ?? undefined}
      className={cx('rounded-md', over && 'outline-2 outline-accent', className)}
      onDragOver={(e) => {
        if (!takesSounds(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        setOver(false);
        dropSounds(e, playlistId);
      }}
    >
      {children}
    </div>
  );
}

/**
 * The audio playlists, one a row (Session 44): the chosen one's sounds are below, with Rename and Delete at the
 * end of its row; each row takes sounds dropped on it.
 */
function AudioPlaylists({
  platform,
  lists,
  shown,
  playingId,
  onDelete,
}: {
  platform: string;
  lists: readonly MusicPlaylist[];
  shown: MusicPlaylist;
  playingId: string | null;
  /** Ask about deleting these. */
  onDelete: (ids: string[]) => void;
}) {
  const pro = useMode((s) => s.mode === 'pro');
  const renamingId = useMusic((s) => s.renamingId);
  const [menu, setMenu] = useState<{ playlist: MusicPlaylist; at: MenuPlace } | null>(null);
  const marked = useMusic((s) => s.markedLists);
  const listRef = useRef<HTMLUListElement>(null);
  const boxBase = useRef<string[]>([]);
  const box = useBoxSelect({
    list: listRef,
    hits: (b) => (listRef.current ? rowsTouching(listRef.current, b) : []),
    begin: () => {
      boxBase.current = useMusic.getState().markedLists;
    },
    onBox: (ids, adding) => {
      const chosen = boxChoice(boxBase.current, ids, adding);
      useMusic.setState({ markedLists: chosen, listAnchor: chosen[0] ?? null });
    },
    onClear: () => {
      useMusic.setState({ markedLists: [], listAnchor: null });
    },
  });
  const many = marked.length > 1;
  /** Delete for this row: the chosen ones together when it is one of them. */
  const deleting = (id: string) => (many && marked.includes(id) ? marked : [id]);
  return (
    <>
      <ChosenBar
        count={marked.length}
        noun="audio playlists"
        onDelete={() => {
          onDelete(marked);
        }}
        onClear={() => {
          useMusic.setState({ markedLists: [], listAnchor: null });
        }}
      />
      <ul
        ref={listRef}
        tabIndex={-1}
        onPointerDown={box.onPointerDown}
        onKeyDown={(e) => {
          if (!isSelectAll(e, platform)) return;
          e.preventDefault();
          const ids = lists.map((p) => p.id);
          useMusic.setState({ markedLists: ids, listAnchor: ids[0] ?? null });
        }}
        className="relative max-h-40 space-y-0.5 overflow-y-auto focus:outline-none"
        aria-label="Audio playlists"
        data-testid="music-playlists"
      >
        <BoxOverlay box={box.box} as="li" />
        {lists.map((p) => {
          const chosen = p.id === shown.id;
          if (renamingId === p.id)
            return (
              <li key={p.id} className="py-0.5">
                <TextInput
                  autoFocus
                  aria-label="Name of the audio playlist"
                  defaultValue={p.name}
                  className="w-full"
                  onFocus={(e) => {
                    e.currentTarget.select();
                  }}
                  onBlur={(e) => {
                    useMusic.setState({ renamingId: null });
                    const name = e.target.value.trim();
                    if (name !== '' && name !== p.name)
                      void musicAction(() => window.drashti.music.rename(p.id, name));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      e.currentTarget.value = p.name;
                      e.currentTarget.blur();
                    }
                  }}
                />
              </li>
            );
          return (
            <li key={p.id} className="group relative" data-select-id={p.id}>
              <AudioDrop playlistId={p.id}>
                <button
                  type="button"
                  data-testid="music-playlist"
                  data-id={p.id}
                  aria-current={chosen ? 'true' : undefined}
                  aria-pressed={many ? marked.includes(p.id) : undefined}
                  className={cx(
                    rowClass({ selected: chosen, marked: many && marked.includes(p.id) }),
                    'flex min-h-9 items-center gap-2 py-1 pl-2.5',
                    chosen ? 'pr-17' : 'pr-2.5',
                  )}
                  onClick={(e) => {
                    const mods = { toggle: platform === 'darwin' ? e.metaKey : e.ctrlKey, range: e.shiftKey };
                    if (mods.toggle || mods.range) {
                      const { markedLists, listAnchor } = useMusic.getState();
                      const next = clickedMany(
                        lists.map((x) => x.id),
                        markedLists,
                        listAnchor,
                        p.id,
                        mods,
                      );
                      useMusic.setState({ markedLists: next.marked, listAnchor: next.anchor });
                      return;
                    }
                    useMusic.setState({ shownId: p.id, markedLists: [p.id], listAnchor: p.id });
                  }}
                  onContextMenu={(e) => {
                    if (!pro) return;
                    e.preventDefault();
                    setMenu({ playlist: p, at: menuPlace(e) });
                  }}
                  onKeyDown={(e) => {
                    if (pro && isMenuKey(e)) {
                      e.preventDefault();
                      setMenu({ playlist: p, at: menuBelow(e.currentTarget) });
                      return;
                    }
                    if (!isRemoveKey(e, platform)) return;
                    e.preventDefault();
                    onDelete(deleting(p.id));
                  }}
                >
                  {playingId === p.id ? (
                    <Play size={13} aria-hidden="true" className="shrink-0 text-live-edge" />
                  ) : (
                    <ListMusic size={13} aria-hidden="true" className="shrink-0 text-muted" />
                  )}
                  <Truncate text={p.name} className="min-w-0 flex-1 text-sm" />
                  <span className="shrink-0 text-xs text-muted">{plural(p.tracks.length, 'sound')}</span>
                </button>
              </AudioDrop>
              {chosen && (
                <span className="absolute top-1 right-1 flex">
                  <IconButton
                    icon={Pencil}
                    label={`Rename “${p.name}”`}
                    size="sm"
                    onClick={() => {
                      useMusic.setState({ renamingId: p.id });
                    }}
                  />
                  <TrashButton
                    label={`Delete music “${p.name}”`}
                    testId="music-delete"
                    onPress={() => {
                      onDelete(deleting(p.id));
                    }}
                  />
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {menu && (
        <Menu
          at={menu.at}
          label={`Audio playlist: ${menu.playlist.name}`}
          onClose={() => {
            setMenu(null);
          }}
          entries={[
            { label: 'Import a Playlist File (M3U)…', onSelect: () => void importPlaylistFile(true) },
            { label: 'Export as M3U…', onSelect: () => void exportPlaylistFile(menu.playlist.id, true) },
          ]}
        />
      )}
    </>
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

function Tracks({
  platform,
  playlist,
  playingIndex,
}: {
  platform: string;
  playlist: MusicPlaylist;
  playingIndex: number | null;
}) {
  const pro = useMode((s) => s.mode === 'pro');
  const playing = useMusicPlaying();
  const listRef = useRef<HTMLOListElement>(null);
  const findRows = useMemo(
    () => playlist.tracks.map((track) => ({ key: track.id, words: `${track.name} ${track.fileName ?? ''}` })),
    [playlist.tracks],
  );
  const find = useRowFind(findRows);
  useEffect(() => {
    if (find.found)
      listRef.current
        ?.querySelector<HTMLElement>(`[data-track-id="${CSS.escape(find.found.key)}"]`)
        ?.scrollIntoView({ block: 'center' });
  }, [find.found]);

  // Many chosen together (Session 44): Cmd/Ctrl and Shift clicks, a box dragged in the list, Cmd-A.
  const all = useMusic((s) => s.markedTracks);
  const ids = playlist.tracks.map((t) => t.id);
  const marked = all.filter((id) => ids.includes(id));
  const many = marked.length > 1;
  const boxBase = useRef<string[]>([]);
  const box = useBoxSelect({
    list: listRef,
    hits: (b) => (listRef.current ? rowsTouching(listRef.current, b) : []),
    begin: () => {
      boxBase.current = useMusic.getState().markedTracks;
    },
    onBox: (touched, adding) => {
      const chosen = boxChoice(boxBase.current, touched, adding);
      useMusic.setState({ markedTracks: chosen, trackAnchor: chosen[0] ?? null });
    },
    onClear: () => {
      useMusic.setState({ markedTracks: [], trackAnchor: null });
    },
  });
  /** Take out the chosen ones (or `one`, when it is not one of them), with one Undo. */
  const takeOut = (one?: string) => {
    const chosen = one !== undefined && !(many && marked.includes(one)) ? [one] : marked;
    const tracks = playlist.tracks.flatMap((t, at) =>
      chosen.includes(t.id) ? [{ id: t.id, at, name: t.name }] : [],
    );
    const [only] = tracks;
    if (tracks.length === 1 && only) void takeOutTrack(only.id, only.at, only.name, playlist.name);
    else void takeOutTracks(tracks, playlist.name);
  };
  if (playlist.tracks.length === 0)
    return (
      <p className="px-1 py-2 text-xs text-muted">
        No sounds in it yet: drop sounds here, or Add sounds… below.
      </p>
    );
  return (
    <>
      {pro && <PlaylistFind label="Find in audio playlist" countTestId="music-find-count" find={find} />}
      <ChosenBar
        count={marked.length}
        noun="sounds"
        deleteLabel="Remove"
        onDelete={() => {
          takeOut();
        }}
        onClear={() => {
          useMusic.setState({ markedTracks: [], trackAnchor: null });
        }}
      />
      <ol
        ref={listRef}
        tabIndex={-1}
        onPointerDown={box.onPointerDown}
        onKeyDown={(e) => {
          if (isSelectAll(e, platform)) {
            e.preventDefault();
            useMusic.setState({ markedTracks: ids, trackAnchor: ids[0] ?? null });
          } else if (e.target === e.currentTarget && isRemoveKey(e, platform) && marked.length > 0) {
            e.preventDefault();
            takeOut();
          }
        }}
        className="relative max-h-56 space-y-1 overflow-y-auto focus:outline-none"
        aria-label={`Tracks of ${playlist.name}`}
        data-testid="music-tracks"
      >
        <BoxOverlay box={box.box} as="li" />
        {playlist.tracks.map((t, i) => {
          const isPlaying =
            playingIndex !== null && playing?.mediaId === t.mediaId && playing.title === t.name;
          const isMarked = marked.includes(t.id);
          return (
            <li
              key={t.id}
              data-testid="music-track"
              data-track-id={t.id}
              data-found={find.found?.key === t.id ? 'true' : undefined}
              data-select-id={t.id}
              data-marked={isMarked ? 'true' : undefined}
              data-playing={isPlaying ? 'true' : undefined}
              // The one right-click menu (Session 55, Part 14): Delete takes it out of this audio playlist only.
              {...fileMenuProps(() =>
                trackTarget({ mediaId: t.mediaId, name: t.name, playable: t.playable }, () => {
                  takeOut(t.id);
                }),
              )}
              className={cx(
                'flex items-center gap-1 rounded-md border px-1.5 py-1',
                find.found?.key === t.id
                  ? 'border-accent bg-panel-2'
                  : isMarked
                    ? 'border-second/70 bg-panel-3'
                    : 'border-line bg-panel-2',
              )}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm disabled:opacity-50"
                disabled={!t.playable}
                aria-label={`Play from ${t.name}`}
                aria-pressed={many ? isMarked : undefined}
                onClick={(e) => {
                  // Cmd/Ctrl and Shift choose (Session 44); a plain click plays from it.
                  const mods = { toggle: platform === 'darwin' ? e.metaKey : e.ctrlKey, range: e.shiftKey };
                  if (mods.toggle || mods.range) {
                    const { markedTracks, trackAnchor } = useMusic.getState();
                    const next = clickedMany(ids, markedTracks, trackAnchor, t.id, mods);
                    useMusic.setState({ markedTracks: next.marked, trackAnchor: next.anchor });
                    return;
                  }
                  useMusic.setState({ markedTracks: [t.id], trackAnchor: t.id });
                  void musicAction(() => window.drashti.music.play(playlist.id, i));
                }}
                onKeyDown={(e) => {
                  if (!isRemoveKey(e, platform)) return;
                  e.preventDefault();
                  takeOut(t.id);
                }}
              >
                {isPlaying ? (
                  <Play size={12} aria-hidden="true" className="shrink-0 text-live-edge" />
                ) : (
                  <span className="w-3 shrink-0 text-right text-xs text-muted tabular-nums">{i + 1}</span>
                )}
                <Truncate text={t.name} className="min-w-0 flex-1" />
                <span className="shrink-0 text-xs text-muted tabular-nums">
                  {!t.playable ? (
                    <CannotPlay mediaId={t.mediaId} />
                  ) : t.durationMs ? (
                    formatDuration(t.durationMs)
                  ) : (
                    ''
                  )}
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
              <TrackDelete
                name={t.name}
                onTakeOut={() => {
                  takeOut(t.id);
                }}
              />
            </li>
          );
        })}
      </ol>
    </>
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

/** Ends at uses the run’s kept order, never a newly drawn shuffle. */
function MusicEndsAt({
  playlist,
  playing,
}: {
  playlist: MusicPlaylist;
  playing: NonNullable<ReturnType<typeof useMusicPlaying>>;
}) {
  const now = useNow(1000);
  const left = musicLeftMs(playing, playlist, now);
  if (playing.music?.loop)
    return (
      <p className="text-xs text-muted" data-testid="music-ends-at">
        Goes round
      </p>
    );
  if (left === null || left <= 0) return null;
  const end = now + left;
  return (
    <p className="text-xs text-muted" data-testid="music-ends-at" data-ends-at={Math.round(end)}>
      Ends at {new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(end)}
    </p>
  );
}
