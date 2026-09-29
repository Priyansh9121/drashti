import { useEffect, useState } from 'react';
import type { PropItem } from '../../../shared/engine/state';
import type { SlideElement } from '../../../shared/model';
import type { PropInfo } from '../../../shared/props';
import { detectLang } from '../../../shared/text-runs';
import { useEngine } from '../engine/engine-store';
import { loadMedia, useMedia } from '../library/library-store';
import { Button } from '../ui/Button';
import { dispatch } from './actions';

/*
 * Props: a logo or a fixed line of text that stays up whatever slide is
 * live. They are made on a 1920 x 1080 canvas; screens scale them as they
 * do slides.
 */

const NO_PROPS: PropItem[] = [];
const field =
  'rounded-md border border-line bg-ink px-2 py-1 text-sm text-white placeholder:text-muted focus-visible:outline-2 focus-visible:outline-accent';
const small = 'px-2 py-0.5 text-xs';
const W = 1920;
const H = 1080;
const MARGIN = 40;

type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
const SIZES = { small: 240, medium: 360, large: 480 } as const;

/** A line of text across the top or the bottom. */
function textElement(
  text: string,
  size: number,
  color: string,
  where: 'top' | 'bottom',
  align: 'left' | 'center' | 'right',
): SlideElement {
  const height = Math.round(size * 1.6);
  return {
    id: `prop-text-${Date.now()}`,
    kind: 'text',
    frame: { x: 60, y: where === 'top' ? MARGIN : H - MARGIN - height, width: W - 120, height },
    text,
    lang: detectLang(text),
    style: {
      fontFamily: null,
      fontSize: size,
      fontWeight: 600,
      color,
      align,
      verticalAlign: 'middle',
      lineHeight: 1.2,
      shadow: true,
    },
  };
}

/** A picture or video in a corner. */
function mediaElement(mediaId: string, media: 'image' | 'video', corner: Corner, side: number): SlideElement {
  return {
    id: `prop-media-${Date.now()}`,
    kind: media,
    frame: {
      x: corner.endsWith('left') ? MARGIN : W - MARGIN - side,
      y: corner.startsWith('top') ? MARGIN : H - MARGIN - side,
      width: side,
      height: side,
    },
    mediaId,
    fit: 'fit',
    ...(media === 'video' ? { loop: true } : {}),
  };
}

