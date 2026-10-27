import { useRef } from 'react';
import { formatBytes } from '../../../../shared/format';
import {
  ADD_ACCEPT,
  ADDED_FROM_PHONES,
  type SharedPlaylist,
  sizeWords,
} from '../../../../shared/phone-files';
import type { PlaylistItemInfo } from '../../../../shared/playlists';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { ChevronLeft, ImagePlus } from '../../ui/icons';
import { Progress } from '../../ui/Progress';
import { addFiles, cancelSending, openShared, usePhoneFiles } from './phone-files-store';
import { itemWord, viewable } from './shared-files';
import { lookAtShared } from './shared-pages';
import type { Sending } from './upload-client';

/*
 * Files between Drashti and this phone, in the remote's Library (Session 54, D3 and D4):
 *
 * - Shared from Drashti: the playlists the operator shared with phones, a folder playlist with its folders as its
 *   headers. Tapping a file opens it on this device in D1's viewer, the playlist's other files before and after it
 *   (shared-pages.ts): pictures, videos and sounds at their own quality, a presentation's slides one by one.
 *   Nothing here changes the playlist.
 * - Add to Drashti: while Drashti takes files from phones, "Add from this Phone…" picks pictures, videos, sounds,
 *   PDF, PowerPoint or Keynote files from the phone's photos or files; each is sent whole, with how far it has got,
 *   Cancel, and picking up again by itself after the Wi-Fi drops. Drashti says what became of it.
 *
 * Shown only when there is something to show: a shared playlist, adding on, or a file sent from this page.
 */

const HEADING = 'text-base font-bold tracking-wider text-muted uppercase';

const items = (n: number) => `${String(n)} ${n === 1 ? 'item' : 'items'}`;

