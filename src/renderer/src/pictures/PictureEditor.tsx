import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, WheelEvent } from 'react';
import { create } from 'zustand';
import { mediaUrl } from '../../../shared/media';
import type { CropRect, CropShape, PictureLook, PixelSize } from '../../../shared/picture-look';
import {
  autoLevels,
  CROP_SHAPES,
  dragCrop,
  editLayout,
  fillZoom,
  flipAcross,
  flipUpDown,
  framed,
  FULL_CROP,
  hasEdit,
  isPlain,
  PLAIN,
  shapedCrop,
  shownSize,
  turnClockwise,
  turnedSize,
  ZOOM,
} from '../../../shared/picture-look';
import { addFileMenuItems } from '../files/file-menu';
import { useNotice } from '../operator/actions';
import { frameTransform, lookFilter } from '../render/picture-looks';
import { useElementSize } from '../render/useElementSize';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Slider } from '../ui/Field';
import {
  Crop,
  FlipHorizontal2,
  FlipVertical2,
  Maximize2,
  Minimize2,
  RotateCcw,
  RotateCw,
  Wand2,
} from '../ui/icons';
import { radioKeys, radioTabIndex } from '../ui/radio';
import { Toggle } from '../ui/Toggle';
import { savePictureItems } from './save-picture';

/*
 * The Picture editor (Session 26e, shared/picture-look.ts): a picture
 * zoomed 100 to 400 % and moved by dragging (Fit, Fill, Reset), its
 * brightness, contrast, colour and sharpness, and Auto, which sets its
 * levels from the picture itself; Before shows it as it is. What is saved is
 * kept with the picture, so it looks the same wherever it shows. The file
 * is never changed.
 *
 * Session 55 (Part 5): Rotate (a quarter turn clockwise), Flip across, Flip up
 * and down, and Crop (free, 16:9, 4:3 or 1:1: a frame dragged over the whole
 * picture, its sides and corners, or moved with the arrows), all kept with
 * the picture too; the blurred fill's switch (a photo that does not fill the
 * screen has a blurred, darker copy of itself behind it: on for a photo, off
 * for a deck's slide); and As it was taken puts all of it back.
 */

export const usePictureEditor = create<{ media: { id: string; name: string } | null }>(() => ({
  media: null,
}));

export function openPictureEditor(media: { id: string; name: string }): void {
  usePictureEditor.setState({ media });
}

const close = () => {
  usePictureEditor.setState({ media: null });
};

/** Save picture… (Session 55, Part 5): the main process asks where; a notice says where it went, or why not. */
async function savePictureOf(mediaId: string, name: string): Promise<void> {
  const result = await window.drashti.media.savePicture(mediaId, name);
  if (result.ok) {
    const file = result.path.split(/[\\/]/u).at(-1) ?? result.path;
    useNotice.setState({ text: `Saved the picture as “${file}”.` });
  } else if (!('cancelled' in result)) useNotice.setState({ text: result.message });
}

export function PictureEditor() {
  const media = usePictureEditor((s) => s.media);
  const [loaded, setLoaded] = useState<{ id: string; look: PictureLook; photo: boolean } | null>(null);
  // Save picture… in the one right-click menu, while the operator window is open (Session 55, Part 5).
  useEffect(
    () =>
      addFileMenuItems((target) =>
        savePictureItems(target, (mediaId, name) => {
          void savePictureOf(mediaId, name);
        }),
      ),
    [],
  );
  useEffect(() => {
    if (!media) return;
    let live = true;
    void Promise.all([window.drashti.media.look(media.id), window.drashti.media.photo(media.id)]).then(
      ([look, photo]) => {
        if (live) setLoaded({ id: media.id, look: look ?? PLAIN, photo });
      },
    );
    return () => {
      live = false;
    };
  }, [media]);
  if (!media || loaded?.id !== media.id) return null;
  return <EditorForm key={media.id} media={media} start={loaded.look} photo={loaded.photo} />;
}

