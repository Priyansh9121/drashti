import { useEffect, useMemo, useState } from 'react';
import { mediaUrl } from '../../../shared/media';
import {
  OPENING_LINES_MAX,
  OPENING_PHOTOS_MAX,
  type OpeningPlan,
  openingPhotoUrl,
  type OpeningView,
} from '../../../shared/opening';
import { MediaPicker } from '../editor/MediaPicker';
import { MediaStill } from '../render/MediaStill';
import { Button, IconButton } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, TextInput } from '../ui/Field';
import { ChevronLeft, ChevronRight, FolderOpen, ImagePlus, Play, X } from '../ui/icons';
import { motionOff } from '../ui/motion';
import { Notice } from '../ui/Notice';
import { Toggle } from '../ui/Toggle';
import { closeOpening, connectOpening, loadPack, take, useOpening } from './opening-store';
import { OpeningPlayer } from './OpeningPlayer';

/*
 * File › Opening… (Session 55, Pro Mode): whether Drashti opens with its five seconds, its photos (from Media, up to
 * eight, in order) and its lines (up to five, in Gujarati, Hindi or English), a preview of it, and Load the opening
 * pack…, which makes the pack's photos and lines the opening's only ones. Every change is kept at once.
 */

export function OpeningDialog() {
  const open = useOpening((s) => s.open);
  const view = useOpening((s) => s.view);
  useEffect(() => {
    connectOpening();
  }, []);
  if (!open || !view) return null;
  return <OpeningForm view={view} />;
}

/** The plan as it would play now: each photo's copy once made (its whole file until then). */
function planOf(view: OpeningView): OpeningPlan {
  return {
    photos: view.photos.filter((p) => !p.gone).map((p) => (p.ready ? openingPhotoUrl(p.mediaId) : mediaUrl(p.mediaId))),
    lines: view.lines,
  };
}

