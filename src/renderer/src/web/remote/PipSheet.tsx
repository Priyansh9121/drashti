import { useState } from 'react';
import type { PipCorner, PipLayer, PipSize, PipSource } from '../../../../shared/engine/state';
import { PIP_CORNERS, PIP_SIZES } from '../../../../shared/engine/state';
import { PIP_CORNER_NAMES, PIP_SIZE_NAMES } from '../../../../shared/pip';
import { useEngine } from '../../engine/engine-store';
import { pipName } from '../../render/pip';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import type { Icon } from '../../ui/icons';
import { AppWindow, ArrowLeftRight, Image, Presentation, Search, Video, X } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { api } from '../device';
import { tap } from '../taps';
import { closeSheet, lookForWindows, useDesktop } from './desktop-store';
import { loadMedia, useMirror } from './mirror-store';
import { PhoneSheet } from './PhoneSheet';

/*
 * The picture-in-picture box from a phone (Session 54, the phone as a full Drashti), as Picture in Picture… sets it
 * up on the Drashti computer: what goes in it (the slides, one of Media's video inputs, a picture or video from
 * Media, or a window from the list the computer makes), each named by its id, never a file or an address; Swap and
 * Take off; and, while it is up, its corner and size, on every screen at once. Pro Mode's: in Simple Mode Drashti
 * refuses them, and says so here.
 */

type Kind = PipSource['kind'];

const KINDS: { id: Kind; label: string; icon: Icon }[] = [
  { id: 'media', label: 'A picture or video', icon: Image },
  { id: 'input', label: 'A video input', icon: Video },
  { id: 'window', label: 'A window', icon: AppWindow },
  { id: 'slides', label: 'The slides', icon: Presentation },
];

const FIELD = 'h-12 w-full rounded-lg border border-field bg-panel-3 px-3 text-base text-fg';

const post = (path: string, body?: unknown) => () => api<{ rev?: number }>(path, { method: 'POST', body });

/** Put this in the box: where the box is now, else where the computer's library remembers. */
const show = (source: Record<string, unknown>) => void tap(post('/api/v1/pip/show', { source }));

/** A row of choices, the one chosen pressed. */
function Choices<T extends string>({
  label,
  choices,
  value,
  onChoose,
  testId,
}: {
  label: string;
  choices: readonly { id: T; label: string; hint?: string; icon?: Icon }[];
  value: T | null;
  onChoose: (id: T) => void;
  testId: string;
}) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-2 gap-2" data-testid={testId}>
      {choices.map((c) => (
        <Button
          key={c.id}
          size="lg"
          wrap
          className={cx('min-h-12 w-full', value === c.id && 'ring-2 ring-accent')}
          variant={value === c.id ? 'strong' : 'secondary'}
          aria-pressed={value === c.id}
          {...(c.icon ? { icon: c.icon } : {})}
          {...(c.hint ? { title: c.hint } : {})}
          data-testid={`${testId}-${c.id}`}
          onClick={() => {
            onChoose(c.id);
          }}
        >
          {c.label}
        </Button>
      ))}
    </div>
  );
}

/** What is in the box now, its Swap and its Take off. */
function NowInTheBox({ box }: { box: PipLayer | null }) {
  const media = useMirror((s) => s.media.list);
  if (!box)
    return (
      <p className="text-base text-muted" data-testid="remote-pip-none">
        Nothing is in the box now.
      </p>
    );
  const source = box.source;
  const name =
    source.kind === 'media'
      ? (media?.find((m) => m.id === source.mediaId)?.name ?? pipName(source))
      : pipName(source);
  return (
    <section className="space-y-2" aria-label="In the box now" data-testid="remote-pip-now">
      <p className="text-base text-fg">
        In the box now: <span className="font-bold">{name}</span>
        {box.swapped ? ' (swapped: full on the screens, the background small in the box)' : ''}.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="lg"
          className="min-h-12 w-full"
          icon={ArrowLeftRight}
          data-testid="remote-pip-swap"
          onClick={() => void tap(post('/api/v1/pip/swap'))}
        >
          Swap
        </Button>
        <Button
          size="lg"
          className="min-h-12 w-full"
          icon={X}
          data-testid="remote-pip-sheet-take-off"
          onClick={() => void tap(post('/api/v1/clear/pip'))}
        >
          Take off
        </Button>
      </div>
    </section>
  );
}

/** Where the box up now sits and how big it is: changed on every screen at once. */
function Place({ box }: { box: PipLayer }) {
  const move = (place: Partial<PipLayer['place']>) =>
    void tap(post('/api/v1/pip/place', { place: { ...box.place, ...place } }));
  return (
    <section className="space-y-2" aria-label="Where the box is" data-testid="remote-pip-place">
      <Choices<PipCorner>
        label="Its corner"
        choices={PIP_CORNERS.map((id) => ({ id, label: PIP_CORNER_NAMES[id] }))}
        value={box.place.corner}
        testId="remote-pip-corner"
        onChoose={(corner) => {
          move({ corner });
        }}
      />
      <Choices<PipSize>
        label="Its size"
        choices={PIP_SIZES.map((id) => ({ id, ...PIP_SIZE_NAMES[id] }))}
        value={box.place.size}
        testId="remote-pip-size"
        onChoose={(size) => {
          move({ size });
        }}
      />
    </section>
  );
}

