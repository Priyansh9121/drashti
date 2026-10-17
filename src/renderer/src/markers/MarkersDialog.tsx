import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { formatDuration } from '../../../shared/format';
import type { MediaMarkers, PlaybackMarker } from '../../../shared/markers';
import { markerTime, parseMarkerTime } from '../../../shared/markers';
import { mediaUrl } from '../../../shared/media';
import type { MediaSummary, PlaylistItemInfo } from '../../../shared/playlists';
import { useEngine } from '../engine/engine-store';
import { useNotice } from '../operator/actions';
import { Button, IconButton } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { KeepChangesDialog } from '../ui/KeepChanges';
import { Field, TextInput } from '../ui/Field';
import { Bookmark, Download, Play, X } from '../ui/icons';
import { plural } from '../ui/text';
import { Checkbox } from '../ui/Toggle';
import { showSave, stopSave, useSaves } from './save-store';
import { Timeline } from './Timeline';

/*
 * Playback markers (Session 14, shared/markers.ts): a video's or sound's
 * start and end points and its named markers, set from the media item in
 * the library (its Markers button), and jumps to them from the live
 * preview. The preview here is silent, as every window but the audio player
 * is: times can be typed, or taken from where the preview is.
 *
 * Session 26e: a video's start and end on a timeline (Timeline.tsx), the
 * part played, I and O for the play head, its new length beside the old,
 * and Save as MP4... (the part copied as it is from the clean frame at or
 * before its start, which the dialog says first).
 */

export const useMarkersDialog = create<{ media: MediaSummary | null }>(() => ({ media: null }));

export function openMarkers(media: MediaSummary): void {
  useMarkersDialog.setState({ media });
}

/** A playlist's media item as this dialog takes it (Session 26e: it opens from a card and the slide grid too). */
export const markersMedia = (item: Extract<PlaylistItemInfo, { kind: 'media' }>): MediaSummary => ({
  id: item.mediaId,
  name: item.label,
  kind: item.media,
  missing: item.missing,
  unplayable: item.unplayable,
  format: null,
  convertedTo: null,
});

const close = () => {
  useMarkersDialog.setState({ media: null });
};

export function MarkersDialog() {
  const media = useMarkersDialog((s) => s.media);
  const [loaded, setLoaded] = useState<{ id: string; markers: MediaMarkers } | null>(null);
  useEffect(() => {
    if (!media) return;
    let live = true;
    void window.drashti.media.markers(media.id).then((markers) => {
      if (live) setLoaded({ id: media.id, markers });
    });
    return () => {
      live = false;
    };
  }, [media]);
  if (!media || loaded?.id !== media.id) return null;
  return <MarkersForm key={media.id} media={media} start={loaded.markers} />;
}

const timeText = (ms: number | null) => (ms === null ? '' : markerTime(ms));

