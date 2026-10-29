import { useState } from 'react';
import {
  WALLPAPER_FADE_MAX_MS,
  WALLPAPER_SECONDS_MAX,
  WALLPAPER_SECONDS_MIN,
} from '../../../shared/wallpapers';
import { MediaStill } from '../render/MediaStill';
import { Button, IconButton } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, NumberInput } from '../ui/Field';
import { ArrowDown, ArrowUp, ImagePlus, X } from '../ui/icons';
import { Truncate } from '../ui/Truncate';
import { importWallpapers, saveWallpaper, useWallpapers } from './wallpaper-store';

/*
 * A wallpaper's pictures and how they go round (Session 55, Part 6, S): its pictures in their order (moved earlier or
 * later, taken out, more brought in with Add pictures…), each up for its seconds, fading into the next. A picture
 * moved, taken out or added is kept at once; the seconds and the fade when Done is pressed. Each can be undone.
 */

const secondsOf = (ms: number) => String(Math.round(ms / 100) / 10);

export function WallpaperEditor() {
  const id = useWallpapers((s) => s.editing);
  const wallpaper = useWallpapers((s) => s.view?.wallpapers.find((w) => w.id === s.editing) ?? null);
  // The fields as typed (kept when Done is pressed); null: as the wallpaper has them.
  const [seconds, setSeconds] = useState<string | null>(null);
  const [fade, setFade] = useState<string | null>(null);
  if (id === null || !wallpaper) return null;
  const close = () => {
    setSeconds(null);
    setFade(null);
    useWallpapers.setState({ editing: null });
  };
  const secondsText = seconds ?? String(wallpaper.secondsEach);
  const fadeText = fade ?? secondsOf(wallpaper.fadeMs);
  const secondsEach = Number(secondsText);
  const fadeMs = Math.round(Number(fadeText) * 1000);
  const secondsWrong =
    !Number.isInteger(secondsEach) ||
    secondsEach < WALLPAPER_SECONDS_MIN ||
    secondsEach > WALLPAPER_SECONDS_MAX
      ? `From ${String(WALLPAPER_SECONDS_MIN)} to ${String(WALLPAPER_SECONDS_MAX)} seconds, whole seconds.`
      : null;
  const fadeWrong =
    fadeText.trim() === '' || !Number.isFinite(fadeMs) || fadeMs < 0 || fadeMs > WALLPAPER_FADE_MAX_MS
      ? `From 0 to ${String(WALLPAPER_FADE_MAX_MS / 1000)} seconds.`
      : null;
  const pictures = wallpaper.pictures.map((p) => p.mediaId);
  const timing = { secondsEach: wallpaper.secondsEach, fadeMs: wallpaper.fadeMs };
  /** The pictures in a new order, kept at once. */
  const keep = (order: string[]) => void saveWallpaper(wallpaper.id, order, timing);
  const move = (from: number, to: number) => {
    const order = [...pictures];
    const [taken] = order.splice(from, 1);
    if (taken === undefined) return;
    order.splice(to, 0, taken);
    keep(order);
  };
  return (
    <Dialog
      title={`Edit “${wallpaper.name}”`}
      subtitle="Its pictures go round in this order, each up for its seconds, fading into the next."
      size="md"
      onClose={close}
      testId="wallpaper-editor"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            data-testid="wallpaper-editor-done"
            disabled={secondsWrong !== null || fadeWrong !== null}
            onClick={() => {
              void saveWallpaper(wallpaper.id, pictures, { secondsEach, fadeMs }).then((saved) => {
                if (saved) close();
              });
            }}
          >
            Done
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <ol aria-label="Its pictures, in order" className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {wallpaper.pictures.map((p, i) => (
            <li
              key={`${String(i)}:${p.mediaId}`}
              data-testid="wallpaper-editor-picture"
              className="flex min-w-0 items-center gap-2 rounded-md border border-line px-2 py-1"
            >
              <span className="text-xs text-muted tabular-nums">{i + 1}</span>
              <span className="relative block aspect-video w-20 shrink-0 overflow-hidden rounded bg-black">
                {!p.missing && <MediaStill mediaId={p.mediaId} media="image" />}
              </span>
              <span className="min-w-0 flex-1">
                <Truncate text={p.name} className="block text-sm" />
                {p.missing && (
                  <span className="text-xs text-warning-fg">Missing: left out on the screens</span>
                )}
              </span>
              <IconButton
                icon={ArrowUp}
                label={`Move “${p.name}” earlier`}
                size="sm"
                disabled={i === 0}
                onClick={() => {
                  move(i, i - 1);
                }}
              />
              <IconButton
                icon={ArrowDown}
                label={`Move “${p.name}” later`}
                size="sm"
                disabled={i === wallpaper.pictures.length - 1}
                onClick={() => {
                  move(i, i + 1);
                }}
              />
              <IconButton
                icon={X}
                label={`Take “${p.name}” out`}
                size="sm"
                disabled={wallpaper.pictures.length <= 1}
                onClick={() => {
                  keep(pictures.filter((_, n) => n !== i));
                }}
              />
            </li>
          ))}
        </ol>
        <div>
          <Button size="sm" icon={ImagePlus} onClick={() => void importWallpapers(wallpaper.id)}>
            Add pictures…
          </Button>
        </div>
        <div className="flex flex-wrap gap-4">
          <Field label="Seconds each" error={secondsWrong}>
            <NumberInput
              data-testid="wallpaper-seconds"
              min={WALLPAPER_SECONDS_MIN}
              max={WALLPAPER_SECONDS_MAX}
              step={1}
              value={secondsText}
              onChange={(e) => {
                setSeconds(e.target.value);
              }}
            />
          </Field>
          <Field label="Fade (seconds)" error={fadeWrong}>
            <NumberInput
              data-testid="wallpaper-fade"
              min={0}
              max={WALLPAPER_FADE_MAX_MS / 1000}
              step={0.5}
              value={fadeText}
              onChange={(e) => {
                setFade(e.target.value);
              }}
            />
          </Field>
        </div>
        {wallpaper.pictures.length < 2 && (
          <p className="text-xs text-muted">
            With one picture it stays as it is; add more to have them go round.
          </p>
        )}
      </div>
    </Dialog>
  );
}
