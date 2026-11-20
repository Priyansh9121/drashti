import { useEffect, useRef, useState } from 'react';
import { mediaUrl, STILL_WIDTH } from '../../../shared/media';
import type { SoundTrack } from '../../../shared/media-details';
import {
  PLAIN_VIDEO_EDIT,
  parseVideoEditTime,
  videoEditRecipeSchema,
  videoEditTime,
  type VideoEditSnapshot,
  type VideoEditFrame,
} from '../../../shared/video-edit';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Select, Slider, TextInput } from '../ui/Field';
import { refreshStill } from '../render/stills';
import { addEditVideoToMenu, closeEditVideo, useEditVideo } from './edit-video';

export function EditVideoDialog() {
  const file = useEditVideo((s) => s.file);
  useEffect(() => addEditVideoToMenu(), []);
  useEffect(() => window.drashti.media.onVideoEdit((edit) => refreshStill(edit.mediaId)), []);
  return file ? <LoadEditor key={file.id} mediaId={file.id} name={file.name} /> : null;
}

function LoadEditor({ mediaId, name }: { mediaId: string; name: string }) {
  const [edit, setEdit] = useState<VideoEditSnapshot | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void window.drashti.media.videoEdit(mediaId).then(
      (result) => {
        if (!active) return;
        if (result.ok) {
          setEdit(result.edit);
          setProblem(null);
        } else setProblem(result.message);
      },
      () => {
        if (active) setProblem('The video editor could not open. Close it and try again.');
      },
    );
    return () => {
      active = false;
    };
  }, [mediaId, attempt]);
  if (edit) return <Editor initial={edit} name={name} />;
  return (
    <Dialog
      title={`Edit Video: ${name}`}
      onClose={closeEditVideo}
      testId="edit-video"
      footer={
        <>
          <Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
          <Button onClick={closeEditVideo}>Cancel</Button>
        </>
      }
    >
      <p role={problem ? 'alert' : 'status'}>{problem ?? 'Opening the video…'}</p>
    </Dialog>
  );
}

async function thumbnail(video: HTMLVideoElement): Promise<Uint8Array> {
  if (video.seeking)
    await new Promise<void>((resolve, reject) => {
      video.addEventListener('seeked', () => resolve(), { once: true });
      video.addEventListener('error', () => reject(new Error('The chosen frame could not be read.')), {
        once: true,
      });
    });
  if (video.readyState < 2 || video.videoWidth <= 0)
    throw new Error('Wait for the preview to show its frame, then choose it again.');
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(STILL_WIDTH, video.videoWidth);
  canvas.height = Math.max(1, Math.round((canvas.width * video.videoHeight) / video.videoWidth));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('The thumbnail could not be drawn. Try choosing the frame again.');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!blob) throw new Error('The thumbnail could not be kept. Try choosing the frame again.');
  return new Uint8Array(await blob.arrayBuffer());
}

const sections = ['Trim', 'Picture', 'Sound', 'Playback'] as const;
type Section = (typeof sections)[number];

