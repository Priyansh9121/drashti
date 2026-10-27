import { useEffect, useState } from 'react';
import type { RemoteMedia } from '../../../../shared/network-mirror';
import { useEngine } from '../../engine/engine-store';
import { PreviewPicture } from '../../render/previews';
import { LiveBadge, MissingBadge, UnplayableBadge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { Eraser, Image, Music, Video } from '../../ui/icons';
import { api } from '../device';
import { tap } from '../taps';
import { loadMedia, useMirror } from './mirror-store';

/*
 * Media on the phone (Session 54, D5): the library's pictures, videos and sounds, as the operator window's library
 * sheet lists them, by name, 100 at a time, found by a word of their names. One tap puts one up: a picture or a
 * video as the background, the slide taken off, as a playlist's picture item goes up; a sound plays over the rest.
 * The one up says so, with Take off (the background's or the sound's clear). A missing file, or one Drashti cannot
 * play as it is, says so and is not offered. Adding one to a playlist, its markers and converting it stay in Drashti;
 * the video inputs listed with Media there are that computer's own. D4's Add from this Phone… goes at the top.
 */

const KIND_WORD: Record<RemoteMedia['kind'], string> = { image: 'Picture', video: 'Video', audio: 'Sound' };
const KIND_ICON = { image: Image, video: Video, audio: Music } as const;

const post = (path: string) => () => api<{ rev?: number }>(path, { method: 'POST' });

/** What of the library's media is up: the background's, and a sound's (not an audio playlist's track). */
function useUp(): { background: string | null; sound: string | null } {
  const background = useEngine((s) => {
    const b = s.state?.layers.background;
    return b?.kind === 'media' ? b.mediaId : null;
  });
  const sound = useEngine((s) => {
    const a = s.state?.layers.audio;
    return a && !a.music ? a.mediaId : null;
  });
  return { background, sound };
}

function MediaRow({ m, up }: { m: RemoteMedia; up: 'background' | 'audio' | null }) {
  const KindIcon = KIND_ICON[m.kind];
  const can = !m.missing && m.unplayable === null;
  return (
    <li
      className={cx(
        'flex items-center gap-2 rounded-lg border bg-panel-2 pr-1',
        up ? 'border-live' : 'border-line',
      )}
      data-testid="remote-media-item"
      data-media-id={m.id}
      data-live={up ? 'true' : undefined}
    >
      <button
        type="button"
        disabled={!can}
        onClick={() => void tap(post(`/api/v1/media/${encodeURIComponent(m.id)}/show`))}
        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-lg py-1.5 pl-2 text-left disabled:cursor-not-allowed"
      >
        <span
          className="relative flex aspect-video w-16 shrink-0 items-center justify-center overflow-hidden rounded bg-black text-muted"
          data-a11y-picture
          aria-hidden="true"
        >
          {m.kind === 'audio' || !can ? (
            <KindIcon size={20} />
          ) : (
            <PreviewPicture
              mediaId={m.id}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base text-fg" translate="no">
            {m.name}
          </span>
          <span className="flex flex-wrap items-center gap-1.5 text-base text-muted">
            {KIND_WORD[m.kind]}
            {m.missing && <MissingBadge />}
            {!m.missing && m.unplayable !== null && <UnplayableBadge />}
            {up && <LiveBadge label={up === 'audio' ? 'Playing' : 'Live'} />}
          </span>
        </span>
      </button>
      {up && (
        <Button
          size="lg"
          className="min-h-12"
          instant
          icon={Eraser}
          data-testid="remote-media-take-off"
          aria-label={`Take off ${m.name}`}
          onClick={() => void tap(post(`/api/v1/clear/${up === 'audio' ? 'audio' : 'background'}`))}
        >
          Take off
        </Button>
      )}
    </li>
  );
}

export function Media() {
  const media = useMirror((s) => s.media);
  const [typed, setTyped] = useState(media.query);
  const up = useUp();
  // Read the first time Media is shown.
  useEffect(() => {
    if (!useMirror.getState().media.list) void loadMedia();
  }, []);
  // Found a moment after the last key, as the library's search.
  useEffect(() => {
    if (typed.trim() === useMirror.getState().media.query) return;
    const timer = setTimeout(() => {
      void loadMedia({ query: typed });
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [typed]);
  const list = media.list;
  return (
    <section className="space-y-3" aria-labelledby="media-title" data-testid="remote-media">
      <h2 id="media-title" className="text-base font-bold tracking-wider text-muted uppercase">
        Media
      </h2>
      <input
        type="search"
        aria-label="Find a picture, video or sound"
        placeholder="A word of its name"
        value={typed}
        maxLength={200}
        enterKeyHint="search"
        autoCapitalize="off"
        spellCheck={false}
        onChange={(e) => {
          setTyped(e.target.value);
        }}
        className="h-12 w-full rounded-lg border border-field bg-panel-2 px-3 text-base text-fg"
        data-testid="remote-media-search"
      />
      {list === null ? (
        <p role="status" className="text-base text-muted">
          {media.query === '' ? 'Loading the media…' : 'Finding…'}
        </p>
      ) : list.length === 0 ? (
        <p className="text-base text-muted" data-testid="remote-media-none">
          {media.query === ''
            ? 'There are no pictures, videos or sounds yet: they are imported in Drashti on the computer, in Pro Mode.'
            : `Nothing found for “${media.query}”.`}
        </p>
      ) : (
        <>
          <ul
            className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2"
            aria-label="Pictures, videos and sounds"
          >
            {list.map((m) => (
              <MediaRow
                key={m.id}
                m={m}
                up={m.id === up.background ? 'background' : m.id === up.sound ? 'audio' : null}
              />
            ))}
          </ul>
          {list.length < media.total && (
            <Button
              size="lg"
              className="w-full"
              data-testid="remote-media-more"
              onClick={() => void loadMedia({ more: true })}
            >
              Show more ({String(media.total - list.length)} more)
            </Button>
          )}
        </>
      )}
    </section>
  );
}