function OpeningForm({ view }: { view: OpeningView }) {
  const problem = useOpening((s) => s.problem);
  const loading = useOpening((s) => s.loading);
  const [picking, setPicking] = useState(false);
  // The preview plays again each time Play is pressed (a new key), and shows its first moment until then.
  const [play, setPlay] = useState(0);
  const [lines, setLines] = useState<string[]>(() => view.lines);
  useEffect(() => {
    setLines(view.lines);
  }, [view.lines]);
  const photos = view.photos.filter((p) => !p.gone).map((p) => p.mediaId);
  const plan = useMemo(() => planOf(view), [view]);
  const keep = (next: { photos?: string[]; lines?: string[] }) => {
    void window.drashti.opening
      .setChoice({ photos: next.photos ?? photos, lines: next.lines ?? lines.filter((l) => l.trim() !== '') })
      .then(take);
  };
  const move = (from: number, to: number) => {
    const next = view.photos.map((p) => p.mediaId);
    const [one] = next.splice(from, 1);
    if (one === undefined) return;
    next.splice(to, 0, one);
    keep({ photos: next.filter((id) => photos.includes(id)) });
  };
  return (
    <Dialog
      title="Opening"
      size="lg"
      onClose={closeOpening}
      closeLabel="Close the opening"
      testId="opening-dialog"
      footer={<Button onClick={closeOpening}>Close</Button>}
    >
      <div className="space-y-5">
        <p className="text-sm text-muted">
          For five seconds as Drashti starts, the mandir’s own photos and lines, on this screen only: never on the
          hall’s screens, a node, the stream or a phone. Any key, click or tap ends it at once. With nothing chosen,
          Drashti’s lamp lights.
        </p>
        <Toggle
          checked={view.on}
          label="Play the opening as Drashti starts"
          data-testid="opening-on"
          onChange={(on) => {
            void window.drashti.opening.setOn(on).then(take);
          }}
        />
        <section aria-label="Preview" className="space-y-2">
          <div className="relative aspect-video w-full max-w-md overflow-hidden rounded-lg bg-black">
            {play > 0 ? (
              <OpeningPlayer
                key={play}
                plan={plan}
                still={motionOff()}
                className="absolute inset-0"
                testId="opening-preview"
                onDone={() => {
                  setPlay(0);
                }}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
                {plan.photos[0] ? (
                  <img src={plan.photos[0]} alt="" draggable={false} className="size-full object-cover" />
                ) : (
                  'The lamp lights'
                )}
              </div>
            )}
          </div>
          <Button
            icon={Play}
            data-testid="opening-play"
            onClick={() => {
              setPlay((n) => n + 1);
            }}
          >
            Play the preview
          </Button>
        </section>
        <section aria-labelledby="opening-photos-title" className="space-y-2">
          <h3 id="opening-photos-title" className="text-sm font-medium">
            Photos ({view.photos.length} of {OPENING_PHOTOS_MAX}), in the order they come
          </h3>
          {view.photos.length > 0 && (
            <ol className="grid grid-cols-4 gap-2">
              {view.photos.map((p, i) => (
                <li key={`${p.mediaId}-${String(i)}`} data-testid="opening-photo" className="space-y-1">
                  <div className="relative aspect-video overflow-hidden rounded-md bg-black">
                    {!p.gone && <MediaStill mediaId={p.mediaId} media="image" fit="fill" />}
                    <span className="absolute top-1 left-1 rounded bg-black/70 px-1.5 text-xs text-white">
                      {i + 1}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted" title={p.name}>
                    {p.gone ? 'No longer in Media: left out' : p.ready ? p.name : 'Getting it ready…'}
                  </p>
                  <div className="flex gap-1">
                    <IconButton
                      size="sm"
                      icon={ChevronLeft}
                      label={`Move photo ${String(i + 1)} earlier`}
                      disabled={i === 0 || p.gone}
                      onClick={() => {
                        move(i, i - 1);
                      }}
                    />
                    <IconButton
                      size="sm"
                      icon={ChevronRight}
                      label={`Move photo ${String(i + 1)} later`}
                      disabled={i === view.photos.length - 1 || p.gone}
                      onClick={() => {
                        move(i, i + 1);
                      }}
                    />
                    <IconButton
                      size="sm"
                      icon={X}
                      label={`Take photo ${String(i + 1)} out of the opening`}
                      onClick={() => {
                        keep({ photos: view.photos.filter((q, k) => k !== i && !q.gone).map((q) => q.mediaId) });
                      }}
                    />
                  </div>
                </li>
              ))}
            </ol>
          )}
          <Button
            icon={ImagePlus}
            data-testid="opening-add-photo"
            disabled={view.photos.length >= OPENING_PHOTOS_MAX}
            onClick={() => {
              setPicking(true);
            }}
          >
            Add a photo from Media…
          </Button>
        </section>
        <section aria-labelledby="opening-lines-title" className="space-y-2">
          <h3 id="opening-lines-title" className="text-sm font-medium">
            Lines (up to {OPENING_LINES_MAX}), in Gujarati, Hindi or English, sharing the five seconds
          </h3>
          {Array.from({ length: OPENING_LINES_MAX }, (_, i) => (
            <Field key={i} label={`Line ${String(i + 1)}`} layout="inline">
              <TextInput
                data-testid={`opening-line-${String(i + 1)}`}
                value={lines[i] ?? ''}
                maxLength={120}
                onChange={(e) => {
                  const next = [...lines];
                  while (next.length <= i) next.push('');
                  next[i] = e.target.value;
                  setLines(next);
                }}
                onBlur={() => {
                  if (lines.join('\n') !== view.lines.join('\n')) keep({});
                }}
              />
            </Field>
          ))}
        </section>
        <section aria-labelledby="opening-pack-title" className="space-y-2">
          <h3 id="opening-pack-title" className="text-sm font-medium">
            The opening pack
          </h3>
          <p className="text-sm text-muted">
            A folder with the photos (photos/1.jpg to 8.jpg) and their lines (words.txt, one to a line). Its photos
            come into Media, and they and its lines replace what is chosen here.
          </p>
          <Button
            icon={FolderOpen}
            data-testid="opening-load-pack"
            disabled={loading}
            onClick={() => {
              void loadPack();
            }}
          >
            {loading ? 'Loading the opening pack…' : 'Load the opening pack…'}
          </Button>
        </section>
        {problem && (
          <Notice tone="danger" data-testid="opening-problem">
            {problem}
          </Notice>
        )}
      </div>
      {picking && (
        <MediaPicker
          title="Choose a photo for the opening"
          picturesOnly
          onChoose={(media) => {
            setPicking(false);
            keep({ photos: [...photos, media.id] });
          }}
          onClose={() => {
            setPicking(false);
          }}
        />
      )}
    </Dialog>
  );
}
