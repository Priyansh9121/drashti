import { useEffect, useId, useState } from 'react';
import type { EngineCommand } from '../../../shared/engine/commands';
import type { PipCorner, PipMotion, PipPlace, PipSize, PipSource } from '../../../shared/engine/state';
import { PIP_CORNERS, PIP_MOTIONS, PIP_SIZES } from '../../../shared/engine/state';
import { SCREEN_RECORDING_STEPS, type WindowList, WINDOWS_FAILED } from '../../../shared/live-window';
import { DEFAULT_PIP_PLACE } from '../../../shared/pip';
import type { VideoInput } from '../../../shared/video-inputs';
import { useEngine } from '../engine/engine-store';
import { loadMedia, useMedia } from '../library/library-store';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { Dialog } from '../ui/Dialog';
import { Field, Select } from '../ui/Field';
import type { Icon } from '../ui/icons';
import {
  AppWindow,
  ArrowLeftRight,
  Image,
  PictureInPicture2,
  Presentation,
  RotateCw,
  Settings,
  Video,
  X,
} from '../ui/icons';
import { Notice } from '../ui/Notice';
import { radioKeys, radioTabIndex } from '../ui/radio';
import { Toggle } from '../ui/Toggle';
import { dispatch } from './actions';
import { boxName, boxWhere, closePipDialog, placeBox, rememberedPlace, usePipUi } from './pip-store';

/*
 * Picture in Picture… (Session 50): what goes in the box on the audience screens (a video input, a picture or
 * video from Media, a window from Show a Window…'s list, or the slides, made small while the main picture shows
 * the background), and where it sits and how it looks: a corner (or dragged anywhere in LIVE), Small, Medium or
 * Large, a thin border and rounded corners, and how it comes on and goes off. Those are on the screens at once
 * while a box is up, and remembered in the library for the next. Swap and Take off are here and under LIVE.
 * Nothing goes up until Show in the box. Pro Mode only (the library's Media tools, beside Show a Window…).
 */

type Kind = PipSource['kind'];

const KINDS: { id: Kind; label: string; hint: string; icon: Icon }[] = [
  {
    id: 'slides',
    label: 'The slides',
    hint: 'Made small; the main picture shows the background',
    icon: Presentation,
  },
  { id: 'input', label: 'A video input', hint: 'A camera or a capture input on this computer', icon: Video },
  { id: 'media', label: 'A picture or video', hint: 'From Media; a video plays without sound', icon: Image },
  {
    id: 'window',
    label: 'A window',
    hint: 'Another app’s window, as Show a Window… offers',
    icon: AppWindow,
  },
];

const CORNER_NAMES: Record<PipCorner, string> = {
  'top-left': 'Top left',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right',
};

const SIZE_NAMES: Record<PipSize, { label: string; hint: string }> = {
  small: { label: 'Small', hint: 'A quarter of the width' },
  medium: { label: 'Medium', hint: 'A third of the width' },
  large: { label: 'Large', hint: 'Two fifths of the width' },
};

const MOTION_NAMES: Record<PipMotion, string> = {
  fade: 'Fade',
  scale: 'Scale',
  slide: 'Slide in from its corner',
};

const GRID: Record<2 | 3 | 4, string> = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' };