function SharedList({ shared }: { shared: SharedPlaylist[] }) {
  return (
    <ul className="space-y-1.5" aria-label="Shared playlists">
      {shared.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            data-testid="remote-shared-playlist"
            onClick={() => void openShared(p.id)}
            className="flex min-h-12 w-full items-center gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2 text-left"
          >
            <span className="min-w-0 flex-1 truncate text-base text-fg">{p.name}</span>
            <span className="shrink-0 text-base text-muted">{items(p.itemCount)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function SharedItems({ playlist, list }: { playlist: SharedPlaylist; list: PlaylistItemInfo[] | null }) {
  const files = (list ?? []).filter(viewable);
  const opening = usePhoneFiles((s) => s.opening);
  const notOpened = usePhoneFiles((s) => s.notOpened);
  return (
    <div className="space-y-2">
      <Button
        size="lg"
        icon={ChevronLeft}
        className="min-h-12"
        data-testid="remote-shared-back"
        onClick={() => void openShared(null)}
      >
        Shared playlists
      </Button>
      <h3 className="truncate text-base font-bold text-fg" data-testid="remote-shared-name">
        {playlist.name}
      </h3>
      {/* A file being opened (its presentations read first), or one Drashti could not give. */}
      {(opening !== null || notOpened !== null) && (
        <p role="status" className="text-base text-muted" data-testid="remote-shared-status">
          {notOpened === null ? 'Opening…' : `Drashti could not open “${notOpened}”.`}
        </p>
      )}
      {list === null ? (
        <p role="status" className="text-base text-muted">
          Opening…
        </p>
      ) : list.length === 0 ? (
        <p className="text-base text-muted">This playlist is empty.</p>
      ) : (
        <ul className="space-y-1.5" aria-label={playlist.name} data-testid="remote-shared-items">
          {list.map((i) =>
            i.kind === 'header' ? (
              <li
                key={i.id}
                className="pt-2 text-base font-bold text-muted"
                data-testid="remote-shared-header"
              >
                {i.label}
              </li>
            ) : (
              <li key={i.id}>
                <button
                  type="button"
                  disabled={!viewable(i)}
                  aria-busy={opening === i.id}
                  data-testid="remote-shared-item"
                  onClick={() => void lookAtShared(playlist, files, files.indexOf(i))}
                  className="flex min-h-12 w-full items-center gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2 text-left disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1 truncate text-base text-fg">{i.label}</span>
                  <Badge>{opening === i.id ? 'Opening…' : itemWord(i)}</Badge>
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function SharedFromDrashti({ shared }: { shared: SharedPlaylist[] | null }) {
  const open = usePhoneFiles((s) => s.open);
  const playlist = open ? shared?.find((p) => p.id === open.id) : undefined;
  return (
    <section className="space-y-2" aria-labelledby="remote-shared-title" data-testid="remote-shared">
      <h2 id="remote-shared-title" className={HEADING}>
        Shared from Drashti
      </h2>
      {open && playlist ? (
        <SharedItems playlist={playlist} list={open.items} />
      ) : shared === null ? (
        <p role="status" className="text-base text-muted">
          Loading what is shared…
        </p>
      ) : shared.length === 0 ? (
        <p className="text-base text-muted" data-testid="remote-shared-none">
          Nothing is shared yet: in Drashti on the computer, right-click a playlist and choose Share with
          Phones and Tablets.
        </p>
      ) : (
        <SharedList shared={shared} />
      )}
    </section>
  );
}

/** How a file being sent stands, in words: how much has gone, and what became of it. */
function sendingWords(s: Sending): string {
  switch (s.state) {
    case 'starting':
      return s.message ?? 'Starting…';
    case 'receiving':
      return `${formatBytes(s.sent)} of ${formatBytes(s.size)} sent${s.slowed ? ', more slowly while Drashti is on air' : ''}`;
    case 'waiting':
      return s.message ?? 'The connection dropped: picking up again…';
    case 'checking':
      return 'All of it sent: Drashti is checking it…';
    case 'importing':
      // A deck waiting for the stream to end says so.
      return s.message ?? 'Drashti is adding it…';
    case 'added':
      return s.message ?? 'Added to Drashti.';
    case 'failed':
      return s.message ?? 'It could not be added.';
    case 'cancelled':
      return 'Cancelled.';
  }
}

/** What a screen reader hears of it: only when its state changes, never each byte. */
function heardWords(file: Sending): string {
  return file.state === 'receiving' ? `Sending ${file.name}` : `${file.name}: ${sendingWords(file)}`;
}

function SendingRow({ s }: { s: Sending }) {
  const going =
    s.state === 'starting' || s.state === 'receiving' || s.state === 'waiting' || s.state === 'checking';
  const ended = s.state === 'added' || s.state === 'failed' || s.state === 'cancelled';
  return (
    <li
      className="space-y-2 rounded-lg border border-line bg-panel-2 p-3"
      data-testid="remote-sending"
      data-state={s.state}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-base text-fg">{s.name}</span>
        {going && (
          <Button
            size="lg"
            className="min-h-12"
            aria-label={`Cancel ${s.name}`}
            data-testid="remote-sending-cancel"
            onClick={() => {
              cancelSending(s.key);
            }}
          >
            Cancel
          </Button>
        )}
      </div>
      {!ended && (
        <Progress
          value={s.size > 0 ? s.sent / s.size : 0}
          label={`How much of ${s.name} is sent`}
          data-testid="remote-sending-progress"
        />
      )}
      <p
        className={cx(
          'text-base',
          s.state === 'added' ? 'text-success-fg' : s.state === 'failed' ? 'text-danger-fg' : 'text-muted',
        )}
        data-testid="remote-sending-words"
      >
        {sendingWords(s)}
      </p>
      <span className="sr-only" aria-live="polite">
        {heardWords(s)}
      </span>
    </li>
  );
}

function AddToDrashti() {
  const adding = usePhoneFiles((s) => s.adding);
  const sending = usePhoneFiles((s) => s.sending);
  const picker = useRef<HTMLInputElement>(null);
  return (
    <section className="space-y-2" aria-labelledby="remote-add-title" data-testid="remote-add">
      <h2 id="remote-add-title" className={HEADING}>
        Add to Drashti
      </h2>
      {adding?.on ? (
        <>
          <p className="text-base text-muted">
            A picture, video, sound, PDF, PowerPoint or Keynote file, up to {sizeWords(adding.maxBytes)}, goes
            whole into Drashti’s playlist “{ADDED_FROM_PHONES}”. It never goes on the screens by itself.
          </p>
          <Button
            size="xl"
            icon={ImagePlus}
            className="w-full"
            data-testid="remote-add-button"
            onClick={() => picker.current?.click()}
          >
            Add from this Phone…
          </Button>
          <input
            ref={picker}
            type="file"
            multiple
            accept={ADD_ACCEPT}
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="remote-add-input"
            onChange={(e) => {
              const chosen = [...(e.target.files ?? [])];
              // The same file can be chosen again later.
              e.target.value = '';
              if (chosen.length > 0) addFiles(chosen);
            }}
          />
        </>
      ) : (
        <p className="text-base text-muted" data-testid="remote-add-off">
          Drashti does not take files from phones now.
        </p>
      )}
      {sending.length > 0 && (
        <ul className="space-y-2" aria-label="Files sent to Drashti" data-testid="remote-sending-list">
          {sending.map((s) => (
            <SendingRow key={s.key} s={s} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Both parts, where there is something to show; `always` (a place of their own, as a choice in the library) shows
 * each with what to do while it is empty.
 */
export function PhoneFiles({ always = false }: { always?: boolean }) {
  const shared = usePhoneFiles((s) => s.shared);
  const adding = usePhoneFiles((s) => s.adding?.on === true);
  const sent = usePhoneFiles((s) => s.sending.length > 0);
  const anyShared = shared !== null && shared.length > 0;
  if (!always && !anyShared && !adding && !sent) return null;
  return (
    <div className="space-y-5 pb-2" data-testid="remote-files">
      {(always || anyShared) && <SharedFromDrashti shared={shared} />}
      {(always || adding || sent) && <AddToDrashti />}
    </div>
  );
}
