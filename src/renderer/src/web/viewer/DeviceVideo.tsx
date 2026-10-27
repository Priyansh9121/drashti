import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SyntheticEvent } from 'react';
import { create } from 'zustand';
import { PreviewsContext } from '../../render/previews';
import { Button } from '../../ui/Button';
import { Music, Pause, Play } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { TimeBar } from '../../ui/TimeBar';
import { api } from '../device';
import { setPageSize } from './viewer-store';

/*
 * A video played on a phone or tablet at its original quality (Session 54, D1): the file itself, streamed in
 * pieces as it plays (HTTP Range, through a link made for this device and this video, as a <video> cannot send the
 * token), with its sound on this device. Play, Pause and the time bar here never touch the screens: the bar is
 * Part B's (ui/TimeBar.tsx, at a finger's size, as a phone shows what plays on the screens), moving this video
 * alone. The video's frame, at the width the phone draws it, shows until it plays. A link that stops working while
 * the video is open (Drashti started again) is asked for again, once, and the video goes on from where it was.
 *
 * A sound in a playlist shared with phones (D3) plays here the same way, its name drawn where a video's picture
 * would be: Drashti sends a sound's file only while a shared playlist has it.
 */

/** The video or sound on this device now: what its time bar shows. */
interface Playing {
  mediaId: string | null;
  el: HTMLMediaElement | null;
  playing: boolean;
  atMs: number;
  lengthMs: number;
  problem: string | null;
}

const usePlaying = create<Playing>(() => ({
  mediaId: null,
  el: null,
  playing: false,
  atMs: 0,
  lengthMs: 0,
  problem: null,
}));

/** A video or a sound: what its bar is called, and what is said when this device cannot play it. */
const WHAT = {
  video: {
    bar: 'The video, on this device only',
    cannot: 'This video cannot play on this device. Drashti still plays it on the screens.',
  },
  sound: {
    bar: 'The sound, on this device only',
    cannot: 'This sound cannot play on this device.',
  },
} as const;

type What = keyof typeof WHAT;

async function linkTo(mediaId: string): Promise<{ url: string } | { problem: string }> {
  const r = await api<{ url: string }>(`/api/v1/media/${encodeURIComponent(mediaId)}/link`);
  return r.ok ? { url: r.url } : { problem: r.message };
}

/**
 * A <video>'s or an <audio>'s own part, as the props it takes: the link to its file, its time, whether it plays
 * and what went wrong, for its time bar; a link out of date asked for again, once. `onMetadata`: its size is known.
 */
function usePlayedHere(mediaId: string, what: What, onMetadata?: (el: HTMLMediaElement) => void) {
  const [url, setUrl] = useState<string | null>(null);
  const resumeAt = useRef<number | null>(null);
  const askedAgain = useRef(false);
  const element = useRef<HTMLMediaElement | null>(null);
  useEffect(() => {
    let live = true;
    // The element is there already (refs are set before effects run): its time bar works from now.
    usePlaying.setState({
      mediaId,
      el: element.current,
      playing: false,
      atMs: 0,
      lengthMs: 0,
      problem: null,
    });
    askedAgain.current = false;
    resumeAt.current = null;
    void linkTo(mediaId).then((got) => {
      if (!live) return;
      if ('url' in got) setUrl(got.url);
      else usePlaying.setState({ problem: got.problem });
    });
    return () => {
      live = false;
      usePlaying.setState({ mediaId: null, el: null, playing: false });
    };
  }, [mediaId]);
  const mine = (patch: Partial<Playing>) => {
    if (usePlaying.getState().mediaId === mediaId) usePlaying.setState(patch);
  };
  return {
    ref: (el: HTMLMediaElement | null) => {
      element.current = el;
      mine({ el });
    },
    src: url ?? undefined,
    preload: 'metadata',
    'data-media-id': mediaId,
    onLoadedMetadata: (e: SyntheticEvent<HTMLMediaElement>) => {
      const v = e.currentTarget;
      onMetadata?.(v);
      if (resumeAt.current !== null) {
        v.currentTime = resumeAt.current;
        resumeAt.current = null;
        void v.play().catch(() => undefined);
      }
      mine({ lengthMs: Number.isFinite(v.duration) ? v.duration * 1000 : 0 });
    },
    onDurationChange: (e: SyntheticEvent<HTMLMediaElement>) => {
      const d = e.currentTarget.duration;
      if (Number.isFinite(d)) mine({ lengthMs: d * 1000 });
    },
    onTimeUpdate: (e: SyntheticEvent<HTMLMediaElement>) => {
      mine({ atMs: e.currentTarget.currentTime * 1000 });
    },
    onPlay: () => {
      mine({ playing: true, problem: null });
    },
    onPause: () => {
      mine({ playing: false });
    },
    onEnded: () => {
      mine({ playing: false });
    },
    onError: (e: SyntheticEvent<HTMLMediaElement>) => {
      const v = e.currentTarget;
      // A link out of date (Drashti started again since): a new one, once, on from where it was.
      if (!askedAgain.current && v.currentTime > 0) {
        askedAgain.current = true;
        resumeAt.current = v.currentTime;
        void linkTo(mediaId).then((got) => {
          if ('url' in got) setUrl(got.url);
          else mine({ problem: got.problem });
        });
        return;
      }
      mine({ playing: false, problem: WHAT[what].cannot });
    },
  } as const;
}

