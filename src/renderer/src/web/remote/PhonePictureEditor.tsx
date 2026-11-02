import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import type { CropRect, CropShape, PictureLook, PixelSize } from '../../../../shared/picture-look';
import {
  cssFilter,
  dragCrop,
  editLayout,
  flipAcross,
  flipUpDown,
  framed,
  FULL_CROP,
  hasEdit,
  isPlain,
  PLAIN,
  shapedCrop,
  turnClockwise,
  turnedSize,
} from '../../../../shared/picture-look';
import { frameTransform } from '../../render/picture-looks';
import { PreviewPicture } from '../../render/previews';
import { useElementSize } from '../../render/useElementSize';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { Crop, FlipHorizontal2, FlipVertical2, RotateCw } from '../../ui/icons';
import { api } from '../device';
import { PhoneSheet } from './PhoneSheet';
import { usePhoneTools } from './phone-tools-store';

/*
 * The Picture editor on a phone or tablet (Session 55, Part 9, from Part 5): a picture turned a quarter turn at a time,
 * flipped across or up and down, and cropped (the whole picture, free, 16:9, 4:3 or 1:1: a frame over the whole
 * picture, moved by a finger and sized by its corners), its brightness, contrast, colour and sharpness, and its blurred
 * fill's switch (on for a photo, off for a deck's slide); As it was taken puts all of it back. Shown as the screens
 * will show it, and kept with the picture (never in its file) by the same request the window's Save makes, so every
 * screen, node, the stream and every phone draw it so at once. Pro Mode's, as in the window.
 */

const placed = (b: { left: number; top: number; width: number; height: number }): CSSProperties => ({
  position: 'absolute',
  left: `${String(b.left)}%`,
  top: `${String(b.top)}%`,
  width: `${String(b.width)}%`,
  height: `${String(b.height)}%`,
});

type Shape = 'whole' | CropShape;
const SHAPES: { id: Shape; label: string }[] = [
  { id: 'whole', label: 'Whole picture' },
  { id: 'free', label: 'Free' },
  { id: '16:9', label: '16:9' },
  { id: '4:3', label: '4:3' },
  { id: '1:1', label: '1:1' },
];

type Corner = 'nw' | 'ne' | 'se' | 'sw';
const CORNERS: { edge: Corner; style: CSSProperties }[] = [
  { edge: 'nw', style: { left: 0, top: 0 } },
  { edge: 'ne', style: { left: '100%', top: 0 } },
  { edge: 'se', style: { left: '100%', top: '100%' } },
  { edge: 'sw', style: { left: 0, top: '100%' } },
];

const SLIDERS: {
  key: 'brightness' | 'contrast' | 'colour' | 'sharpness';
  label: string;
  min: number;
  max: number;
}[] = [
  { key: 'brightness', label: 'Brightness', min: -0.5, max: 0.5 },
  { key: 'contrast', label: 'Contrast', min: -0.5, max: 0.5 },
  { key: 'colour', label: 'Colour', min: -1, max: 1 },
  { key: 'sharpness', label: 'Sharpness', min: 0, max: 1 },
];

const close = () => {
  usePhoneTools.setState({ editing: null });
};

export function PhonePictureEditor({ mediaId, name }: { mediaId: string; name: string }) {
  const [loaded, setLoaded] = useState<{ look: PictureLook; photo: boolean } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void api<{ look: PictureLook | null; photo: boolean }>(
      `/api/v1/media/${encodeURIComponent(mediaId)}/look`,
    ).then((r) => {
      if (!live) return;
      if (r.ok) setLoaded({ look: r.look ?? PLAIN, photo: r.photo });
      else setProblem(r.message);
    });
    return () => {
      live = false;
    };
  }, [mediaId]);
  return (
    <PhoneSheet
      title={`Picture: ${name}`}
      subtitle="As the screens will show it"
      onClose={close}
      testId="remote-picture-editor"
    >
      {loaded ? (
        <EditorForm mediaId={mediaId} start={loaded.look} photo={loaded.photo} />
      ) : problem ? (
        <p role="alert" className="text-base text-warning-fg">
          {problem}
        </p>
      ) : (
        <p role="status" className="text-base text-muted">
          Reading the picture…
        </p>
      )}
    </PhoneSheet>
  );
}

