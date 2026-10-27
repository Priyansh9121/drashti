import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { PreviewsContext } from '../../render/previews';
import { Notice } from '../../ui/Notice';
import { api } from '../device';
import { DeviceTimeBar } from './DeviceTimeBar';
import { setPageSize } from './viewer-store';

/*
 * A video played on a phone or tablet at its original quality (Session 54, D1): the file itself, streamed in
 * pieces as it plays (HTTP Range, through a link made for this device and this video, as a <video> cannot send the
 * token), with its sound on this device. Play, Pause and the time bar here never touch the screens. The video's
 * frame, at the width the phone draws it, shows until it plays. A link that stops working while the video is open
 * (Drashti started again) is asked for again, once, and the video goes on from where it was.
 */

/** The video on this device now: what its time bar shows. */
interface Playing {
  mediaId: string | null;
  el: HTMLVideoElement | null;
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

const CANNOT_PLAY = 'This video cannot play on this device. Drashti still plays it on the screens.';

async function linkTo(mediaId: string): Promise<{ url: string } | { problem: string }> {
  const r = await api<{ url: string }>(`/api/v1/media/${encodeURIComponent(mediaId)}/link`);
  return r.ok ? { url: r.url } : { problem: r.message };
}

/** The video, drawn to fill its page (its own shape, once known). */
export function DeviceVideoPicture({ mediaId, pageKey }: { mediaId: string; pageKey: string }) {
  const loader = useContext(PreviewsContext);
  const [url, setUrl] = useState<string | null>(null);
  const resumeAt = useRef<number | null>(null);
  const askedAgain = useRef(false);
  const video = useRef<HTMLVideoElement | null>(null);
  // Its frame as a still while it loads, at the width the page asks for (the loader keeps the sharpest).
  const subscribe = useCallback(
    (then: () => void) => loader?.subscribe(mediaId, then) ?? (() => undefined),
    [loader, mediaId],
  );
  const poster = useSyncExternalStore(subscribe, () => loader?.cached(mediaId) ?? null);
  useEffect(() => {
    void loader?.load(mediaId, 1280);
  }, [loader, mediaId]);
  useEffect(() => {
    let live = true;
    usePlaying.setState({ mediaId, el: null, playing: false, atMs: 0, lengthMs: 0, problem: null });
    askedAgain.current = false;
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
  return (
    <video
      ref={(el) => {
        video.current = el;
        mine({ el });
      }}
      src={url ?? undefined}
      poster={poster ?? undefined}
      playsInline
      preload="metadata"
      disablePictureInPicture
      data-testid="viewer-video"
      data-media-id={mediaId}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
      onLoadedMetadata={(e) => {
        const v = e.currentTarget;
        if (v.videoWidth > 0 && v.videoHeight > 0)
          setPageSize(pageKey, { width: 1920, height: Math.round((1920 * v.videoHeight) / v.videoWidth) });
        if (resumeAt.current !== null) {
          v.currentTime = resumeAt.current;
          resumeAt.current = null;
          void v.play().catch(() => undefined);
        }
        mine({ lengthMs: Number.isFinite(v.duration) ? v.duration * 1000 : 0 });
      }}
      onDurationChange={(e) => {
        const d = e.currentTarget.duration;
        if (Number.isFinite(d)) mine({ lengthMs: d * 1000 });
      }}
      onTimeUpdate={(e) => {
        mine({ atMs: e.currentTarget.currentTime * 1000 });
      }}
      onPlay={() => {
        mine({ playing: true, problem: null });
      }}
      onPause={() => {
        mine({ playing: false });
      }}
      onEnded={() => {
        mine({ playing: false });
      }}
      onError={(e) => {
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
        mine({ playing: false, problem: CANNOT_PLAY });
      }}
    />
  );
}

/** Under the video: its time bar, and what went wrong if it cannot play. */
export function DeviceVideoControls({ mediaId }: { mediaId: string }) {
  const p = usePlaying();
  const here = p.mediaId === mediaId;
  return (
    <div>
      {here && p.problem && (
        <div className="bg-panel px-3 pt-2" data-testid="viewer-video-problem">
          <Notice tone="warning">{p.problem}</Notice>
        </div>
      )}
      <DeviceTimeBar
        currentMs={here ? p.atMs : 0}
        durationMs={here ? p.lengthMs : 0}
        playing={here && p.playing}
        disabled={!here || p.el === null}
        onPlay={() => {
          void usePlaying
            .getState()
            .el?.play()
            .catch(() => undefined);
        }}
        onPause={() => {
          usePlaying.getState().el?.pause();
        }}
        onSeek={(ms) => {
          const el = usePlaying.getState().el;
          if (el) el.currentTime = ms / 1000;
          usePlaying.setState({ atMs: ms });
        }}
      />
    </div>
  );
}
