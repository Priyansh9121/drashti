import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import type { MediaMarkers, PlaybackMarker } from '../../../shared/markers';
import { markerTime, parseMarkerTime } from '../../../shared/markers';
import { mediaUrl } from '../../../shared/media';
import type { MediaSummary } from '../../../shared/playlists';
import { useEngine } from '../engine/engine-store';
import { useNotice } from '../operator/actions';
import { Button, IconButton } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, TextInput } from '../ui/Field';
import { Bookmark, X } from '../ui/icons';

/*
 * Playback markers (Session 14, shared/markers.ts): a video's or sound's
 * start and end points and its named markers, set from the media item in
 * the library (its Markers button), and jumps to them from the live
 * preview. The preview here is silent, as every window but the audio player
 * is: times can be typed, or taken from where the preview is.
 */

export const useMarkersDialog = create<{ media: MediaSummary | null }>(() => ({ media: null }));

export function openMarkers(media: MediaSummary): void {
  useMarkersDialog.setState({ media });
}

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

function MarkersForm({ media, start }: { media: MediaSummary; start: MediaMarkers }) {
  const preview = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [startText, setStartText] = useState(timeText(start.startMs));
  const [endText, setEndText] = useState(timeText(start.endMs));
  const [markers, setMarkers] = useState<PlaybackMarker[]>(start.markers);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const shown = () => Math.round((preview.current?.currentTime ?? 0) * 1000);
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
      size="md"
      onClose={close}
      closeLabel="Close markers"
      testId="markers-dialog"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
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
      >
        <Player
          ref={preview}
          src={mediaUrl(media.id)}
          controls
          muted
          preload="metadata"
          aria-label={`Preview of ${media.name} (silent)`}
          className={media.kind === 'video' ? 'max-h-56 w-full rounded-md bg-black' : 'w-full'}
        />
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
            <Field label="New marker's name" className="flex-1">
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
        {problem && (
          <p role="alert" className="text-sm text-danger-fg" data-testid="markers-problem">
            {problem}
          </p>
        )}
      </form>
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