/** The luminance of a picture's pixels, 256 counts (drawn small: enough for its levels). */
function histogram(img: HTMLImageElement): number[] {
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight, 1));
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const counts = Array<number>(256).fill(0);
  if (!ctx) return counts;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < data.length; i += 4) {
    const y = Math.round(0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0));
    counts[Math.min(255, y)] = (counts[Math.min(255, y)] ?? 0) + 1;
  }
  return counts;
}

const percent = (v: number) => `${v > 0 ? '+' : ''}${String(Math.round(v * 100))}%`;

/** A part of the preview, in percent, as a style. */
const placed = (b: { left: number; top: number; width: number; height: number }): CSSProperties => ({
  position: 'absolute',
  left: `${String(b.left)}%`,
  top: `${String(b.top)}%`,
  width: `${String(b.width)}%`,
  height: `${String(b.height)}%`,
});

/** What a crop's drag holds: its side or corner (or all of it), and where it started. */
type Edge = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const HANDLES: { edge: Edge; style: CSSProperties; cursor: string }[] = [
  { edge: 'nw', style: { left: 0, top: 0 }, cursor: 'nwse-resize' },
  { edge: 'n', style: { left: '50%', top: 0 }, cursor: 'ns-resize' },
  { edge: 'ne', style: { left: '100%', top: 0 }, cursor: 'nesw-resize' },
  { edge: 'e', style: { left: '100%', top: '50%' }, cursor: 'ew-resize' },
  { edge: 'se', style: { left: '100%', top: '100%' }, cursor: 'nwse-resize' },
  { edge: 's', style: { left: '50%', top: '100%' }, cursor: 'ns-resize' },
  { edge: 'sw', style: { left: 0, top: '100%' }, cursor: 'nesw-resize' },
  { edge: 'w', style: { left: 0, top: '50%' }, cursor: 'ew-resize' },
];

const SHAPE_LABELS: Record<CropShape, string> = { free: 'Free', '16:9': '16:9', '4:3': '4:3', '1:1': '1:1' };