/** The video, drawn to fill its page (its own shape, once known). */
export function DeviceVideoPicture({ mediaId, pageKey }: { mediaId: string; pageKey: string }) {
  const loader = useContext(PreviewsContext);
  // Its frame as a still while it loads, at the width the page asks for (the loader keeps the sharpest).
  const subscribe = useCallback(
    (then: () => void) => loader?.subscribe(mediaId, then) ?? (() => undefined),
    [loader, mediaId],
  );
  const poster = useSyncExternalStore(subscribe, () => loader?.cached(mediaId) ?? null);
  useEffect(() => {
    void loader?.load(mediaId, 1280);
  }, [loader, mediaId]);
  const played = usePlayedHere(mediaId, 'video', (v) => {
    if (v instanceof HTMLVideoElement && v.videoWidth > 0 && v.videoHeight > 0)
      setPageSize(pageKey, { width: 1920, height: Math.round((1920 * v.videoHeight) / v.videoWidth) });
  });
  return (
    <video
      {...played}
      poster={poster ?? undefined}
      playsInline
      disablePictureInPicture
      data-testid="viewer-video"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
    />
  );
}

/** A sound's page, drawn small and zoomed to fit (pages.tsx): its name under a note, as large as the page allows. */
export const SOUND_PAGE = { width: 480, height: 320 };

/** A sound from a playlist shared with phones (D3): its name, played on this device with the bar under it. */
export function DeviceSound({ mediaId, name }: { mediaId: string; name: string }) {
  const played = usePlayedHere(mediaId, 'sound');
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
      <Music size={64} aria-hidden="true" className="text-muted" />
      <p className="text-2xl break-words text-fg" translate="no">
        {name}
      </p>
      <audio {...played} data-testid="viewer-audio" />
    </div>
  );
}

/** Under the video or sound: Play or Pause and its time bar, and what went wrong if it cannot play. */
export function DeviceVideoControls({ mediaId, what = 'video' }: { mediaId: string; what?: What }) {
  const p = usePlaying();
  const here = p.mediaId === mediaId;
  const playing = here && p.playing;
  return (
    <div>
      {here && p.problem && (
        <div className="bg-panel px-3 pt-2" data-testid="viewer-video-problem">
          <Notice tone="warning">{p.problem}</Notice>
        </div>
      )}
      <div
        className="flex min-w-0 items-center gap-3 border-t border-line bg-panel px-3 py-2"
        data-testid="viewer-time-bar"
      >
        <Button
          size="lg"
          className="min-h-12"
          icon={playing ? Pause : Play}
          disabled={!here || p.el === null}
          data-testid="viewer-play"
          onClick={() => {
            const el = usePlaying.getState().el;
            if (playing) el?.pause();
            else void el?.play().catch(() => undefined);
          }}
        >
          {playing ? 'Pause' : 'Play'}
        </Button>
        {/* B's bar, its length dimmed until the file says it; a tap or a drag moves it on this device only. */}
        <TimeBar
          className="min-w-0 flex-1"
          size="lg"
          label={WHAT[what].bar}
          testId="viewer-track"
          atMs={here ? p.atMs : 0}
          durationMs={here && p.lengthMs > 0 ? p.lengthMs : null}
          onMove={(ms) => {
            const el = usePlaying.getState().el;
            if (el) el.currentTime = ms / 1000;
            usePlaying.setState({ atMs: ms });
          }}
        />
      </div>
    </div>
  );
}