/** Media's pictures and videos (found by name), one put in the box by a tap. */
function MediaChoices() {
  const media = useMirror((s) => s.media);
  const [query, setQuery] = useState(media.query);
  const shown = (media.list ?? []).filter(
    (m) => (m.kind === 'image' || m.kind === 'video') && !m.missing && !m.unplayable,
  );
  return (
    <div className="space-y-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void loadMedia({ query });
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">Find in Media</span>
          <input
            className={FIELD}
            type="search"
            value={query}
            placeholder="Find in Media"
            data-testid="remote-pip-media-search"
            onChange={(e) => {
              setQuery(e.target.value);
            }}
          />
        </label>
        <Button type="submit" size="lg" className="min-h-12" icon={Search}>
          Find
        </Button>
      </form>
      {media.list === null ? (
        <p className="text-base text-muted">Looking in Media…</p>
      ) : shown.length === 0 ? (
        <p className="text-base text-muted">
          No picture or video in Media{media.query ? ' by that name' : ''}.
        </p>
      ) : (
        <ul className="space-y-2" aria-label="Pictures and videos in Media" data-testid="remote-pip-media">
          {shown.map((m) => (
            <li key={m.id}>
              <Button
                size="lg"
                wrap
                className="min-h-12 w-full justify-start"
                icon={m.kind === 'video' ? Video : Image}
                data-testid="remote-pip-media-item"
                data-media-id={m.id}
                onClick={() => {
                  show({ kind: 'media', mediaId: m.id });
                }}
              >
                {m.name}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Media's video inputs, one put in the box by a tap. */
function InputChoices() {
  const inputs = useDesktop((s) => s.inputs);
  if (!inputs) return <p className="text-base text-muted">Reading the video inputs…</p>;
  if (inputs.inputs.length === 0)
    return (
      <p className="text-base text-muted">
        The Drashti computer has no video inputs yet: name one under Video inputs and windows….
      </p>
    );
  return (
    <ul className="space-y-2" aria-label="Video inputs" data-testid="remote-pip-inputs">
      {inputs.inputs.map((i) => (
        <li key={i.id}>
          <Button
            size="lg"
            wrap
            className="min-h-12 w-full justify-start"
            icon={Video}
            data-testid="remote-pip-input"
            onClick={() => {
              show({ kind: 'input', inputId: i.id });
            }}
          >
            {i.name}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** The other apps' windows as the computer lists them now (by name), one put in the box by a tap. */
function WindowChoices() {
  const windows = useDesktop((s) => s.windows);
  const looking = useDesktop((s) => s.lookingForWindows);
  return (
    <div className="space-y-2">
      <Button
        size="lg"
        className="min-h-12 w-full"
        icon={Search}
        disabled={looking}
        data-testid="remote-pip-look-for-windows"
        onClick={() => void lookForWindows()}
      >
        {looking ? 'Looking for windows…' : 'Look for windows'}
      </Button>
      {windows && !windows.ok && <Notice tone="warning">{windows.message}</Notice>}
      {windows?.ok && windows.windows.length === 0 && (
        <p className="text-base text-muted">No other app has a window open on the Drashti computer.</p>
      )}
      {windows?.ok && windows.windows.length > 0 && (
        <ul
          className="space-y-2"
          aria-label="Windows on the Drashti computer"
          data-testid="remote-pip-windows"
        >
          {windows.windows.map((w) => (
            <li key={w.id}>
              <Button
                size="lg"
                wrap
                className="min-h-12 w-full justify-start"
                icon={AppWindow}
                data-testid="remote-pip-window"
                onClick={() => {
                  show({ kind: 'window', id: w.id });
                }}
              >
                {w.name}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PipSheet() {
  const box = useEngine((s) => s.state?.layers.pip ?? null);
  const [kind, setKind] = useState<Kind>('media');
  return (
    <PhoneSheet
      title="Picture in picture"
      subtitle="The box over the Drashti computer’s audience screens"
      testId="remote-pip-sheet"
      onClose={closeSheet}
    >
      <NowInTheBox box={box} />
      {box && <Place box={box} />}
      <section className="space-y-3" aria-labelledby="remote-pip-put-title">
        <h3 id="remote-pip-put-title" className="text-base font-bold text-fg">
          Put in the box
        </h3>
        <Choices<Kind>
          label="What goes in the box"
          choices={KINDS}
          value={kind}
          testId="remote-pip-kind"
          onChoose={setKind}
        />
        {kind === 'media' && <MediaChoices />}
        {kind === 'input' && <InputChoices />}
        {kind === 'window' && <WindowChoices />}
        {kind === 'slides' && (
          <div className="space-y-2">
            <p className="text-base text-muted">
              Made small in the box; the main picture shows the background.
            </p>
            <Button
              size="lg"
              variant="primary"
              className="min-h-12 w-full"
              icon={Presentation}
              data-testid="remote-pip-slides"
              onClick={() => {
                show({ kind: 'slides' });
              }}
            >
              The slides in the box
            </Button>
          </div>
        )}
      </section>
    </PhoneSheet>
  );
}