/** Where a part saved from `startMs` begins: the clean frame at or before it (asked once typing stops). */
function useKeyframe(mediaId: string, startMs: number, video: boolean): number | null {
  const [found, setFound] = useState<{ startMs: number; atMs: number | null } | null>(null);
  useEffect(() => {
    // From the very beginning: no clean frame to look for.
    if (!video || startMs <= 0) return;
    let live = true;
    const t = setTimeout(() => {
      void window.drashti.media.keyframe(mediaId, startMs).then((r) => {
        if (live) setFound({ startMs, atMs: r.ok ? r.atMs : null });
      });
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [mediaId, startMs, video]);
  if (startMs <= 0) return 0;
  return found?.startMs === startMs ? found.atMs : null;
}

function MarkersForm({ media, start }: { media: MediaSummary; start: MediaMarkers }) {
  const preview = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [startText, setStartText] = useState(timeText(start.startMs));
  const [endText, setEndText] = useState(timeText(start.endMs));
  const isVideo = media.kind === 'video';
  // The video's length (once its preview knows it), and where the preview is.
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [playheadMs, setPlayheadMs] = useState(0);
  // Playing the part chosen: it stops at the end.
  const [playingPart, setPlayingPart] = useState(false);
  const [addToLibrary, setAddToLibrary] = useState(false);
  const [saveId, setSaveId] = useState<string | null>(null);
  const saveJob = useSaves((s) => (saveId ? (s.jobs.find((j) => j.id === saveId) ?? null) : null));
  const [markers, setMarkers] = useState<PlaybackMarker[]>(start.markers);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  // On the screens or the sound now: saving moves its points at once (the engine refreshes them).
  const playing = useEngine((s) => {
    const layers = s.state?.layers;
    const bg = layers?.background;
    return (bg?.kind === 'media' && bg.mediaId === media.id) || layers?.audio?.mediaId === media.id;
  });
  const shown = () => Math.round((preview.current?.currentTime ?? 0) * 1000);
  // The part chosen, as the timeline draws it (what cannot be read yet: the whole).
  const typedStart = startText.trim() === '' ? 0 : parseMarkerTime(startText);
  const typedEnd = endText.trim() === '' ? durationMs : parseMarkerTime(endText);
  const partStart = Math.max(0, typedStart ?? 0);
  const partEnd = Math.max(
    partStart,
    Math.min(durationMs ?? Number.MAX_SAFE_INTEGER, typedEnd ?? durationMs ?? 0),
  );
  const keyframeMs = useKeyframe(media.id, partStart, isVideo);
  const playPart = () => {
    const v = preview.current;
    if (!v) return;
    v.currentTime = partStart / 1000;
    setPlayingPart(true);
    void v.play();
  };
  const saveMp4 = async () => {
    setProblem(null);
    if ((startText.trim() !== '' && typedStart === null) || (endText.trim() !== '' && typedEnd === null)) {
      setProblem('Write a time as minutes and seconds, for example 1:05.5.');
      return;
    }
    const result = await window.drashti.media.saveTrim({
      mediaId: media.id,
      startMs: startText.trim() === '' ? null : typedStart,
      endMs: endText.trim() === '' ? null : typedEnd,
      addToLibrary,
    });
    if (!result.ok) setProblem(result.message);
    else if (result.job) setSaveId(result.job.id);
  };
  // What closing now would lose: each part typed or changed since it opened.
  const markersMoved =
    markers.filter((m) => !start.markers.some((x) => x.id === m.id && x.name === m.name && x.atMs === m.atMs))
      .length + start.markers.filter((x) => !markers.some((m) => m.id === x.id)).length;
  const lostParts = [
    ...(startText !== timeText(start.startMs) ? ['the start'] : []),
    ...(endText !== timeText(start.endMs) ? ['the end'] : []),
    ...(markersMoved > 0 ? [plural(markersMoved, 'marker')] : []),
    ...(name.trim() !== '' ? ['a new marker’s name'] : []),
  ];
  const requestClose = () => {
    if (lostParts.length > 0) setAsking(true);
    else close();
  };
  const save = async () => {
    const startMs = startText.trim() === '' ? null : parseMarkerTime(startText);
    const endMs = endText.trim() === '' ? null : parseMarkerTime(endText);
    if ((startText.trim() !== '' && startMs === null) || (endText.trim() !== '' && endMs === null)) {
      setProblem('Write a time as minutes and seconds, for example 1:05.5.');
      return;
    }
    const result = await window.drashti.media.setMarkers(media.id, {
      startMs,
      endMs,
      markers: [...markers].sort((a, b) => a.atMs - b.atMs),
    });
    if (result.ok) close();
    else setProblem(result.message);
  };
  const Player = media.kind === 'video' ? 'video' : 'audio';
  return (
    <Dialog
      title={`Start, end and markers: ${media.name}`}
      size={isVideo ? 'lg' : 'md'}
      onClose={requestClose}
      closeLabel="Close markers"
      testId="markers-dialog"
      footer={
        <>
          <Button onClick={requestClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="markers-form" data-testid="markers-save">
            Save
          </Button>
        </>
      }
    >
      <form
        id="markers-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        onKeyDown={(e) => {
          // I and O: the start or the end at the play head (not while typing in a box).
          const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
          if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
          if (e.key === 'i' || e.key === 'I') {
            e.preventDefault();
            setStartText(markerTime(shown()));
          } else if (e.key === 'o' || e.key === 'O') {
            e.preventDefault();
            setEndText(markerTime(shown()));
          }
        }}
      >
        <Player
          ref={preview}
          src={mediaUrl(media.id)}
          controls
          muted
          preload="metadata"
          aria-label={`Preview of ${media.name} (silent)`}
          className={media.kind === 'video' ? 'max-h-56 w-full rounded-md bg-black' : 'w-full'}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) setDurationMs(Math.round(d * 1000));
          }}
          onTimeUpdate={(e) => {
            const now = Math.round(e.currentTarget.currentTime * 1000);
            setPlayheadMs(now);
            // Playing the part: it stops at its end.
            if (playingPart && now >= partEnd) {
              e.currentTarget.pause();
              setPlayingPart(false);
            }
          }}
          onPause={() => {
            setPlayingPart(false);
          }}
        />
        {isVideo && durationMs !== null && (
          <div className="space-y-2">
            <Timeline
              src={mediaUrl(media.id)}
              durationMs={durationMs}
              startMs={partStart}
              endMs={partEnd}
              playheadMs={playheadMs}
              keyframeMs={keyframeMs}
              onStart={(ms) => {
                setStartText(ms <= 0 ? '' : markerTime(ms));
              }}
              onEnd={(ms) => {
                setEndText(ms >= durationMs ? '' : markerTime(ms));
              }}
              onSeek={(ms) => {
                if (preview.current) preview.current.currentTime = ms / 1000;
              }}
            />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <Button type="button" size="sm" icon={Play} data-testid="markers-play-part" onClick={playPart}>
                Play the part
              </Button>
              <span data-testid="markers-length" className="tabular-nums">
                {formatDuration(durationMs)} → <strong>{formatDuration(partEnd - partStart)}</strong>
              </span>
              <span className="text-xs text-muted">
                <kbd className="font-sans font-bold">I</kbd> and <kbd className="font-sans font-bold">O</kbd>:
                the start or the end at the play head
              </span>
            </div>
          </div>
        )}
        <p className="text-xs text-muted">
          It plays between its start and end points wherever it is used (a background video loops between
          them), and the markers can be jumped to while it plays, from under the live picture or a phone. The
          preview is silent: only the audio player makes sound.
        </p>
        <div className="flex flex-wrap gap-4">
          <Field label="Start (empty: the beginning)">
            <div className="flex gap-1.5">
              <TextInput
                data-testid="markers-start"
                value={startText}
                placeholder="0:00.0"
                className="w-24"
                onChange={(e) => setStartText(e.target.value)}
              />
              <Button type="button" size="sm" onClick={() => setStartText(markerTime(shown()))}>
                Here
              </Button>
            </div>
          </Field>
          <Field label="End (empty: the end)">
            <div className="flex gap-1.5">
              <TextInput
                data-testid="markers-end"
                value={endText}
                placeholder="end"
                className="w-24"
                onChange={(e) => setEndText(e.target.value)}
              />
              <Button type="button" size="sm" onClick={() => setEndText(markerTime(shown()))}>
                Here
              </Button>
            </div>
          </Field>
        </div>
        <section className="space-y-2" aria-label="Markers">
          <ul className="space-y-1" data-testid="markers-list">
            {[...markers]
              .sort((a, b) => a.atMs - b.atMs)
              .map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-2 rounded-md border border-line px-2 py-1 text-sm"
                >
                  <Bookmark size={14} aria-hidden="true" className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  <button
                    type="button"
                    className="tabular-nums text-muted underline"
                    aria-label={`Show ${m.name} in the preview`}
                    onClick={() => {
                      if (preview.current) preview.current.currentTime = m.atMs / 1000;
                    }}
                  >
                    {markerTime(m.atMs)}
                  </button>
                  <IconButton
                    icon={X}
                    label={`Remove ${m.name}`}
                    size="sm"
                    onClick={() => setMarkers((was) => was.filter((x) => x.id !== m.id))}
                  />
                </li>
              ))}
          </ul>
          <div className="flex items-end gap-2">
            <Field label="New marker’s name" className="flex-1">
              <TextInput
                data-testid="marker-name"
                value={name}
                maxLength={60}
                placeholder="Chorus"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Button
              type="button"
              data-testid="marker-add"
              disabled={name.trim() === '' || markers.length >= 50}
              onClick={() => {
                setMarkers((was) => [...was, { id: crypto.randomUUID(), name: name.trim(), atMs: shown() }]);
                setName('');
              }}
            >
              Add at the time shown
            </Button>
          </div>
        </section>
        {isVideo && (
          <section className="space-y-2 rounded-md border border-line p-3" aria-label="Save as MP4">
            <p className="text-sm" data-testid="markers-keyframe">
              {partStart <= 0
                ? 'Saved from the beginning.'
                : keyframeMs === null
                  ? 'Finding the nearest clean frame…'
                  : keyframeMs >= partStart
                    ? `Saved from ${markerTime(keyframeMs)}, a clean frame.`
                    : `Saved from ${markerTime(keyframeMs)}, the nearest clean frame.`}{' '}
              <span className="text-muted">
                The part is copied as it is (the picture and the sound unchanged), so it begins at a clean
                frame, at or just before the start.
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Checkbox
                label="Also add it to the library"
                data-testid="markers-add-to-library"
                checked={addToLibrary}
                onChange={(e) => {
                  setAddToLibrary(e.target.checked);
                }}
              />
              <span className="flex-1" />
              <Button
                type="button"
                icon={Download}
                data-testid="markers-save-mp4"
                disabled={saveJob?.state === 'saving' || saveJob?.state === 'waiting'}
                onClick={() => void saveMp4()}
              >
                Save as MP4…
              </Button>
            </div>
            {saveJob && (
              <div
                className="flex flex-wrap items-center gap-2 text-sm"
                data-testid="markers-save-state"
                data-state={saveJob.state}
                role="status"
              >
                <span className="min-w-0 flex-1">
                  {saveJob.state === 'waiting'
                    ? `Waiting to save “${saveJob.name}”${saveJob.note ? `: ${saveJob.note}` : ''}`
                    : saveJob.state === 'saving'
                      ? `Saving “${saveJob.name}”… ${String(Math.round((saveJob.progress ?? 0) * 100))}%`
                      : saveJob.state === 'done'
                        ? `Saved “${saveJob.name}”${saveJob.added ? ', and added to the library' : ''}.`
                        : saveJob.state === 'stopped'
                          ? 'Stopped: nothing was kept.'
                          : `Could not save it: ${saveJob.message ?? ''}`}
                </span>
                {(saveJob.state === 'saving' || saveJob.state === 'waiting') && (
                  <Button type="button" size="sm" onClick={() => void stopSave(saveJob.id)}>
                    Stop
                  </Button>
                )}
                {saveJob.state === 'done' && (
                  <Button type="button" size="sm" onClick={() => void showSave(saveJob.id)}>
                    Show the file
                  </Button>
                )}
              </div>
            )}
          </section>
        )}
        {problem && (
          <p role="alert" className="text-sm text-danger-fg" data-testid="markers-problem">
            {problem}
          </p>
        )}
      </form>
      {asking && (
        <KeepChangesDialog
          name={<>the markers of “{media.name}”</>}
          lost={`You changed ${lostParts.join(', ').replace(/, ([^,]*)$/u, ' and $1')}.`}
          live={
            playing
              ? `“${media.name}” is playing now: saving moves its start, end and markers at once.`
              : undefined
          }
          onKeepEditing={() => {
            setAsking(false);
          }}
          onSave={() => {
            setAsking(false);
            void save();
          }}
          onThrowAway={() => {
            setAsking(false);
            close();
          }}
        />
      )}
    </Dialog>
  );
}

