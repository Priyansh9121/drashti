import { useEffect, useState } from 'react';
import type { PropItem } from '../../../shared/engine/state';
import type { SlideElement } from '../../../shared/model';
import { detectLang } from '../../../shared/text-runs';
import { useEngine } from '../engine/engine-store';
import { loadMedia, useMedia } from '../library/library-store';
import { Button, IconButton } from '../ui/Button';
import { ColorInput, NumberInput, Select, TextInput } from '../ui/Field';
import { Badge } from '../ui/Badge';
import { Plus, Stamp, Sticker, Trash2 } from '../ui/icons';
import { loadProps, markLogo, useLogo } from './logo-store';
import { Panel } from '../ui/Panel';
import { EmptyState, Loading } from '../ui/States';
import { Truncate } from '../ui/Truncate';
import { dispatch } from './actions';

/*
 * Props: a logo or a fixed line of text that stays up whatever slide is
 * live. They are made on a 1920 x 1080 canvas; screens scale them as they
 * do slides.
 */

const NO_PROPS: PropItem[] = [];
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
      className="space-y-2 rounded-lg border border-accent/60 bg-panel-2 p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex gap-4 text-sm" role="radiogroup" aria-label="Kind of prop">
        {(['text', 'picture'] as const).map((k) => (
          <label key={k} className="flex items-center gap-1.5">
            <input
              type="radio"
              name="prop-kind"
              className="accent-accent-strong"
              checked={kind === k}
              onChange={() => setKind(k)}
            />
            {k === 'text' ? 'Words' : 'Picture or video'}
          </label>
        ))}
      </div>
      {kind === 'text' ? (
        <>
          <TextInput
            aria-label="Prop words"
            placeholder="For example the mandir's name"
            className="w-full"
            value={text}
            maxLength={200}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <NumberInput
              aria-label="Prop size"
              min={16}
              max={200}
              unit="px"
              value={size}
              onChange={(e) => setSize(Number(e.target.value) || size)}
            />
            <ColorInput aria-label="Prop colour" value={color} onChange={(e) => setColor(e.target.value)} />
            <Select
              aria-label="Prop place"
              value={where}
              onChange={(e) => setWhere(e.target.value as 'top' | 'bottom')}
            >
              <option value="top">Along the top</option>
              <option value="bottom">Along the bottom</option>
            </Select>
            <Select
              aria-label="Prop alignment"
              value={align}
              onChange={(e) => setAlign(e.target.value as 'left' | 'center' | 'right')}
            >
              <option value="left">Left</option>
              <option value="center">Centre</option>
              <option value="right">Right</option>
            </Select>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Prop picture"
            className="max-w-full"
            value={picked?.id ?? ''}
            onChange={(e) => setMediaId(e.target.value)}
          >
            {pictures.length === 0 && <option value="">No pictures or videos in the library yet</option>}
            {pictures.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Prop corner"
            value={corner}
            onChange={(e) => setCorner(e.target.value as Corner)}
          >
            <option value="top-left">Top left</option>
            <option value="top-right">Top right</option>
            <option value="bottom-left">Bottom left</option>
            <option value="bottom-right">Bottom right</option>
          </Select>
          <Select
            aria-label="Prop picture size"
            value={scale}
            onChange={(e) => setScale(e.target.value as keyof typeof SIZES)}
          >
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </Select>
        </div>
      )}
      {problem && (
        <p role="alert" className="text-xs text-warning-fg">
          {problem}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm">
          Save
        </Button>
        <Button size="sm" onClick={() => onDone(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** The library's props: show and hide them over whatever slide is live, make new ones, delete. */
export function PropsPanel() {
  const props = useLogo((s) => s.props);
  const logoId = useLogo((s) => s.logoId);
  const [making, setMaking] = useState(false);
  const shown = useEngine((s) => s.state?.layers.props) ?? NO_PROPS;
  const reload = () => {
    void loadProps();
  };
  return (
    <Panel
      help="props"
      title="Props"
      icon={Sticker}
      collapsible
      remember="props"
      data-testid="props"
      bodyClassName="space-y-2 px-3 pb-3"
      actions={
        <Button variant="ghost" size="sm" icon={Plus} onClick={() => setMaking(true)}>
          New prop
        </Button>
      }
    >
      {making && (
        <NewProp
          onDone={(made) => {
            setMaking(false);
            if (made) reload();
          }}
        />
      )}
      {props === null && <Loading label="Loading the props…" />}
      <ul className="space-y-1">
        {(props ?? []).map((p) => {
          const up = shown.some((s) => s.id === p.id);
          return (
            <li
              key={p.id}
              data-testid="prop-row"
              data-shown={up ? 'true' : undefined}
              className="flex items-center gap-2 rounded-md border border-line bg-panel-2 py-1 pr-1 pl-2.5"
            >
              <Truncate text={p.imported ? `${p.name} (imported)` : p.name} className="flex-1 text-sm" />
              {p.id === logoId && <Badge tone="info">Logo</Badge>}
              <IconButton
                icon={Stamp}
                size="sm"
                variant={p.id === logoId ? 'secondary' : 'ghost'}
                label={
                  p.id === logoId
                    ? `${p.name} is the logo (choose again to unmark)`
                    : `Use ${p.name} as the logo`
                }
                aria-pressed={p.id === logoId}
                data-testid="use-as-logo"
                onClick={() => void markLogo(p.id === logoId ? null : p.id)}
              />
              <Button
                variant={up ? 'live' : 'secondary'}
                size="sm"
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
              <IconButton
                icon={Trash2}
                size="sm"
                label={`Delete ${p.name}`}
                onClick={() => {
                  void window.drashti.props.remove(p.id).then(reload);
                }}
              />
            </li>
          );
        })}
      </ul>
      {props?.length === 0 && !making && (
        <EmptyState icon={Sticker} title="No props yet" compact>
          A logo, or a line such as the mandir&apos;s name, over every slide.
        </EmptyState>
      )}
    </Panel>
  );
}