/** A row of choices, one Tab stop, the arrows moving the choice (ui/radio.ts). */
function Choices<T extends string>({
  labelledBy,
  choices,
  value,
  onChoose,
  testId,
  columns,
}: {
  labelledBy: string;
  choices: readonly { id: T; label: string; hint?: string; icon?: Icon }[];
  value: T | null;
  onChoose: (choice: T) => void;
  testId: string;
  columns: 2 | 3 | 4;
}) {
  const first = choices[0]?.id;
  if (first === undefined) return null;
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className={cx('grid gap-1.5', GRID[columns])}
      onKeyDown={radioKeys(
        choices.map((c) => c.id),
        value ?? first,
        onChoose,
      )}
    >
      {choices.map((c, i) => {
        const on = c.id === value;
        const IconShape = c.icon;
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={radioTabIndex(on, i, value !== null)}
            data-testid={`${testId}-${c.id}`}
            onClick={() => {
              onChoose(c.id);
            }}
            className={cx(
              'flex min-w-0 items-start gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm',
              on
                ? 'border-accent bg-panel-3 font-bold text-fg'
                : 'border-field bg-panel-2 text-muted hover:border-muted',
            )}
          >
            {IconShape && <IconShape size={16} aria-hidden="true" className="mt-0.5 shrink-0" />}
            <span className="min-w-0">
              <span className="block">{c.label}</span>
              {c.hint && <span className="block text-xs font-normal text-muted">{c.hint}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** This computer's video inputs, as Media names them, followed while the dialog is open. */
function useInputs(open: boolean): VideoInput[] | null {
  const [inputs, setInputs] = useState<VideoInput[] | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    const off = window.drashti.videoInputs.onChanged((view) => {
      if (live) setInputs(view.inputs);
    });
    window.drashti.videoInputs.list().then(
      (view) => {
        if (live) setInputs(view.inputs);
      },
      () => {
        if (live) setInputs([]);
      },
    );
    return () => {
      live = false;
      off();
    };
  }, [open]);
  return inputs;
}

/** The other apps' open windows, as Show a Window… offers them (read when asked; Look again reads them anew). */
function useWindows(wanted: boolean): { list: WindowList | null; again: () => void } {
  const [list, setList] = useState<WindowList | null>(null);
  const [asks, setAsks] = useState(0);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    window.drashti.liveWindow.list().then(
      (next) => {
        if (live) setList(next);
      },
      () => {
        if (live) setList({ ok: false, reason: 'unlisted', message: WINDOWS_FAILED });
      },
    );
    return () => {
      live = false;
    };
  }, [wanted, asks]);
  return {
    list,
    again: () => {
      setList(null);
      setAsks((n) => n + 1);
    },
  };
}

export function PipDialog() {
  const open = usePipUi((s) => s.open);
  if (!open) return null;
  return <PipDialogBody />;
}

function PipDialogBody() {
  const box = useEngine((s) => s.state?.layers.pip ?? null);
  const allMedia = useMedia((s) => s.media);
  const mediaLoaded = useMedia((s) => s.loaded);
  const chosenRow = useMedia((s) => s.anchorId);
  const [kind, setKind] = useState<Kind>(() => box?.source.kind ?? 'slides');
  const [inputId, setInputId] = useState<string | null>(() =>
    box?.source.kind === 'input' ? box.source.inputId : null,
  );
  const [mediaId, setMediaId] = useState<string | null>(() =>
    box?.source.kind === 'media' ? box.source.mediaId : null,
  );
  const [windowId, setWindowId] = useState<string | null>(() =>
    box?.source.kind === 'window' ? box.source.sourceId : null,
  );
  // The place shown: the box's while one is up, else the one the library remembers.
  const [place, setPlace] = useState<PipPlace>(() => box?.place ?? DEFAULT_PIP_PLACE);
  // Changed here: the place the library remembers, read meanwhile, never undoes it.
  const [touched, setTouched] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputs = useInputs(true);
  const windows = useWindows(kind === 'window');
  const kindsId = useId();
  const whereId = useId();
  const sizeId = useId();
  const motionId = useId();

  useEffect(() => {
    if (!mediaLoaded) void loadMedia();
  }, [mediaLoaded]);
  // With no box up, the place the library remembers, once it is read.
  const up = box !== null;
  useEffect(() => {
    if (up || touched) return;
    let live = true;
    void rememberedPlace().then((remembered) => {
      if (live) setPlace(remembered);
    });
    return () => {
      live = false;
    };
  }, [up, touched]);

  const media = allMedia.filter(
    (m) => (m.kind === 'image' || m.kind === 'video') && !m.missing && m.unplayable === null,
  );
  const offered = windows.list?.ok ? windows.list.windows : [];
  // What is chosen of each kind: as picked, else the Media list's chosen row, else the first there is.
  const input = inputs?.find((i) => i.id === inputId) ?? inputs?.[0] ?? null;
  const picture =
    media.find((m) => m.id === mediaId) ?? media.find((m) => m.id === chosenRow) ?? media[0] ?? null;
  const win = offered.find((w) => w.id === windowId) ?? (offered.length === 1 ? offered[0] : null) ?? null;
  const source: Extract<EngineCommand, { type: 'showPip' }>['source'] | null =
    kind === 'slides'
      ? { kind: 'slides' }
      : kind === 'input'
        ? input && { kind: 'input', inputId: input.id }
        : kind === 'media'
          ? picture && { kind: 'media', mediaId: picture.id }
          : win && { kind: 'window', id: win.id };
  // Already in the box: nothing to put up.
  const same =
    box !== null &&
    source !== null &&
    source.kind === box.source.kind &&
    (source.kind === 'slides' ||
      (source.kind === 'input' && box.source.kind === 'input' && source.inputId === box.source.inputId) ||
      (source.kind === 'media' && box.source.kind === 'media' && source.mediaId === box.source.mediaId));

  const change = (next: Partial<PipPlace>) => {
    const changed = { ...place, ...next };
    setTouched(true);
    setPlace(changed);
    void placeBox(changed).then(setProblem);
  };
  const show = async () => {
    if (!source) return;
    setBusy(true);
    const result = await window.drashti.engine.dispatch({ type: 'showPip', source, place });
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    closePipDialog();
  };

  return (
    <Dialog
      title="Picture in Picture"
      subtitle="Something small in a corner of the hall’s screens while the main picture carries on: a camera, a picture or video, a window, or the slides. Nothing goes up until you press Show in the box."
      onClose={closePipDialog}
      closeLabel="Close Picture in Picture"
      size="md"
      testId="pip-dialog"
      footer={
        <>
          <Button onClick={closePipDialog}>Close</Button>
          <Button
            variant="primary"
            icon={PictureInPicture2}
            data-testid="pip-show"
            disabled={source === null || same || busy}
            onClick={() => void show()}
          >
            {up ? 'Put this in the box' : 'Show in the box'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {problem && (
          <Notice tone="danger" compact onDismiss={() => setProblem(null)}>
            {problem}
          </Notice>
        )}
        {box && (
          <div
            role="status"
            data-testid="pip-now"
            className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-panel-2 px-3 py-2 text-sm"
          >
            <span className="min-w-0 flex-1">
              <span className="block font-bold">In the box now: {boxName(box.source, allMedia)}</span>
              <span className="block text-xs text-muted">{boxWhere(box)}</span>
            </span>
            <Button
              size="sm"
              instant
              icon={ArrowLeftRight}
              data-testid="pip-swap"
              onClick={() => void dispatch({ type: 'swapPip' })}
            >
              Swap
            </Button>
            <Button
              size="sm"
              instant
              icon={X}
              data-testid="pip-take-off"
              onClick={() => void dispatch({ type: 'hidePip' })}
            >
              Take off
            </Button>
          </div>
        )}

        <section className="space-y-2">
          <h3 id={kindsId} className="text-xs font-medium text-muted">
            What goes in the box
          </h3>
          <Choices
            labelledBy={kindsId}
            choices={KINDS}
            value={kind}
            onChoose={setKind}
            testId="pip-kind"
            columns={2}
          />
          {kind === 'slides' && (
            <p className="text-xs text-muted">
              The slide as designed, made small. The main picture shows the background, the props, messages
              and the ticker without it.
            </p>
          )}
          {kind === 'input' &&
            (inputs === null ? (
              <p className="text-xs text-muted">Looking for video inputs…</p>
            ) : inputs.length === 0 ? (
              <p className="text-xs text-muted" data-testid="pip-no-inputs">
                No video inputs yet: name one under Video inputs in Media first.
              </p>
            ) : (
              <Field label="Video input">
                <Select
                  data-testid="pip-input"
                  value={input?.id ?? ''}
                  onChange={(e) => {
                    setInputId(e.target.value);
                  }}
                >
                  {inputs.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          {kind === 'media' &&
            (!mediaLoaded ? (
              <p className="text-xs text-muted">Looking for pictures and videos…</p>
            ) : media.length === 0 ? (
              <p className="text-xs text-muted" data-testid="pip-no-media">
                No pictures or videos in Media yet: import some first.
              </p>
            ) : (
              <Field label="Picture or video">
                <Select
                  data-testid="pip-media"
                  value={picture?.id ?? ''}
                  onChange={(e) => {
                    setMediaId(e.target.value);
                  }}
                >
                  {media.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          {kind === 'window' && (
            <WindowChoice
              list={windows.list}
              chosen={win?.id ?? null}
              choose={setWindowId}
              again={windows.again}
            />
          )}
        </section>

        <section className="space-y-2">
          <h3 id={whereId} className="text-xs font-medium text-muted">
            Where it sits
          </h3>
          <Choices
            labelledBy={whereId}
            choices={PIP_CORNERS.map((id) => ({ id, label: CORNER_NAMES[id] }))}
            value={place.corner}
            onChoose={(corner) => {
              change({ corner });
            }}
            testId="pip-corner"
            columns={4}
          />
          <p className="text-xs text-muted" data-testid="pip-where">
            {place.corner === null
              ? `Where it was dragged: ${String(Math.round(place.x * 100))}% across, ${String(Math.round(place.y * 100))}% down. Choose a corner, or drag the box in LIVE.`
              : 'Or drag the box in LIVE to put it anywhere on the screen.'}
          </p>
        </section>

        <section className="space-y-2">
          <h3 id={sizeId} className="text-xs font-medium text-muted">
            Size
          </h3>
          <Choices
            labelledBy={sizeId}
            choices={PIP_SIZES.map((id) => ({ id, ...SIZE_NAMES[id] }))}
            value={place.size}
            onChoose={(size) => {
              change({ size });
            }}
            testId="pip-size"
            columns={3}
          />
          <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
            <Toggle
              label="A thin border"
              checked={place.border}
              onChange={(border) => {
                change({ border });
              }}
              data-testid="pip-border"
            />
            <Toggle
              label="Rounded corners"
              checked={place.rounded}
              onChange={(rounded) => {
                change({ rounded });
              }}
              data-testid="pip-rounded"
            />
          </div>
        </section>

        <section className="space-y-2">
          <h3 id={motionId} className="text-xs font-medium text-muted">
            How it comes on and goes off
          </h3>
          <Choices
            labelledBy={motionId}
            choices={PIP_MOTIONS.map((id) => ({ id, label: MOTION_NAMES[id] }))}
            value={place.motion}
            onChoose={(motion) => {
              change({ motion });
            }}
            testId="pip-motion"
            columns={3}
          />
          <p className="text-xs text-muted">
            Swap and moving it move the same way, Calm or Bold as each group’s Look says. The box makes no
            sound: a video in it plays muted.
          </p>
        </section>
      </div>
    </Dialog>
  );
}

/** A window for the box, from the other apps' open windows (never Drashti's own, never a whole display). */
function WindowChoice({
  list,
  chosen,
  choose,
  again,
}: {
  list: WindowList | null;
  chosen: string | null;
  choose: (id: string) => void;
  again: () => void;
}) {
  if (list === null) return <p className="text-xs text-muted">Looking for open windows…</p>;
  if (!list.ok && list.reason === 'permission')
    return (
      <Notice
        tone="info"
        title="Let Drashti see other apps’ windows"
        data-testid="pip-window-permission"
        actions={
          <>
            <Button
              variant="primary"
              size="sm"
              icon={Settings}
              onClick={() => void window.drashti.liveWindow.access()}
            >
              Open System Settings
            </Button>
            <Button size="sm" icon={RotateCw} onClick={again}>
              Look again
            </Button>
          </>
        }
      >
        {list.message} {SCREEN_RECORDING_STEPS}
      </Notice>
    );
  if (!list.ok)
    return (
      <Notice tone="warning" compact>
        {list.message}
      </Notice>
    );
  if (list.windows.length === 0)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted" data-testid="pip-no-windows">
          No other app has a window open: open it first (in Zoom, join the meeting), then look again.
        </p>
        <Button size="sm" icon={RotateCw} onClick={again}>
          Look again
        </Button>
      </div>
    );
  return (
    <div className="flex items-end gap-2">
      <Field label="Window" className="min-w-0 flex-1">
        <Select
          data-testid="pip-window"
          value={chosen ?? ''}
          onChange={(e) => {
            choose(e.target.value);
          }}
        >
          {chosen === null && <option value="">Choose a window…</option>}
          {list.windows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
      </Field>
      <Button size="md" icon={RotateCw} onClick={again}>
        Look again
      </Button>
    </div>
  );
}