function EditorForm({ mediaId, start, photo }: { mediaId: string; start: PictureLook; photo: boolean }) {
  const [look, setLook] = useState<PictureLook>(start);
  const [cropping, setCropping] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Its own shape, as this phone has it (its look's, until the picture has loaded).
  const [natural, setNatural] = useState<PixelSize | null>(start.size ?? null);
  const frame = useRef<HTMLDivElement>(null);
  const measured = useElementSize(frame);
  const box: PixelSize = measured.width > 0 ? measured : { width: 16, height: 9 };
  const drag = useRef<{ x: number; y: number; edge: 'move' | Corner; from: CropRect } | null>(null);
  const shape: Shape =
    look.crop === undefined && look.cropShape === undefined ? 'whole' : (look.cropShape ?? 'free');
  const fillOn = look.fill ?? photo;
  // Cropping: the whole picture (turned and flipped), unzoomed, the part kept marked on it.
  const drawn: PictureLook = cropping ? { ...look, crop: undefined, zoom: 1, x: 0, y: 0 } : look;
  const layout = natural ? editLayout(drawn, natural, box, 'contain') : null;
  const turned = natural ? turnedSize(natural, look.turn) : null;
  const crop = look.crop ?? FULL_CROP;
  const cropBox =
    cropping && layout
      ? {
          left: layout.frame.left + crop.x * layout.frame.width,
          top: layout.frame.top + crop.y * layout.frame.height,
          width: crop.w * layout.frame.width,
          height: crop.h * layout.frame.height,
        }
      : null;

  const chooseShape = (next: Shape) => {
    if (next === 'whole') {
      setLook((was) => {
        const { crop: _crop, cropShape: _shape, ...rest } = was;
        return rest;
      });
      setCropping(false);
      return;
    }
    setLook((was) => ({
      ...was,
      cropShape: next,
      crop:
        turned && next !== 'free' ? shapedCrop(next, turned, was.crop ?? FULL_CROP) : (was.crop ?? FULL_CROP),
    }));
    setCropping(true);
  };
  const startDrag = (edge: 'move' | Corner, e: PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Lifted already.
    }
    drag.current = { x: e.clientX, y: e.clientY, edge, from: crop };
  };
  const moveDrag = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    const b = frame.current?.getBoundingClientRect();
    if (!d || !b || !layout || !turned || b.width === 0) return;
    const dx = (e.clientX - d.x) / ((b.width * layout.frame.width) / 100);
    const dy = (e.clientY - d.y) / ((b.height * layout.frame.height) / 100);
    const kept: CropShape = shape === 'whole' ? 'free' : shape;
    setLook((was) => ({ ...was, crop: dragCrop(d.from, d.edge, dx, dy, kept, turned) }));
  };
  const endDrag = () => {
    drag.current = null;
  };
  const save = async () => {
    // Turned or cropped, its own size kept with the look, so every screen places it from the first frame.
    const final = framed({ ...look, ...(hasEdit(look) && natural ? { size: natural } : {}) });
    if (hasEdit(final) && !final.size) {
      setProblem('The picture has not loaded yet: wait a moment, then save again.');
      return;
    }
    setSaving(true);
    const r = await api(`/api/v1/media/${encodeURIComponent(mediaId)}/look`, {
      method: 'POST',
      body: { look: isPlain(final) ? null : final },
    });
    setSaving(false);
    if (r.ok) close();
    else setProblem(r.message);
  };

  const picture = (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        transformOrigin: '50% 50%',
        transform: frameTransform(drawn) || undefined,
        filter: cssFilter(drawn) || undefined,
      }}
    >
      {layout ? (
        <div style={{ ...placed(layout.frame), overflow: 'hidden' }}>
          <PreviewPicture
            mediaId={mediaId}
            style={{
              ...placed(layout.picture),
              objectFit: 'fill',
              transformOrigin: '50% 50%',
              transform: layout.transform || undefined,
            }}
          />
        </div>
      ) : (
        <PreviewPicture
          mediaId={mediaId}
          onSize={(size) => {
            setNatural((was) => was ?? { width: Math.round(size.width), height: Math.round(size.height) });
          }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
        />
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      <div
        ref={frame}
        data-testid="remote-pe-frame"
        data-cropping={cropping ? '' : undefined}
        role="img"
        aria-label={
          cropping
            ? 'The whole picture, the part kept marked on it'
            : 'The picture as the screens will show it'
        }
        className="relative aspect-video w-full touch-none overflow-hidden rounded-lg border border-line bg-black"
      >
        {fillOn && !cropping && (
          <div
            aria-hidden="true"
            className="absolute inset-0 scale-110"
            style={{ filter: 'blur(16px) brightness(0.55)' }}
          >
            <PreviewPicture
              mediaId={mediaId}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
        )}
        {picture}
        {cropBox && (
          <>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute"
              style={{ ...placed(cropBox), boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.6)' }}
            />
            <div
              aria-hidden="true"
              data-testid="remote-pe-crop-box"
              className="absolute touch-none border-2 border-white"
              style={placed(cropBox)}
              onPointerDown={(e) => startDrag('move', e)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              {CORNERS.map((c) => (
                <span
                  key={c.edge}
                  className="absolute h-11 w-11 -translate-x-1/2 -translate-y-1/2 touch-none"
                  style={c.style}
                  onPointerDown={(e) => startDrag(c.edge, e)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                >
                  <span className="absolute top-1/2 left-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-white bg-black/40" />
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Turn and flip">
        <Button
          size="lg"
          wrap
          className="min-h-12"
          icon={RotateCw}
          data-testid="remote-pe-turn"
          onClick={() => {
            setLook((was) => turnClockwise(was));
          }}
        >
          Turn
        </Button>
        <Button
          size="lg"
          wrap
          className="min-h-12"
          icon={FlipHorizontal2}
          data-testid="remote-pe-flip-x"
          aria-pressed={look.flipX === true}
          onClick={() => {
            setLook((was) => flipAcross(was));
          }}
        >
          Flip across
        </Button>
        <Button
          size="lg"
          wrap
          className="min-h-12"
          icon={FlipVertical2}
          data-testid="remote-pe-flip-y"
          aria-pressed={look.flipY === true}
          onClick={() => {
            setLook((was) => flipUpDown(was));
          }}
        >
          Flip up and down
        </Button>
      </div>

      <fieldset className="space-y-2">
        <legend className="flex items-center gap-2 text-base font-bold text-fg">
          <Crop size={18} aria-hidden="true" />
          Crop
        </legend>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
          {SHAPES.map((s) => (
            <Button
              key={s.id}
              size="lg"
              wrap
              className={cx('min-h-12', shape === s.id && 'ring-2 ring-accent')}
              variant={shape === s.id ? 'strong' : 'secondary'}
              aria-pressed={shape === s.id}
              // A shape is cut from the picture's own shape: once it has loaded.
              disabled={!natural}
              data-testid={`remote-pe-crop-${s.id}`}
              onClick={() => {
                chooseShape(s.id);
              }}
            >
              {s.label}
            </Button>
          ))}
        </div>
        {shape !== 'whole' && (
          <Button
            size="lg"
            className="min-h-12 w-full"
            aria-pressed={cropping}
            data-testid="remote-pe-cropping"
            onClick={() => {
              setCropping((was) => !was);
            }}
          >
            {cropping ? 'See it as the screens will' : 'Move the part kept'}
          </Button>
        )}
        {cropping && (
          <p className="text-base text-muted">Move the frame with a finger, or drag its corners.</p>
        )}
      </fieldset>

      <div className="space-y-3">
        {SLIDERS.map((s) => (
          <label key={s.key} className="block space-y-1">
            <span className="flex items-center justify-between text-base text-fg">
              {s.label}
              <span className="text-muted tabular-nums">{Math.round(look[s.key] * 100)}</span>
            </span>
            <input
              type="range"
              min={s.min}
              max={s.max}
              step={0.01}
              value={look[s.key]}
              data-testid={`remote-pe-${s.key}`}
              onChange={(e) => {
                const v = Number(e.target.value);
                setLook((was) => ({ ...was, [s.key]: v }));
              }}
              className="h-11 w-full accent-[var(--color-accent)]"
            />
          </label>
        ))}
      </div>

      <label className="flex min-h-12 items-center gap-3 rounded-lg border border-line bg-panel-2 px-3 py-2">
        <span className="min-w-0 flex-1 text-base text-fg">
          Blurred fill
          <span className="block text-muted">
            Where it does not fill the screen, a blurred copy behind it
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={fillOn}
          aria-label="Blurred fill"
          data-testid="remote-pe-fill"
          onClick={() => {
            setLook((was) => ({ ...was, fill: !fillOn }));
          }}
          className={cx(
            'relative h-11 w-16 shrink-0 rounded-full border-2 transition-colors',
            fillOn ? 'border-accent bg-accent' : 'border-line-strong bg-panel-3',
          )}
        >
          <span
            className={cx(
              'absolute top-1/2 h-7 w-7 -translate-y-1/2 rounded-full bg-white shadow transition-[left]',
              fillOn ? 'left-7' : 'left-1',
            )}
          />
        </button>
      </label>

      {problem && (
        <p role="alert" className="text-base text-warning-fg">
          {problem}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Button
          size="lg"
          wrap
          className="col-span-2 min-h-12 sm:col-span-1"
          data-testid="remote-pe-reset"
          onClick={() => {
            setLook(PLAIN);
            setCropping(false);
          }}
        >
          As it was taken
        </Button>
        <Button size="lg" className="min-h-12" data-testid="remote-pe-cancel" onClick={close}>
          Cancel
        </Button>
        <Button
          size="lg"
          variant="primary"
          className="min-h-12"
          disabled={saving}
          data-testid="remote-pe-save"
          onClick={() => void save()}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