/** Under the live picture: jump the background video or the sound playing to one of its markers. */
export function MarkerJumps() {
  const bg = useEngine((s) => {
    const b = s.state?.layers.background;
    return b?.kind === 'media' ? (b.marks ?? null) : null;
  });
  const audio = useEngine((s) => s.state?.layers.audio?.marks ?? null);
  if (!bg && !audio) return null;
  const jump = (layer: 'background' | 'audio', markerId: string) => {
    void window.drashti.engine.dispatch({ type: 'jumpToMarker', layer, markerId }).then((r) => {
      if (!r.ok) useNotice.setState({ text: r.message });
    });
  };
  const row = (layer: 'background' | 'audio', marks: PlaybackMarker[]) => (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="group"
      aria-label={`Jump the ${layer === 'audio' ? 'sound' : 'background'} to a marker`}
    >
      <span className="text-xs text-muted">{layer === 'audio' ? 'Sound' : 'Background'}:</span>
      {marks.map((m) => (
        <Button
          key={m.id}
          size="sm"
          icon={Bookmark}
          data-testid="marker-jump"
          onClick={() => jump(layer, m.id)}
        >
          {m.name}
        </Button>
      ))}
    </div>
  );
  return (
    <div className="space-y-1.5 px-3 pt-2" data-testid="marker-jumps">
      {bg && row('background', bg)}
      {audio && row('audio', audio)}
    </div>
  );
}
