import { useEffect, useMemo, useState } from 'react';
import { type Playing, playingNow } from '../../../shared/engine/playing';
import { playbackAtMs } from '../../../shared/media';
import { dayWords, RESUME_OFFER_MS, type ResumePoint, resumeWords } from '../../../shared/play-history';
import { useEngine } from '../engine/engine-store';
import { dispatch } from '../operator/actions';
import { useNow } from '../render/useNow';
import { Button } from '../ui/Button';
import { RotateCcw } from '../ui/icons';

/*
 * Resume where it stopped (alpha.20: the owner's Q60-34 item 3 and his "Yes, all A" to Q60-39, P1 A and P6 (j) A), under
 * the time bars in both modes: the background video or the sound, 10 minutes or longer, taken off part-way the last time
 * (main/media/play-history.ts keeps where), starts at its start as always, and for its first 30 seconds "Resume at 23:15"
 * is offered. Pressed, it is the engine's own move (as a marker's jump), so every screen, the stream and the sound land
 * there together. Nothing moves by itself, and it is gone once pressed, after 30 seconds, or once it plays past there.
 */

export function ResumeOffers() {
  const state = useEngine((s) => s.state);
  const now = useNow(1000);
  const offered = useMemo(
    () => playingNow(state).filter((p) => p.ref.layer === 'background' || p.ref.layer === 'audio'),
    [state],
  );
  if (offered.length === 0) return null;
  return (
    <>
      {offered.map((p) => (
        <Offer key={`${p.ref.layer}:${p.mediaId}@${String(p.clock.startedAt)}`} playing={p} now={now} />
      ))}
    </>
  );
}

/** One file's offer, for one showing of it. */
function Offer({ playing, now }: { playing: Playing; now: number }) {
  const [point, setPoint] = useState<ResumePoint | null>(null);
  const [pressed, setPressed] = useState(false);
  useEffect(() => {
    let live = true;
    void window.drashti.media.resumePoint(playing.mediaId).then(
      (found) => {
        if (live) setPoint(found);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [playing.mediaId]);
  const length = playing.durationMs;
  if (!point || pressed || length === undefined) return null;
  if (now - playing.clock.startedAt > RESUME_OFFER_MS) return null;
  // Played there (or past it) already: nothing to offer.
  if (playbackAtMs(playing.clock, length, now) >= point.atMs - 2000) return null;
  const day = dayWords(point.at);
  return (
    <div className="px-3 pt-2" data-testid="resume-offer" data-playing={playing.ref.layer}>
      <Button
        size="sm"
        icon={RotateCcw}
        // A show control (alpha.24, the bug hunt's S3-1): it changes the screens at once and never moves.
        instant
        title={day ? `Where it was taken off last time, on ${day}` : 'Where it was taken off last time'}
        onClick={() => {
          setPressed(true);
          void dispatch({ type: 'moveTo', playing: playing.ref, toMs: point.atMs });
        }}
      >
        {resumeWords(point.atMs)}
      </Button>
    </div>
  );
}