function Editor({ initial, name }: { initial: VideoEditSnapshot; name: string }) {
  const [kept, setKept] = useState(initial);
  const [draft, setDraft] = useState(() => structuredClone(initial.recipe));
  const [section, setSection] = useState<Section>('Trim');
  const [duration, setDuration] = useState<number | null>(null);
  const [position, setPosition] = useState(0);
  const [jump, setJump] = useState('0:00');
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [jpeg, setJpeg] = useState<Uint8Array | undefined>();
  const [tracks, setTracks] = useState<SoundTrack[]>([]);
  const video = useRef<HTMLVideoElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(kept.recipe) || jpeg !== undefined;
  useEffect(
    () =>
      window.drashti.media.onVideoEdit((next) => {
        if (next.mediaId === kept.mediaId && next.revision === kept.revision) setKept(next);
      }),
    [kept.mediaId, kept.revision],
  );
  useEffect(() => {
    let active = true;
    void window.drashti.media.details(initial.mediaId).then(
      (result) => {
        if (active && result.ok) setTracks(result.details.read?.sounds ?? []);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [initial.mediaId]);
  const close = () => {
    video.current?.pause();
    closeEditVideo();
  };
  const requestClose = () => {
    if (!saving) {
      if (dirty) setDiscard(true);
      else close();
    }
  };
  const seek = (ms: number) => {
    const player = video.current;
    if (!player || !Number.isFinite(ms) || ms < 0 || (duration !== null && ms > duration)) return;
    player.pause();
    player.currentTime = ms / 1000;
    setPosition(ms);
    setJump(videoEditTime(ms));
  };
  const save = async (): Promise<boolean> => {
    if (saving) return false;
    const checked = videoEditRecipeSchema.safeParse(draft);
    if (!checked.success) {
      setProblem('Check the crop, time, speed and fade fields, then try Save again.');
      return false;
    }
    const start = draft.trim.startMs ?? 0;
    const end = draft.trim.endMs ?? duration;
    if (duration !== null && (start >= duration || (end !== null && (end > duration || end <= start)))) {
      setProblem('The start and end must be inside the video, with the end after the start.');
      return false;
    }
    if (end !== null && Object.values(draft.fades).some((ms) => ms > (end - start) / draft.speed)) {
      setProblem('A fade is longer than this video’s playing time. Shorten the fade, then Save again.');
      return false;
    }
    setSaving(true);
    setProblem(null);
    try {
      const result = await window.drashti.media.setVideoEdit({
        mediaId: kept.mediaId,
        revision: kept.revision,
        recipe: checked.data,
        ...(jpeg ? { thumbnailJpeg: jpeg } : {}),
      });
      if (!result.ok) {
        setProblem(result.message);
        return false;
      }
      setKept(result.edit);
      setDraft(structuredClone(result.edit.recipe));
      setJpeg(undefined);
      refreshStill(result.edit.mediaId);
      return true;
    } catch {
      setProblem('The video edits could not be saved. Keep this window open and try Save again.');
      return false;
    } finally {
      setSaving(false);
    }
  };
  const number = (
    label: string,
    value: number,
    change: (n: number) => void,
    min: number,
    max: number,
    step = 0.01,
  ) => (
    <Field key={label} label={label}>
      <TextInput
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const n = e.currentTarget.valueAsNumber;
          if (Number.isFinite(n)) change(n);
        }}
      />
    </Field>
  );
  const pictureNumber = (
    key: 'zoom' | 'x' | 'y' | 'brightness' | 'contrast' | 'colour',
    label: string,
    min: number,
    max: number,
  ) =>
    number(
      label,
      draft.picture[key],
      (n) => setDraft((r) => ({ ...r, picture: { ...r.picture, [key]: n } })),
      min,
      max,
    );
  const chooseThumb = async () => {
    const player = video.current;
    if (!player) return;
    player.pause();
    try {
      const bytes = await thumbnail(player);
      setJpeg(bytes);
      setDraft((r) => ({ ...r, thumbnailMs: Math.round(player.currentTime * 1000) }));
      setProblem(null);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Choose the thumbnail frame again.');
    }
  };
  return (
    <>
      <Dialog
        title={`Edit Video: ${name}`}
        onClose={requestClose}
        size="full"
        testId="edit-video"
        bodyClassName="min-h-0 overflow-auto"
        footer={
          <>
            <Button
              disabled={saving}
              onClick={() => {
                setDraft(structuredClone(PLAIN_VIDEO_EDIT));
                setJpeg(undefined);
                setProblem(null);
              }}
            >
              Reset edits
            </Button>
            <Button disabled={saving} onClick={requestClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={saving || (!dirty && kept.state !== 'failed')}
              onClick={() => {
                void save();
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Edits are kept with this library video for its next showing. A video already on the screens keeps
            playing as it was. Your original stays untouched.
          </p>
          <p className="text-sm font-medium" role="status" data-testid="edit-video-status">
            {kept.state === 'preparing'
              ? 'Preparing'
              : kept.state === 'failed'
                ? 'Could not prepare the video'
                : 'Ready for next showing'}
          </p>
          {kept.state === 'preparing' && (
            <p className="text-xs text-muted">
              Preparation waits while a show, stream or recording is running.
            </p>
          )}
          {kept.message && (
            <p className="text-sm text-danger-fg" role="alert">
              {kept.message}
            </p>
          )}
          <div className="mx-auto w-full max-w-xl overflow-hidden rounded-md bg-black">
            <video
              ref={video}
              data-testid="edit-video-preview"
              aria-label="Private source preview"
              crossOrigin="anonymous"
              muted
              playsInline
              preload="auto"
              src={mediaUrl(initial.mediaId)}
              className="h-44 w-full object-contain"
              onLoadedMetadata={(e) => {
                const player = e.currentTarget;
                if (Number.isFinite(player.duration)) setDuration(Math.round(player.duration * 1000));
                player.currentTime = (initial.recipe.trim.startMs ?? 0) / 1000;
              }}
              onTimeUpdate={(e) => setPosition(Math.round(e.currentTarget.currentTime * 1000))}
              onError={() =>
                setProblem(
                  'The source preview could not play. Check Media information, then try opening the video again.',
                )
              }
            />
          </div>
          <p className="text-xs text-muted">
            Private source preview · sound off · {videoEditTime(position)}
            {duration === null ? '' : ` / ${videoEditTime(duration)}`}
          </p>
          <fieldset disabled={saving} className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Go to time" hint="m:ss.mmm or h:mm:ss.mmm">
                <TextInput
                  value={jump}
                  onChange={(e) => setJump(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    const ms = parseVideoEditTime(jump);
                    if (ms === null || (duration !== null && ms > duration))
                      setProblem('Type a time inside the video, such as 1:23.500.');
                    else {
                      setProblem(null);
                      seek(ms);
                    }
                  }}
                />
              </Field>
              <Button
                onClick={() => {
                  const ms = parseVideoEditTime(jump);
                  if (ms === null || (duration !== null && ms > duration))
                    setProblem('Type a time inside the video, such as 1:23.500.');
                  else {
                    setProblem(null);
                    seek(ms);
                  }
                }}
              >
                Jump
              </Button>
              <Button
                onClick={() => {
                  const player = video.current;
                  if (player) {
                    if (player.paused)
                      void player
                        .play()
                        .catch(() => setProblem('The preview could not start. Try opening the video again.'));
                    else player.pause();
                  }
                }}
              >
                Play / pause preview
              </Button>
            </div>
            <Field label="Trim timeline">
              <Slider
                min={0}
                max={duration ?? 1}
                step={1}
                value={Math.min(position, duration ?? 1)}
                disabled={duration === null}
                className="w-full"
                format={videoEditTime}
                onChange={(e) => seek(Number(e.currentTarget.value))}
              />
            </Field>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Video edit sections">
              {sections.map((s) => (
                <Button key={s} aria-pressed={section === s} onClick={() => setSection(s)}>
                  {s}
                </Button>
              ))}
            </div>
            <section aria-label={section} className="space-y-3 rounded-md border border-line p-3">
              <h3 className="text-sm font-semibold">{section}</h3>
              {section === 'Trim' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    {number(
                      'Start (seconds)',
                      (draft.trim.startMs ?? 0) / 1000,
                      (n) => setDraft((r) => ({ ...r, trim: { ...r.trim, startMs: Math.round(n * 1000) } })),
                      0,
                      (duration ?? 86400000) / 1000,
                      0.001,
                    )}
                    {number(
                      'End (seconds)',
                      (draft.trim.endMs ?? duration ?? 0) / 1000,
                      (n) => setDraft((r) => ({ ...r, trim: { ...r.trim, endMs: Math.round(n * 1000) } })),
                      0,
                      (duration ?? 86400000) / 1000,
                      0.001,
                    )}
                  </div>
                  <p className="text-xs text-muted">
                    These times are in the source video. Existing playlist row trims stay with their row.
                  </p>
                  <Button
                    onClick={() => {
                      void chooseThumb();
                    }}
                  >
                    Use this frame as library thumbnail
                  </Button>
                  <p className="text-xs text-muted">
                    {draft.thumbnailMs === null
                      ? 'The library uses its usual thumbnail.'
                      : `Chosen library frame: ${videoEditTime(draft.thumbnailMs)}`}
                  </p>
                </>
              )}
              {section === 'Picture' && (
                <>
                  <Field
                    label="Frame shape"
                    hint="Original shape follows your crop and rotation. Choose a fixed frame for blurred fill."
                  >
                    <Select
                      value={draft.picture.frame ?? 'source'}
                      onChange={(e) => {
                        const frame = e.currentTarget.value as VideoEditFrame;
                        setDraft((r) => ({ ...r, picture: { ...r.picture, frame } }));
                      }}
                    >
                      <option value="source">Original shape</option>
                      <option value="16:9">16:9</option>
                      <option value="4:3">4:3</option>
                      <option value="1:1">Square (1:1)</option>
                      <option value="9:16">Vertical (9:16)</option>
                    </Select>
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() =>
                        setDraft((r) => ({
                          ...r,
                          picture: {
                            ...r.picture,
                            turn: ((r.picture.turn + 90) % 360) as 0 | 90 | 180 | 270,
                            flipX: r.picture.flipY,
                            flipY: r.picture.flipX,
                            crop: {
                              x: 1 - r.picture.crop.y - r.picture.crop.h,
                              y: r.picture.crop.x,
                              w: r.picture.crop.h,
                              h: r.picture.crop.w,
                            },
                          },
                        }))
                      }
                    >
                      Rotate 90°
                    </Button>
                    <Button
                      onClick={() =>
                        setDraft((r) => ({
                          ...r,
                          picture: {
                            ...r.picture,
                            flipX: !r.picture.flipX,
                            crop: { ...r.picture.crop, x: 1 - r.picture.crop.x - r.picture.crop.w },
                          },
                        }))
                      }
                    >
                      Flip across
                    </Button>
                    <Button
                      onClick={() =>
                        setDraft((r) => ({
                          ...r,
                          picture: {
                            ...r.picture,
                            flipY: !r.picture.flipY,
                            crop: { ...r.picture.crop, y: 1 - r.picture.crop.y - r.picture.crop.h },
                          },
                        }))
                      }
                    >
                      Flip up and down
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {(['x', 'y', 'w', 'h'] as const).map((key) =>
                      number(
                        `Crop ${key === 'x' ? 'left' : key === 'y' ? 'top' : key === 'w' ? 'width' : 'height'} (%)`,
                        draft.picture.crop[key] * 100,
                        (n) =>
                          setDraft((r) => ({
                            ...r,
                            picture: { ...r.picture, crop: { ...r.picture.crop, [key]: n / 100 } },
                          })),
                        key === 'w' || key === 'h' ? 5 : 0,
                        100,
                        0.1,
                      ),
                    )}
                    {pictureNumber('zoom', 'Zoom', 1, 4)}
                    {pictureNumber('x', 'Horizontal position', -1.5, 1.5)}
                    {pictureNumber('y', 'Vertical position', -1.5, 1.5)}
                    {pictureNumber('brightness', 'Brightness', -0.5, 0.5)}
                    {pictureNumber('contrast', 'Contrast', -0.5, 0.5)}
                    {pictureNumber('colour', 'Colour', -1, 1)}
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.picture.fill}
                      onChange={(e) => {
                        const fill = e.currentTarget.checked;
                        setDraft((r) => ({ ...r, picture: { ...r.picture, fill } }));
                      }}
                    />
                    Blurred fill behind the video
                  </label>
                  <p className="text-xs text-muted">
                    Picture edits appear in the prepared copy. The source preview stays as it was taken.
                  </p>
                </>
              )}
              {section === 'Sound' && (
                <>
                  <Field label="Audio track">
                    <Select
                      value={draft.audioTrack === null ? '' : String(draft.audioTrack)}
                      onChange={(e) => {
                        const audioTrack =
                          e.currentTarget.value === '' ? null : Number(e.currentTarget.value);
                        setDraft((r) => ({ ...r, audioTrack }));
                      }}
                    >
                      <option value="">Default audio</option>
                      {tracks.map((track, index) => (
                        <option
                          key={index}
                          value={String(index)}
                        >{`Track ${String(index + 1)} · ${track.language ?? track.title ?? track.codecName}`}</option>
                      ))}
                    </Select>
                  </Field>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.noiseReduction}
                      onChange={(e) => {
                        const noiseReduction = e.currentTarget.checked;
                        setDraft((r) => ({ ...r, noiseReduction }));
                      }}
                    />
                    Reduce steady background noise in a talk
                  </label>
                  <p className="text-xs text-muted">
                    Sound and picture… keeps its own Bass, Treble, Voice boost and delays.
                  </p>
                </>
              )}
              {section === 'Playback' && (
                <>
                  <Field label="Speed">
                    <Select
                      value={String(draft.speed)}
                      onChange={(e) => {
                        const speed = Number(e.currentTarget.value);
                        setDraft((r) => ({ ...r, speed }));
                      }}
                    >
                      {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((speed) => (
                        <option key={speed} value={String(speed)}>
                          {String(speed)}×
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    {(['pictureInMs', 'pictureOutMs', 'soundInMs', 'soundOutMs'] as const).map((key) =>
                      number(
                        `${key === 'pictureInMs' ? 'Picture fade in' : key === 'pictureOutMs' ? 'Picture fade out to black' : key === 'soundInMs' ? 'Sound fade in' : 'Sound fade out'} (seconds)`,
                        draft.fades[key] / 1000,
                        (n) =>
                          setDraft((r) => ({ ...r, fades: { ...r.fades, [key]: Math.round(n * 1000) } })),
                        0,
                        60,
                        0.1,
                      ),
                    )}
                  </div>
                </>
              )}
            </section>
          </fieldset>
          {problem && (
            <p role="alert" className="text-sm text-danger-fg">
              {problem}
            </p>
          )}
        </div>
      </Dialog>
      {discard && (
        <Dialog
          title="Keep these video edits?"
          onClose={() => setDiscard(false)}
          footer={
            <>
              <Button onClick={() => setDiscard(false)}>Keep editing</Button>
              <Button onClick={close}>Discard changes</Button>
              <Button
                variant="primary"
                onClick={() => {
                  setDiscard(false);
                  void save().then((ok) => {
                    if (ok) close();
                  });
                }}
              >
                Save changes
              </Button>
            </>
          }
        >
          <p>The changes in this window have not been saved.</p>
        </Dialog>
      )}
    </>
  );
}