function EditorForm({
  media,
  start,
  photo,
}: {
  media: { id: string; name: string };
  start: PictureLook;
  /** A photo (its blurred fill on unless its look says not), not a deck's slide (off unless it says on). */
  photo: boolean;
}) {
  const [look, setLook] = useState<PictureLook>(start);
  const [before, setBefore] = useState(false);
  const [cropping, setCropping] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // The picture's own size, as this window shows it (turned by its EXIF already): kept with a turned or cropped look.
  const [natural, setNatural] = useState<PixelSize | null>(start.size ?? null);
  const frame = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; from: PictureLook } | null>(null);
  const cropDrag = useRef<{ x: number; y: number; edge: Edge; from: CropRect } | null>(null);
  const measured = useElementSize(frame);
  const box: PixelSize = measured.width > 0 ? measured : { width: 16, height: 9 };
  const set = (change: Partial<PictureLook>) => {
    setLook((was) => framed({ ...was, ...change }));
  };
  const shape: CropShape = look.cropShape ?? 'free';
  const fillOn = look.fill ?? photo;
  const shown = before ? PLAIN : look;
  // Cropping: the whole picture (turned and flipped), unzoomed, with the part kept marked on it.
  const drawn: PictureLook = cropping ? { ...shown, crop: undefined, zoom: 1, x: 0, y: 0 } : shown;
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

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (cropping) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, from: look };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const b = frame.current?.getBoundingClientRect();
    if (!d || !b || b.width === 0) return;
    set({ x: d.from.x + (e.clientX - d.x) / b.width, y: d.from.y + (e.clientY - d.y) / b.height });
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (cropping) return;
    set({ zoom: look.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1) });
  };
  // A crop's side, corner or the whole of it dragged: by fractions of the picture as it is drawn.
  const startCrop = (e: PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    // Which side or corner (or the whole of it) is the element's own: its data-edge.
    const edge: Edge = HANDLES.find((h) => h.edge === e.currentTarget.dataset['edge'])?.edge ?? 'move';
    cropDrag.current = { x: e.clientX, y: e.clientY, edge, from: crop };
  };
  const moveCrop = (e: PointerEvent<HTMLElement>) => {
    const d = cropDrag.current;
    const b = frame.current?.getBoundingClientRect();
    if (!d || !b || !layout || !turned || b.width === 0) return;
    const dx = (e.clientX - d.x) / ((b.width * layout.frame.width) / 100);
    const dy = (e.clientY - d.y) / ((b.height * layout.frame.height) / 100);
    setLook((was) => ({ ...was, crop: dragCrop(d.from, d.edge, dx, dy, shape, turned) }));
  };
  const endCrop = () => {
    cropDrag.current = null;
  };
  /** The arrows move the crop by a hundredth; with Shift they change its size (its right side, or its bottom). */
  const cropKeys = (e: KeyboardEvent<HTMLElement>) => {
    const step = 0.01;
    const by: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = by[e.key];
    if (!d || !turned) return;
    e.preventDefault();
    setLook((was) => ({
      ...was,
      crop: dragCrop(
        was.crop ?? FULL_CROP,
        e.shiftKey ? (d[0] !== 0 ? 'e' : 's') : 'move',
        d[0],
        d[1],
        shape,
        turned,
      ),
    }));
  };
  const chooseShape = (next: CropShape) => {
    setLook((was) => ({
      ...was,
      cropShape: next,
      ...(turned && next !== 'free' ? { crop: shapedCrop(next, turned, was.crop ?? FULL_CROP) } : {}),
    }));
  };
  const fill = () => {
    if (!natural) return;
    set({ zoom: fillZoom(shownSize(look, natural), box), x: 0, y: 0 });
  };
  const auto = async () => {
    const img = picture.current;
    if (!img) return;
    // Its levels once it is loaded (Auto pressed at once waits for it).
    await img.decode().catch(() => undefined);
    try {
      if (img.naturalWidth > 0) set(autoLevels(histogram(img)));
    } catch {
      setProblem('Auto could not read this picture: set its brightness and contrast by hand.');
    }
  };
  const save = async () => {
    // A turned or cropped picture keeps its own size with its look, so every screen places it from the first frame.
    const final = framed({ ...look, ...(hasEdit(look) && natural ? { size: natural } : {}) });
    if (hasEdit(final) && !final.size) {
      setProblem('The picture has not loaded yet: wait a moment, then save again.');
      return;
    }
    const result = await window.drashti.media.setLook(media.id, isPlain(final) ? null : final);
    if (result.ok) close();
    else setProblem(result.message);
  };
  // The blurred fill, as the screens draw it: here the picture itself, blurred and darker (a small window's only).
  const blurredBehind = fillOn && !cropping && !before;
  return (
    <Dialog
      title={`Picture: ${media.name}`}
      size="lg"
      onClose={close}
      closeLabel="Close the Picture editor"
      testId="picture-editor"
      footer={
        <>
          <Button
            onClick={() => {
              setLook(PLAIN);
              setCropping(false);
            }}
            data-testid="pe-reset-all"
          >
            As it was taken
          </Button>
          <span className="flex-1" />
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" data-testid="pe-save" onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-[3fr_2fr]">
        <div className="space-y-2">
          <div
            ref={frame}
            data-testid="pe-frame"
            data-a11y-picture
            data-cropping={cropping ? '' : undefined}
            {...(cropping
              ? { role: 'group', 'aria-label': `Crop ${media.name}` }
              : {
                  role: 'img',
                  'aria-label': `${media.name}, as the screens will show it. Drag to move it; scroll to zoom.`,
                })}
            className="relative aspect-video w-full cursor-grab touch-none overflow-hidden rounded-md border border-line bg-black active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => {
              drag.current = null;
            }}
            onWheel={onWheel}
          >
            {blurredBehind && (
              <img
                src={mediaUrl(media.id)}
                alt=""
                draggable={false}
                data-testid="pe-blurred-preview"
                className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover"
                style={{ filter: 'blur(16px) brightness(0.55)' }}
              />
            )}
            <div
              data-testid="pe-picture"
              style={{
                position: 'absolute',
                inset: 0,
                transformOrigin: '50% 50%',
                transform: frameTransform(drawn) || undefined,
                filter: lookFilter(shown) || undefined,
              }}
            >
              {layout ? (
                <div data-testid="pe-kept" style={{ ...placed(layout.frame), overflow: 'hidden' }}>
                  <img
                    ref={picture}
                    // Read for Auto: the media protocol allows it (as the stills do).
                    crossOrigin="anonymous"
                    src={mediaUrl(media.id)}
                    alt=""
                    draggable={false}
                    className="pointer-events-none"
                    style={{
                      ...placed(layout.picture),
                      objectFit: 'fill',
                      transformOrigin: '50% 50%',
                      transform: layout.transform || undefined,
                    }}
                  />
                </div>
              ) : (
                <img
                  ref={picture}
                  crossOrigin="anonymous"
                  src={mediaUrl(media.id)}
                  alt=""
                  draggable={false}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    if (img.naturalWidth > 0)
                      setNatural({ width: img.naturalWidth, height: img.naturalHeight });
                  }}
                  className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                />
              )}
            </div>
            {cropBox && (
              <>
                {/* Outside the part kept: darker. */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute"
                  style={{
                    ...placed(cropBox),
                    boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.6)',
                  }}
                />
                <div
                  role="button"
                  tabIndex={0}
                  data-testid="pe-crop-box"
                  aria-label="The part kept: drag it, or its sides and corners; the arrows move it, Shift and the arrows change its size"
                  className="absolute cursor-move border-2 border-white outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary"
                  style={placed(cropBox)}
                  data-edge="move"
                  onPointerDown={startCrop}
                  onPointerMove={moveCrop}
                  onPointerUp={endCrop}
                  onKeyDown={cropKeys}
                >
                  {HANDLES.map((h) => (
                    <span
                      key={h.edge}
                      aria-hidden="true"
                      data-edge={h.edge}
                      className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-white bg-black/60"
                      style={{ ...h.style, cursor: h.cursor }}
                      onPointerDown={startCrop}
                      onPointerMove={moveCrop}
                      onPointerUp={endCrop}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              data-testid="pe-before"
              aria-pressed={before}
              onPointerDown={() => {
                setBefore(true);
              }}
              onPointerUp={() => {
                setBefore(false);
              }}
              onPointerLeave={() => {
                setBefore(false);
              }}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') setBefore(true);
              }}
              onKeyUp={() => {
                setBefore(false);
              }}
            >
              Hold for before
            </Button>
            <span className="text-xs text-muted">{before ? 'As it was taken' : 'As it will show'}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Rotate, flip and crop">
            <Button
              size="sm"
              icon={RotateCw}
              data-testid="pe-rotate"
              title="A quarter turn clockwise"
              onClick={() => setLook((l) => turnClockwise(l))}
            >
              Rotate
            </Button>
            <Button
              size="sm"
              icon={FlipHorizontal2}
              data-testid="pe-flip-across"
              aria-pressed={look.flipX === true}
              onClick={() => setLook((l) => flipAcross(l))}
            >
              Flip across
            </Button>
            <Button
              size="sm"
              icon={FlipVertical2}
              data-testid="pe-flip-down"
              aria-pressed={look.flipY === true}
              onClick={() => setLook((l) => flipUpDown(l))}
            >
              Flip up and down
            </Button>
            <Button
              size="sm"
              icon={Crop}
              data-testid="pe-crop"
              aria-pressed={cropping}
              disabled={!natural}
              onClick={() => {
                setCropping((c) => !c);
              }}
            >
              {cropping ? 'Done cropping' : 'Crop'}
            </Button>
          </div>
          {cropping && (
            <div className="flex flex-wrap items-center gap-2">
              <div
                role="radiogroup"
                aria-label="The crop’s shape"
                className="inline-flex rounded-md border border-line"
                data-testid="pe-crop-shapes"
                onKeyDown={radioKeys(CROP_SHAPES, shape, chooseShape)}
              >
                {CROP_SHAPES.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={shape === s}
                    tabIndex={radioTabIndex(shape === s, i, true)}
                    data-testid={`pe-crop-${s}`}
                    className={`px-2.5 py-1 text-sm ${shape === s ? 'bg-primary text-on-primary' : 'text-fg hover:bg-panel-3'}`}
                    onClick={() => {
                      chooseShape(s);
                    }}
                  >
                    {SHAPE_LABELS[s]}
                  </button>
                ))}
              </div>
              <Button
                size="sm"
                data-testid="pe-crop-whole"
                onClick={() => setLook(({ crop: _crop, ...rest }) => ({ ...rest, cropShape: 'free' }))}
              >
                The whole picture
              </Button>
            </div>
          )}
        </div>
        <div className="space-y-3">
          <Field label="Zoom">
            <Slider
              data-testid="pe-zoom"
              min={ZOOM.min * 100}
              max={ZOOM.max * 100}
              step={1}
              value={Math.round(look.zoom * 100)}
              format={(v) => `${String(v)}%`}
              onChange={(e) => {
                set({ zoom: Number(e.target.value) / 100 });
              }}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              icon={Minimize2}
              data-testid="pe-fit"
              onClick={() => set({ zoom: 1, x: 0, y: 0 })}
            >
              Fit
            </Button>
            <Button size="sm" icon={Maximize2} data-testid="pe-fill" onClick={fill}>
              Fill
            </Button>
            <Button
              size="sm"
              icon={RotateCcw}
              data-testid="pe-reset"
              onClick={() => set({ zoom: 1, x: 0, y: 0 })}
            >
              Reset
            </Button>
          </div>
          <Field label="Brightness">
            <Slider
              data-testid="pe-brightness"
              min={-50}
              max={50}
              step={1}
              value={Math.round(look.brightness * 100)}
              format={(v) => percent(v / 100)}
              onChange={(e) => {
                set({ brightness: Number(e.target.value) / 100 });
              }}
            />
          </Field>
          <Field label="Contrast">
            <Slider
              data-testid="pe-contrast"
              min={-50}
              max={50}
              step={1}
              value={Math.round(look.contrast * 100)}
              format={(v) => percent(v / 100)}
              onChange={(e) => {
                set({ contrast: Number(e.target.value) / 100 });
              }}
            />
          </Field>
          <Field label="Colour">
            <Slider
              data-testid="pe-colour"
              min={-100}
              max={100}
              step={1}
              value={Math.round(look.colour * 100)}
              format={(v) => percent(v / 100)}
              onChange={(e) => {
                set({ colour: Number(e.target.value) / 100 });
              }}
            />
          </Field>
          <Field label="Sharpness">
            <Slider
              data-testid="pe-sharpness"
              min={0}
              max={100}
              step={5}
              value={Math.round(look.sharpness * 100)}
              format={(v) => `${String(v)}%`}
              onChange={(e) => {
                set({ sharpness: Number(e.target.value) / 100 });
              }}
            />
          </Field>
          <Button icon={Wand2} data-testid="pe-auto" onClick={() => void auto()}>
            Auto
          </Button>
          <div className="space-y-1">
            <Toggle
              checked={fillOn}
              label="Blurred fill behind"
              data-testid="pe-blurred-fill"
              onChange={(on) => {
                // Kept only where it differs from the picture's own: on for a photo, off for a deck's slide.
                setLook((was) => {
                  const { fill: _fill, ...rest } = was;
                  return on === photo ? rest : { ...rest, fill: on };
                });
              }}
            />
            <p className="text-xs text-muted">
              Where the picture does not fill the screen, a blurred, darker copy of it shows behind it instead
              of black.
            </p>
          </div>
          <p className="text-xs text-muted">
            Auto sets the brightness and contrast from the picture itself. What you save is kept with the
            picture: it shows the same on every screen, a node, the stream and the thumbnails. The file is
            never changed.
          </p>
          {problem && (
            <p role="alert" className="text-sm text-danger-fg" data-testid="pe-problem">
              {problem}
            </p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
