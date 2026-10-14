import { useEffect, useRef, useState } from 'react';
import type { PointerEvent, WheelEvent } from 'react';
import { create } from 'zustand';
import { mediaUrl } from '../../../shared/media';
import type { PictureLook } from '../../../shared/picture-look';
import { autoLevels, fillZoom, framed, isPlain, PLAIN, ZOOM } from '../../../shared/picture-look';
import { frameTransform, lookFilter } from '../render/picture-looks';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Slider } from '../ui/Field';
import { Maximize2, Minimize2, RotateCcw, Wand2 } from '../ui/icons';

/*
 * The Picture editor (Session 26e, shared/picture-look.ts): a picture
 * zoomed 100 to 400 % and moved by dragging (Fit, Fill, Reset), its
 * brightness, contrast, colour and sharpness, and Auto, which sets its
 * levels from the picture itself; Before shows it as it is. What is saved is
 * kept with the picture, so it looks the same wherever it shows. The file
 * is never changed.
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

export function PictureEditor() {
  const media = usePictureEditor((s) => s.media);
  const [loaded, setLoaded] = useState<{ id: string; look: PictureLook } | null>(null);
  useEffect(() => {
    if (!media) return;
    let live = true;
    void window.drashti.media.look(media.id).then((look) => {
      if (live) setLoaded({ id: media.id, look: look ?? PLAIN });
    });
    return () => {
      live = false;
    };
  }, [media]);
  if (!media || loaded?.id !== media.id) return null;
  return <EditorForm key={media.id} media={media} start={loaded.look} />;
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

function EditorForm({ media, start }: { media: { id: string; name: string }; start: PictureLook }) {
  const [look, setLook] = useState<PictureLook>(start);
  const [before, setBefore] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; from: PictureLook } | null>(null);
  const set = (change: Partial<PictureLook>) => {
    setLook((was) => framed({ ...was, ...change }));
  };
  const box = () => frame.current?.getBoundingClientRect() ?? null;
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, from: look };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const b = box();
    if (!d || !b || b.width === 0) return;
    set({ x: d.from.x + (e.clientX - d.x) / b.width, y: d.from.y + (e.clientY - d.y) / b.height });
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    set({ zoom: look.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1) });
  };
  const fill = () => {
    const img = picture.current;
    const b = box();
    if (!img || !b) return;
    set({ zoom: fillZoom({ width: img.naturalWidth, height: img.naturalHeight }, b), x: 0, y: 0 });
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
    const result = await window.drashti.media.setLook(media.id, isPlain(look) ? null : look);
    if (result.ok) close();
    else setProblem(result.message);
  };
  const shown = before ? PLAIN : look;
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
            aria-label={`${media.name}, as the screens will show it. Drag to move it; scroll to zoom.`}
            role="img"
            className="relative aspect-video w-full cursor-grab touch-none overflow-hidden rounded-md border border-line bg-black active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => {
              drag.current = null;
            }}
            onWheel={onWheel}
          >
            <div
              data-testid="pe-picture"
              style={{
                position: 'absolute',
                inset: 0,
                transformOrigin: '50% 50%',
                transform: frameTransform(shown) || undefined,
                filter: lookFilter(shown) || undefined,
              }}
            >
              <img
                ref={picture}
                // Read for Auto: the media protocol allows it (as the stills do).
                crossOrigin="anonymous"
                src={mediaUrl(media.id)}
                alt=""
                draggable={false}
                className="pointer-events-none absolute inset-0 h-full w-full object-contain"
              />
            </div>
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
