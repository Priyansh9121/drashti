import { useEffect, useState } from 'react';
import type { AiPlaylistReview } from '../../../shared/ai';
import { useMode } from '../operator/mode-store';
import { loadTree } from '../playlists/playlist-store';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, TextInput } from '../ui/Field';
import { Checkbox } from '../ui/Toggle';
import { Notice } from '../ui/Notice';
import { useAi } from './ai-store';
function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function PlaylistReview({ close }: { close: () => void }) {
  const [date, setDate] = useState(today);
  const [past, setPast] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [review, setReview] = useState<AiPlaylistReview | null>(null);
  const [name, setName] = useState('');
  const [rows, setRows] = useState<string[]>([]);
  const [waiting, setWaiting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let closed = false;
    void window.drashti.ai.past().then(
      (result) => {
        if (!closed) {
          if (result.ok) setPast(result.value);
          else setProblem(result.message);
        }
      },
      () => {
        if (!closed) setProblem('Past sabhas could not be read. Try again.');
      },
    );
    return () => {
      closed = true;
    };
  }, []);
  const suggest = async () => {
    setWaiting(true);
    setReview(null);
    setProblem(null);
    try {
      const result = await window.drashti.ai.playlist({
        date,
        pastIds: selected,
        requestId: crypto.randomUUID(),
      });
      if (result.ok) {
        setReview(result.value);
        setName(result.value.name);
        setRows(result.value.rows.map((row) => row.id));
      } else setProblem(result.message);
    } catch {
      setProblem('The suggestion could not finish. Your playlists have not changed.');
    } finally {
      setWaiting(false);
    }
  };
  const make = async () => {
    if (!review) return;
    setWaiting(true);
    setProblem(null);
    try {
      const result = await window.drashti.ai.approvePlaylist({ id: review.id, name, rows });
      if (result.ok) {
        await loadTree();
        close();
      } else setProblem(result.message);
    } catch {
      setProblem('The playlist could not be made. Ask for a new suggestion.');
    } finally {
      setWaiting(false);
    }
  };
  const move = (id: string, by: number) => {
    setRows((current) => {
      const next = [...current];
      const at = next.indexOf(id);
      const to = at + by;
      if (at < 0 || to < 0 || to >= next.length) return current;
      next.splice(at, 1);
      next.splice(to, 0, id);
      return next;
    });
  };
  return (
    <Dialog
      title="Playlist suggestions"
      size="lg"
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            disabled={waiting || !review || !rows.length || !name.trim()}
            onClick={() => void make()}
          >
            Make playlist
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">
        Choose past sabhas to draw from. Review the order and remove anything you do not want before making a
        new playlist.
      </p>
      <Field label="Sabha date">
        <TextInput
          type="date"
          value={date}
          disabled={waiting}
          onChange={(e) => {
            setDate(e.target.value);
            setReview(null);
          }}
        />
      </Field>
      <fieldset className="space-y-1 rounded border border-line p-2">
        <legend className="px-1 text-sm font-bold">Past sabhas</legend>
        {past.length === 0 && (
          <p className="text-xs text-muted">Make a playlist first, then choose it here after a sabha.</p>
        )}
        <div className="max-h-32 space-y-1 overflow-y-auto">
          {past.map((item) => (
            <div key={item.id}>
              <Checkbox
                label={item.name}
                checked={selected.includes(item.id)}
                disabled={waiting || (selected.length >= 50 && !selected.includes(item.id))}
                onChange={(e) => {
                  setSelected((ids) =>
                    e.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id),
                  );
                  setReview(null);
                }}
              />
            </div>
          ))}
        </div>
      </fieldset>
      <Button disabled={waiting || !date || selected.length === 0} onClick={() => void suggest()}>
        {waiting ? 'Checking…' : 'Suggest playlist'}
      </Button>
      {review && (
        <section className="space-y-2" aria-label="Review suggested playlist">
          <Field label="Playlist name">
            <TextInput
              value={name}
              maxLength={200}
              disabled={waiting}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <p className="text-xs text-muted">
            {review.calendar
              ? `Calendar: ${review.calendar}`
              : 'No calendar entry for this date. Using the past sabha you chose.'}
          </p>
          <ol className="max-h-52 space-y-2 overflow-y-auto">
            {rows.map((id, index) => {
              const row = review.rows.find((item) => item.id === id);
              if (!row) return null;
              return (
                <li
                  key={id}
                  data-testid="playlist-suggestion-row"
                  className="flex flex-wrap items-center gap-1 rounded border border-line p-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm">{row.label}</p>
                    <p className="text-xs text-muted">From {row.source}</p>
                  </div>
                  <Button
                    size="sm"
                    disabled={waiting || index === 0}
                    aria-label="Move suggestion up"
                    onClick={() => move(id, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    disabled={waiting || index === rows.length - 1}
                    aria-label="Move suggestion down"
                    onClick={() => move(id, 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    size="sm"
                    disabled={waiting}
                    onClick={() => setRows((current) => current.filter((item) => item !== id))}
                  >
                    Remove suggestion
                  </Button>
                </li>
              );
            })}
          </ol>
        </section>
      )}
      {problem && <Notice tone="danger">{problem}</Notice>}
    </Dialog>
  );
}
export function AiPlaylist() {
  const enabled = useAi((s) => s.settings.playlist);
  const pro = useMode((s) => s.mode === 'pro');
  const [open, setOpen] = useState(false);
  if (!enabled || !pro) return null;
  return (
    <>
      <Button size="sm" className="mx-2 my-1" onClick={() => setOpen(true)}>
        Suggest a playlist
      </Button>
      {open && <PlaylistReview close={() => setOpen(false)} />}
    </>
  );
}