function NewProp({ onDone }: { onDone: (made: boolean) => void }) {
  const [kind, setKind] = useState<'text' | 'picture'>('text');
  const [text, setText] = useState('');
  const [size, setSize] = useState(48);
  const [color, setColor] = useState('#ffffff');
  const [where, setWhere] = useState<'top' | 'bottom'>('bottom');
  const [align, setAlign] = useState<'left' | 'center' | 'right'>('center');
  const media = useMedia((s) => s.media);
  const pictures = media.filter((m) => m.kind !== 'audio' && !m.missing && m.unplayable === null);
  const [mediaId, setMediaId] = useState('');
  const [corner, setCorner] = useState<Corner>('top-right');
  const [scale, setScale] = useState<keyof typeof SIZES>('medium');
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    void loadMedia();
  }, []);
  const picked = pictures.find((m) => m.id === mediaId) ?? pictures[0];
  const save = async () => {
    const element =
      kind === 'text'
        ? text.trim() === ''
          ? null
          : textElement(text.trim(), size, color, where, align)
        : picked
          ? mediaElement(picked.id, picked.kind === 'video' ? 'video' : 'image', corner, SIZES[scale])
          : null;
    if (!element) {
      setProblem(kind === 'text' ? 'Type the words first.' : 'Import a picture or video first.');
      return;
    }
    const name = (kind === 'text' ? text.trim() : (picked?.name ?? 'Picture')).slice(0, 80);
    const result = await window.drashti.props.save(null, { name, width: W, height: H, elements: [element] });
    if (result.ok) onDone(true);
    else setProblem(result.message);
  };
  return (
    <form
      data-testid="prop-form"
      className="space-y-2 rounded-md border border-accent/60 bg-panel-2 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex gap-3 text-sm" role="radiogroup" aria-label="Kind of prop">
        {(['text', 'picture'] as const).map((k) => (
          <label key={k} className="flex items-center gap-1">
            <input type="radio" name="prop-kind" checked={kind === k} onChange={() => setKind(k)} />
            {k === 'text' ? 'Words' : 'Picture or video'}
          </label>
        ))}
      </div>
      {kind === 'text' ? (
        <>
          <input
            aria-label="Prop words"
            placeholder="For example the mandir's name"
            className={`${field} w-full`}
            value={text}
            maxLength={200}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="Prop size"
              type="number"
              min={16}
              max={200}
              className={`${field} w-20`}
              value={size}
              onChange={(e) => setSize(Number(e.target.value) || size)}
            />
            <input
              aria-label="Prop colour"
              type="color"
              className="h-8 w-12 rounded border border-line bg-ink"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
            <select
              aria-label="Prop place"
              className={field}
              value={where}
              onChange={(e) => setWhere(e.target.value as 'top' | 'bottom')}
            >
              <option value="top">Along the top</option>
              <option value="bottom">Along the bottom</option>
            </select>
            <select
              aria-label="Prop alignment"
              className={field}
              value={align}
              onChange={(e) => setAlign(e.target.value as 'left' | 'center' | 'right')}
            >
              <option value="left">Left</option>
              <option value="center">Centre</option>
              <option value="right">Right</option>
            </select>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Prop picture"
            className={`${field} max-w-full`}
            value={picked?.id ?? ''}
            onChange={(e) => setMediaId(e.target.value)}
          >
            {pictures.length === 0 && <option value="">No pictures or videos in the library yet</option>}
            {pictures.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Prop corner"
            className={field}
            value={corner}
            onChange={(e) => setCorner(e.target.value as Corner)}
          >
            <option value="top-left">Top left</option>
            <option value="top-right">Top right</option>
            <option value="bottom-left">Bottom left</option>
            <option value="bottom-right">Bottom right</option>
          </select>
          <select
            aria-label="Prop picture size"
            className={field}
            value={scale}
            onChange={(e) => setScale(e.target.value as keyof typeof SIZES)}
          >
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </div>
      )}
      {problem && <p className="text-xs text-amber-200">{problem}</p>}
      <div className="flex gap-2">
        <Button type="submit" tone="primary" className={small}>
          Save
        </Button>
        <Button className={small} onClick={() => onDone(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** The library's props: show and hide them over whatever slide is live, make new ones, delete. */
export function PropsPanel() {
  const [props, setProps] = useState<PropInfo[]>([]);
  const [making, setMaking] = useState(false);
  const shown = useEngine((s) => s.state?.layers.props) ?? NO_PROPS;
  const reload = () => {
    void window.drashti.props.list().then(setProps);
  };
  useEffect(() => {
    reload();
    // Props can arrive with an import.
    return window.drashti.library.onChanged(reload);
  }, []);
  return (
    <section aria-label="Props" data-testid="props" className="space-y-2">
      <div className="flex items-center">
        <h2 className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted">Props</h2>
        <Button tone="ghost" className={small} onClick={() => setMaking(true)}>
          + Prop
        </Button>
      </div>
      {making && (
        <NewProp
          onDone={(made) => {
            setMaking(false);
            if (made) reload();
          }}
        />
      )}
      <ul className="space-y-1">
        {props.map((p) => {
          const up = shown.some((s) => s.id === p.id);
          return (
            <li
              key={p.id}
              data-testid="prop-row"
              data-shown={up ? 'true' : undefined}
              className="flex items-center gap-2 rounded-md border border-line bg-panel-2 px-2 py-1"
            >
              <span
                className="min-w-0 flex-1 truncate text-sm"
                title={p.imported ? `${p.name} (imported)` : p.name}
              >
                {p.name}
              </span>
              <Button
                tone={up ? 'live' : 'default'}
                className={small}
                onClick={() =>
                  void dispatch(
                    up
                      ? { type: 'hideProp', propId: p.id }
                      : {
                          type: 'showProp',
                          prop: {
                            id: p.id,
                            name: p.name,
                            elements: p.elements,
                            width: p.width,
                            height: p.height,
                          },
                        },
                  )
                }
              >
                {up ? 'Hide' : 'Show'}
              </Button>
              <Button
                tone="ghost"
                className={small}
                aria-label={`Delete ${p.name}`}
                onClick={() => {
                  void window.drashti.props.remove(p.id).then(reload);
                }}
              >
                ×
              </Button>
            </li>
          );
        })}
      </ul>
      {props.length === 0 && !making && (
        <p className="text-xs text-muted">
          No props yet: a logo, or a line such as the mandir&apos;s name, over every slide.
        </p>
      )}
    </section>
  );
}
