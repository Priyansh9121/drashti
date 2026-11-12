import { useEffect, useRef, useState } from 'react';
import { REMOTE_MEDIA_PAGE, type RemoteAudio, type RemoteMediaPage } from '../../../../shared/network-mirror';
import { useEngine } from '../../engine/engine-store';
import { Badge, LiveBadge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { Dialog } from '../../ui/Dialog';
import { TextInput } from '../../ui/Field';
import { Pause, Play, Plus, Undo2 } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { api } from '../device';
import { tap } from '../taps';
import { loadMusic, useMirror } from './mirror-store';
import { musicRowAction } from './music-row';
import { PhoneQuestion } from './PhoneSheet';

const MUSIC = '/api/v1/music';
const playlistPath = (id: string) => MUSIC + '/' + encodeURIComponent(id);
const trackPath = (id: string) => MUSIC + '/tracks/' + encodeURIComponent(id);
const post = (path: string, body?: unknown) => () => api<{ rev?: number }>(path, { method: 'POST', body });

interface Undo {
  words: string;
  path: string;
  body: Record<string, unknown>;
  playlistId: string;
}

export function MusicList() {
  const remote = useMirror((s) => s.music);
  const audio = useEngine((s) => s.state?.layers.audio ?? null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<{ id: string | null; name: string } | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const changing = useRef(false);
  const list = remote?.view.playlists;
  const open = list?.find((p) => p.id === openId);

  async function change(path: string, body: unknown): Promise<RemoteAudio | null> {
    if (changing.current) return null;
    changing.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const r = await api<RemoteAudio>(path, { method: 'POST', body });
      if (!r.ok) {
        setProblem(r.message);
        return null;
      }
      useMirror.setState({ music: r });
      await loadMusic();
      return r;
    } finally {
      changing.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {problem && !editingName && !addingTo && !deleting && (
        <Notice tone="warning" onDismiss={() => setProblem(null)}>
          {problem}
        </Notice>
      )}
      {undo && (
        <Notice tone="info" onDismiss={() => setUndo(null)}>
          <span className="flex flex-wrap items-center gap-2">
            <span>{undo.words}</span>
            <Button
              size="lg"
              className="min-h-12"
              icon={Undo2}
              disabled={busy}
              onClick={() =>
                void change(undo.path, undo.body).then((answer) => {
                  if (!answer) return;
                  setOpenId(undo.playlistId);
                  setUndo(null);
                })
              }
            >
              Undo
            </Button>
          </span>
        </Notice>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="lg"
          icon={Plus}
          className="min-h-12"
          data-testid="remote-audio-new"
          disabled={busy}
          onClick={() => {
            setProblem(null);
            setEditingName({ id: null, name: '' });
          }}
        >
          New audio playlist
        </Button>
        {remote && (
          <Button
            size="lg"
            className="min-h-12"
            aria-pressed={remote.stepsAside}
            disabled={busy}
            onClick={() => void change(MUSIC + '/steps-aside', { on: !remote.stepsAside })}
          >
            Music steps aside
          </Button>
        )}
      </div>
      {list && list.length > 0 && (
        <ul className="space-y-2" aria-label="Audio playlists" data-testid="remote-music-list">
          {list.map((p) => {
            const action = musicRowAction(p.id, audio);
            return (
              <li
                key={p.id}
                data-testid="remote-music-playlist"
                data-playing={action !== 'play' ? 'true' : undefined}
                data-paused={action === 'resume' ? 'true' : undefined}
                className={cx(
                  'flex flex-wrap items-center gap-2 rounded-lg border bg-panel-2 py-1 pr-1 pl-3',
                  action === 'play' ? 'border-line' : 'border-live',
                )}
              >
                <span className="min-w-24 flex-1">
                  <span className="block truncate text-base text-fg">{p.name}</span>
                  <span className="block text-base text-muted">
                    {p.tracks.length} {p.tracks.length === 1 ? 'track' : 'tracks'}
                  </span>
                </span>
                {action === 'pause' && <LiveBadge label="Playing" />}
                {action === 'resume' && <Badge>Paused</Badge>}
                <Button
                  size="lg"
                  className="min-h-12"
                  icon={action === 'pause' ? Pause : Play}
                  aria-label={(action === 'pause' ? 'Pause ' : 'Play ') + p.name}
                  disabled={busy || (action === 'play' && !p.tracks.some((track) => track.playable))}
                  onClick={() => {
                    const path = MUSIC + (action === 'pause' ? '/pause' : '/play');
                    void tap(post(path, action === 'play' ? { playlistId: p.id } : undefined));
                  }}
                >
                  {action === 'pause' ? 'Pause' : 'Play'}
                </Button>
                <Button
                  size="lg"
                  className="min-h-12"
                  aria-expanded={openId === p.id}
                  aria-label={'Edit audio playlist ' + p.name}
                  onClick={() => setOpenId(openId === p.id ? null : p.id)}
                >
                  Edit
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {open && (
        <section
          aria-label={'Edit ' + open.name}
          className="space-y-2 rounded-lg border border-line p-3"
          data-testid="remote-audio-editor"
        >
          <h3 className="text-base font-bold break-words">{open.name}</h3>
          <div className="flex flex-wrap gap-2">
            <Button
              size="lg"
              icon={Plus}
              className="min-h-12"
              data-testid="remote-audio-add"
              disabled={busy}
              onClick={() => {
                setProblem(null);
                setAddingTo(open.id);
              }}
            >
              Add track
            </Button>
            <Button
              size="lg"
              className="min-h-12"
              disabled={busy}
              onClick={() => {
                setProblem(null);
                setEditingName({ id: open.id, name: open.name });
              }}
            >
              Rename playlist
            </Button>
            <Button
              size="lg"
              className="min-h-12"
              disabled={busy}
              onClick={() => {
                setProblem(null);
                setDeleting({ id: open.id, name: open.name });
              }}
            >
              Delete playlist
            </Button>
            {(['loop', 'shuffle'] as const).map((option) => (
              <Button
                key={option}
                size="lg"
                className="min-h-12"
                aria-pressed={open[option]}
                disabled={busy}
                onClick={() =>
                  void change(playlistPath(open.id) + '/options', {
                    loop: open.loop,
                    shuffle: open.shuffle,
                    [option]: !open[option],
                  })
                }
              >
                {option === 'loop' ? 'Loop' : 'Shuffle'}
              </Button>
            ))}
          </div>
          <ol aria-label="Tracks" className="space-y-2">
            {open.tracks.map((track, index) => (
              <li
                key={track.id}
                className="space-y-1 rounded-md bg-panel-2 p-2"
                data-testid="remote-audio-track"
              >
                <p className="text-base break-words">{track.name}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="lg"
                    className="min-h-12"
                    aria-label={`Play track: ${track.name}`}
                    disabled={busy || !track.playable}
                    onClick={() => void tap(post(MUSIC + '/play', { playlistId: open.id, index }))}
                  >
                    Play track
                  </Button>
                  <Button
                    size="lg"
                    className="min-h-12"
                    aria-label={`Move up: ${track.name}`}
                    disabled={busy || index === 0}
                    onClick={() => void change(trackPath(track.id) + '/move', { to: index - 1 })}
                  >
                    Move up
                  </Button>
                  <Button
                    size="lg"
                    className="min-h-12"
                    aria-label={`Move down: ${track.name}`}
                    disabled={busy || index === open.tracks.length - 1}
                    onClick={() => void change(trackPath(track.id) + '/move', { to: index + 1 })}
                  >
                    Move down
                  </Button>
                  <Button
                    size="lg"
                    className="min-h-12"
                    aria-label={`Remove ${track.name}`}
                    disabled={busy}
                    onClick={() =>
                      void change(trackPath(track.id) + '/delete', {}).then((answer) => {
                        if (answer)
                          setUndo({
                            words: 'Removed “' + track.name + '”',
                            path: trackPath(track.id) + '/restore',
                            body: { at: index },
                            playlistId: open.id,
                          });
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
      {editingName && (
        <Dialog
          title={editingName.id ? 'Rename audio playlist' : 'New audio playlist'}
          size="sm"
          onClose={() => setEditingName(null)}
        >
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const name = editingName.name.trim();
              if (!name) return;
              const path = editingName.id ? playlistPath(editingName.id) + '/rename' : MUSIC + '/new';
              void change(path, { name }).then((answer) => {
                if (!answer) return;
                setOpenId(answer.id ?? editingName.id);
                setEditingName(null);
              });
            }}
          >
            <label className="block space-y-1">
              <span className="block text-base">Name</span>
              <TextInput
                className="h-12 w-full text-base"
                data-autofocus
                data-testid="remote-audio-name"
                required
                maxLength={120}
                value={editingName.name}
                onChange={(e) => setEditingName({ ...editingName, name: e.target.value })}
              />
            </label>
            {problem && <Notice tone="warning">{problem}</Notice>}
            <Button type="submit" size="lg" variant="primary" className="min-h-12" disabled={busy}>
              {editingName.id ? 'Save name' : 'Create audio playlist'}
            </Button>
          </form>
        </Dialog>
      )}
      {deleting && (
        <PhoneQuestion
          title={'Delete “' + deleting.name + '”?'}
          safe="Cancel"
          act="Delete"
          testId="remote-audio-delete"
          busy={busy}
          onSafe={() => setDeleting(null)}
          onAct={() =>
            void change(playlistPath(deleting.id) + '/delete', {}).then((answer) => {
              if (!answer) return;
              setUndo({
                words: 'Deleted “' + deleting.name + '”',
                path: playlistPath(deleting.id) + '/restore',
                body: {},
                playlistId: deleting.id,
              });
              setDeleting(null);
              setOpenId(null);
            })
          }
        >
          <p>If it’s playing, the music stops. You can undo this.</p>
          {problem && <Notice tone="warning">{problem}</Notice>}
        </PhoneQuestion>
      )}
      {addingTo && (
        <AudioLibrary
          busy={busy}
          problem={problem}
          onClose={() => setAddingTo(null)}
          onAdd={(mediaId) =>
            void change(playlistPath(addingTo) + '/tracks/add', { mediaIds: [mediaId] }).then((answer) => {
              if (answer) setAddingTo(null);
            })
          }
        />
      )}
    </div>
  );
}

function AudioLibrary({
  busy,
  problem,
  onClose,
  onAdd,
}: {
  busy: boolean;
  problem: string | null;
  onClose: () => void;
  onAdd: (mediaId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [request, setRequest] = useState({ query: '', offset: 0 });
  const [answer, setAnswer] = useState<{ page: RemoteMediaPage } | { message: string } | null>(null);
  useEffect(() => {
    let current = true;
    const params = new URLSearchParams({ kind: 'audio', q: request.query, offset: String(request.offset) });
    void api<RemoteMediaPage>('/api/v1/media?' + params.toString()).then((r) => {
      if (current) setAnswer(r.ok ? { page: r } : { message: r.message });
    });
    return () => {
      current = false;
    };
  }, [request]);
  const find = (query: string, offset: number) => {
    setAnswer(null);
    setRequest({ query, offset });
  };
  const page = answer && 'page' in answer ? answer.page : null;
  return (
    <Dialog title="Add a track" onClose={onClose} testId="remote-audio-library">
      <div className="space-y-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            find(search.trim(), 0);
          }}
        >
          <TextInput
            aria-label="Search sounds"
            placeholder="Search sounds"
            className="h-12 flex-1 text-base"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button type="submit" size="lg" className="min-h-12">
            Search
          </Button>
        </form>
        {problem && <Notice tone="warning">{problem}</Notice>}
        {answer === null && <p role="status">Loading sounds…</p>}
        {answer && 'message' in answer && <Notice tone="warning">{answer.message}</Notice>}
        {page?.media.length === 0 && <p>No sounds match this search.</p>}
        {page && (
          <ul className="space-y-2" aria-label="Sounds">
            {page.media.map((m) => (
              <li key={m.id}>
                <Button
                  size="lg"
                  className="min-h-12 w-full justify-start"
                  wrap
                  disabled={busy || m.missing}
                  onClick={() => onAdd(m.id)}
                >
                  {m.name}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {page && (page.offset > 0 || page.offset + page.media.length < page.total) && (
          <div className="flex gap-2">
            <Button
              size="lg"
              className="min-h-12"
              disabled={page.offset === 0}
              onClick={() => find(request.query, Math.max(0, request.offset - REMOTE_MEDIA_PAGE))}
            >
              Previous sounds
            </Button>
            <Button
              size="lg"
              className="min-h-12"
              disabled={page.offset + page.media.length >= page.total}
              onClick={() => find(request.query, request.offset + REMOTE_MEDIA_PAGE)}
            >
              More sounds
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
