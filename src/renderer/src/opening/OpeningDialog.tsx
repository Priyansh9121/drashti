import { useEffect, useMemo, useState } from 'react';
import { mediaUrl } from '../../../shared/media';
import { type OpeningPlan, openingPhotoUrl, openingPlanOf, type OpeningView } from '../../../shared/opening';
import { MediaPicker } from '../editor/MediaPicker';
import { MediaStill } from '../render/MediaStill';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { FolderOpen, ImagePlus, Play, X } from '../ui/icons';
import { motionOff } from '../ui/motion';
import { Notice } from '../ui/Notice';
import { Toggle } from '../ui/Toggle';
import { copyFailed } from './copies';
import { closeOpening, connectOpening, loadPack, take, useOpening } from './opening-store';
import { OpeningPlayer } from './OpeningPlayer';

/*
 * File › Opening… (Session 55, Pro Mode; alpha.16, the owner's words of 11 Nov 2026): whether Drashti opens with its
 * two seconds, its one photo (from Media), the opening pack's sound if one is loaded (taken out here), a preview of
 * it, and Load the opening pack…, which makes the pack's photo 1 and its sound the opening's. Every change is kept at
 * once. With no photo chosen, its preview is Drashti's default photo (the owner's decision of 5 Nov 2026), as the
 * opening plays it, with no sound.
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

/**
 * The plan as it would play now: the photo's copy once made (its whole file until then), with the pack's sound; with
 * no photo chosen (or it gone from Media), the default photo, with no sound.
 */
function planOf(view: OpeningView): OpeningPlan {
  const { photo } = view;
  return openingPlanOf(
    photo && !photo.gone ? (photo.ready ? openingPhotoUrl(photo.mediaId) : mediaUrl(photo.mediaId)) : null,
    view.sound?.url ?? null,
    view.defaultPhoto,
  );
}

function OpeningForm({ view }: { view: OpeningView }) {
  const problem = useOpening((s) => s.problem);
  const loading = useOpening((s) => s.loading);
  const [picking, setPicking] = useState(false);
  // The preview plays again each time Play is pressed (a new key), and shows its photo until then.
  const [play, setPlay] = useState(0);
  const plan = useMemo(() => planOf(view), [view]);
  const keep = (photo: string | null) => {
    void window.drashti.opening.setChoice({ photo }).then(take);
  };
  const chosen = view.photo;
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
          For two seconds as Drashti starts, the mandir’s own photo, with the opening pack’s sound if it has
          one, on this screen only: never on the hall’s screens, a node, the stream or a phone. Any key, click
          or tap ends it at once. With no photo chosen, Drashti’s default photo comes in, with no sound.
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
                {plan.photo ? (
                  <img src={plan.photo} alt="" draggable={false} className="size-full object-contain" />
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
        <section aria-labelledby="opening-photo-title" className="space-y-2">
          <h3 id="opening-photo-title" className="text-sm font-medium">
            Photo
          </h3>
          <div data-testid="opening-photo" className="flex items-center gap-3">
            {chosen ? (
              <>
                <div className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-md bg-black">
                  {!chosen.gone && <MediaStill mediaId={chosen.mediaId} media="image" fit="fit" />}
                </div>
                <p className="min-w-0 truncate text-sm" title={chosen.name}>
                  {chosen.gone
                    ? 'No longer in Media: Drashti’s default photo plays instead'
                    : chosen.ready || copyFailed(chosen.mediaId)
                      ? chosen.name
                      : 'Getting it ready…'}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">None chosen: Drashti’s default photo plays, with no sound.</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              icon={ImagePlus}
              data-testid="opening-choose-photo"
              onClick={() => {
                setPicking(true);
              }}
            >
              {chosen ? 'Choose another photo from Media…' : 'Choose a photo from Media…'}
            </Button>
            {chosen && (
              <Button
                icon={X}
                data-testid="opening-remove-photo"
                onClick={() => {
                  keep(null);
                }}
              >
                Take the photo out
              </Button>
            )}
          </div>
        </section>
        <section aria-labelledby="opening-sound-title" className="space-y-2">
          <h3 id="opening-sound-title" className="text-sm font-medium">
            Sound
          </h3>
          <p data-testid="opening-sound" className={view.sound ? 'text-sm' : 'text-sm text-muted'}>
            {view.sound ? (
              <>
                <span className="font-medium">{view.sound.name}</span>, from the opening pack: it plays gently
                with the photo for its two seconds, never with Drashti’s default photo.
              </>
            ) : (
              'No sound. An opening pack may hold one beside its photos folder: sound.mp3, sound.m4a or sound.wav.'
            )}
          </p>
          {view.sound && (
            <Button
              icon={X}
              data-testid="opening-remove-sound"
              onClick={() => {
                void window.drashti.opening.removeSound().then(take);
              }}
            >
              Take the sound out
            </Button>
          )}
        </section>
        <section aria-labelledby="opening-pack-title" className="space-y-2">
          <h3 id="opening-pack-title" className="text-sm font-medium">
            The opening pack
          </h3>
          <p className="text-sm text-muted">
            A folder with its photo (photos/1.jpg) and, if it has one, its sound beside the photos folder
            (sound.mp3, sound.m4a or sound.wav). Its photo comes into Media, and it and its sound replace what
            is chosen here.
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
            keep(media.id);
          }}
          onClose={() => {
            setPicking(false);
          }}
        />
      )}
    </Dialog>
  );
}
