import { useState } from 'react';
import type { LiveFit } from '../../../../shared/engine/state';
import {
  CAMERA_AT_COMPUTER,
  CAMERAS_NOT_LISTED,
  type RemoteInputs,
} from '../../../../shared/network-desktop';
import type { VideoInput } from '../../../../shared/video-inputs';
import { useEngine } from '../../engine/engine-store';
import { Badge, LiveBadge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { AppWindow, Eraser, Pencil, Plus, Search, Trash2, Video } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { FIT_WORDS, nameProblem, nextInputName } from '../../video-inputs/words';
import { api } from '../device';
import { tap } from '../taps';
import { changeInputs, closeSheet, lookForWindows, useDesktop } from './desktop-store';
import { PhoneQuestion, PhoneSheet } from './PhoneSheet';

/*
 * The Drashti computer's video inputs and other apps' windows from a phone (Session 54, the phone as a full Drashti),
 * as its Media has them: each named input put up (the slide staying over it), changed or deleted (asked first, in
 * Media's words), another named from the cameras the computer lists (never a camera of the phone's naming), and
 * Show a Window…'s list, by name, one put up. Whether Drashti may use the cameras, or see the windows (a Mac's
 * Camera and Screen Recording), is answered at the computer: this sheet says so plainly.
 */

const FIELD = 'h-12 w-full rounded-lg border border-field bg-panel-3 px-3 text-base text-fg';
const LABEL = 'block space-y-1';
const LABEL_WORDS = 'block text-base text-muted';
const FITS: LiveFit[] = ['fit', 'fill'];

const post = (path: string, body?: unknown) => () => api<{ rev?: number }>(path, { method: 'POST', body });
const inputPath = (id: string, what: string) => `/api/v1/video-inputs/${encodeURIComponent(id)}/${what}`;

/** An input's name, camera and fit, to name a new one or change one. */
function InputForm({
  editing,
  inputs,
  onDone,
}: {
  editing: VideoInput | null;
  inputs: RemoteInputs;
  onDone: () => void;
}) {
  const busy = useDesktop((s) => s.busy);
  const cameras = inputs.cameras ?? [];
  const choices = editing && !cameras.includes(editing.device) ? [editing.device, ...cameras] : cameras;
  const [name, setName] = useState(editing?.name ?? nextInputName(inputs.inputs));
  const [device, setDevice] = useState(editing?.device ?? choices[0] ?? '');
  const [fit, setFit] = useState<LiveFit>(editing?.fit ?? 'fit');
  const problem = nameProblem(name, inputs.inputs, editing?.id ?? null);
  const testId = editing ? 'remote-input-change-form' : 'remote-input-add-form';
  return (
    <form
      className="space-y-2 rounded-lg border border-line bg-panel p-3"
      data-testid={testId}
      onSubmit={(e) => {
        e.preventDefault();
        if (problem || device === '') return;
        void (
          editing
            ? changeInputs(inputPath(editing.id, 'change'), { name, device, fit })
            : changeInputs('/api/v1/video-inputs', { name, device, fit })
        ).then((ok) => {
          if (ok) onDone();
        });
      }}
    >
      <label className={LABEL}>
        <span className={LABEL_WORDS}>Name</span>
        <input
          className={FIELD}
          value={name}
          maxLength={60}
          enterKeyHint="done"
          aria-invalid={problem ? true : undefined}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </label>
      {problem && <p className="text-base text-warning-fg">{problem}</p>}
      <label className={LABEL}>
        <span className={LABEL_WORDS}>Camera or capture input on the Drashti computer</span>
        <select
          className={FIELD}
          value={device}
          data-testid="remote-input-camera"
          onChange={(e) => {
            setDevice(e.target.value);
          }}
        >
          {choices.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className={LABEL}>
        <span className={LABEL_WORDS}>On the screens</span>
        <select
          className={FIELD}
          value={fit}
          onChange={(e) => {
            setFit(e.target.value === 'fill' ? 'fill' : 'fit');
          }}
        >
          {FITS.map((f) => (
            <option key={f} value={f}>
              {FIT_WORDS[f].choice}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <Button size="lg" className="min-h-12" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="lg"
          variant="primary"
          className="min-h-12"
          disabled={busy || problem !== null || device === ''}
        >
          {editing ? 'Keep' : 'Add'}
        </Button>
      </div>
    </form>
  );
}

function InputRow({
  input,
  live,
  inputs,
  onDelete,
}: {
  input: VideoInput;
  live: boolean;
  inputs: RemoteInputs;
  onDelete: () => void;
}) {
  const [changing, setChanging] = useState(false);
  return (
    <li
      className={cx('space-y-2 rounded-lg border bg-panel-2 p-3', live ? 'border-live' : 'border-line')}
      data-testid="remote-input"
      data-name={input.name}
      data-live={live ? 'true' : undefined}
    >
      <div className="flex items-start gap-2">
        <Video size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <p className="text-base break-words text-fg">{input.name}</p>
          <p className="text-base break-words text-muted">
            {input.device} · {FIT_WORDS[input.fit].row}
          </p>
        </div>
        {live && <LiveBadge />}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {live ? (
          <Button
            size="lg"
            className="min-h-12"
            instant
            variant="live"
            icon={Eraser}
            data-testid="remote-input-clear"
            onClick={() => void tap(post('/api/v1/clear/background'))}
          >
            Clear
          </Button>
        ) : (
          <Button
            size="lg"
            className="min-h-12"
            instant
            variant="primary"
            data-testid="remote-input-show"
            aria-label={`Show ${input.name}`}
            onClick={() => void tap(post(inputPath(input.id, 'show')))}
          >
            Show
          </Button>
        )}
        <Button
          size="lg"
          className="min-h-12"
          icon={Pencil}
          aria-label={`Change ${input.name}`}
          aria-expanded={changing}
          data-testid="remote-input-change"
          onClick={() => {
            setChanging(!changing);
          }}
        >
          Change
        </Button>
        <Button
          size="lg"
          variant="danger"
          className="min-h-12"
          icon={Trash2}
          aria-label={`Delete ${input.name}`}
          data-testid="remote-input-delete"
          onClick={onDelete}
        >
          Delete
        </Button>
      </div>
      {changing && (
        <InputForm
          editing={input}
          inputs={inputs}
          onDone={() => {
            setChanging(false);
          }}
        />
      )}
    </li>
  );
}

function Inputs() {
  const inputs = useDesktop((s) => s.inputs);
  const upId = useEngine((s) =>
    s.state?.layers.background?.kind === 'input' ? s.state.layers.background.inputId : null,
  );
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<VideoInput | null>(null);
  return (
    <section className="space-y-2" aria-labelledby="remote-inputs-title" data-testid="remote-inputs">
      <h3 id="remote-inputs-title" className="text-base font-bold tracking-wider text-muted uppercase">
        Video inputs
      </h3>
      {!inputs ? (
        <p role="status" className="text-base text-muted">
          Reading the computer’s video inputs…
        </p>
      ) : (
        <>
          {inputs.access !== 'granted' && <Notice tone="warning">{CAMERA_AT_COMPUTER}</Notice>}
          {inputs.inputs.length === 0 ? (
            <p className="text-base text-muted">No video inputs are named on the Drashti computer yet.</p>
          ) : (
            <ul className="space-y-2">
              {inputs.inputs.map((input) => (
                <InputRow
                  key={input.id}
                  input={input}
                  live={input.id === upId}
                  inputs={inputs}
                  onDelete={() => {
                    setDeleting(input);
                  }}
                />
              ))}
            </ul>
          )}
          {inputs.access === 'granted' &&
            (inputs.cameras === null ? (
              <p className="text-base text-muted">{CAMERAS_NOT_LISTED}</p>
            ) : inputs.cameras.length === 0 ? (
              <p className="text-base text-muted">
                The Drashti computer lists no cameras or capture inputs now.
              </p>
            ) : adding ? (
              <InputForm
                editing={null}
                inputs={inputs}
                onDone={() => {
                  setAdding(false);
                }}
              />
            ) : (
              <Button
                size="lg"
                className="min-h-12 w-full"
                icon={Plus}
                data-testid="remote-input-add"
                onClick={() => {
                  setAdding(true);
                }}
              >
                Add a video input
              </Button>
            ))}
        </>
      )}
      {deleting && (
        <PhoneQuestion
          title={`Delete the video input “${deleting.name}”?`}
          safe="Cancel"
          act="Delete"
          testId="remote-input-delete-ask"
          onSafe={() => {
            setDeleting(null);
          }}
          onAct={() => {
            const id = deleting.id;
            setDeleting(null);
            void changeInputs(inputPath(id, 'remove'));
          }}
        >
          <p>
            It goes from Media on the Drashti computer. The camera or capture input itself is not changed: it
            can be named again.
          </p>
        </PhoneQuestion>
      )}
    </section>
  );
}

function Windows() {
  const windows = useDesktop((s) => s.windows);
  const looking = useDesktop((s) => s.lookingForWindows);
  const up = useEngine((s) =>
    s.state?.layers.background?.kind === 'window' ? s.state.layers.background : null,
  );
  return (
    <section className="space-y-2" aria-labelledby="remote-windows-title" data-testid="remote-windows">
      <h3 id="remote-windows-title" className="text-base font-bold tracking-wider text-muted uppercase">
        Show a window
      </h3>
      <p className="text-base text-muted">
        Another app’s window on the Drashti computer (a Zoom meeting, say) as the hall’s background, live.
      </p>
      {up && (
        <div
          className="flex items-center gap-2 rounded-lg border border-live bg-panel-2 py-1 pr-1 pl-3"
          data-testid="remote-window-up"
        >
          <AppWindow size={18} aria-hidden="true" className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1 text-base break-words text-fg">{up.name}</span>
          <LiveBadge />
          <Button
            size="lg"
            className="min-h-12"
            instant
            icon={Eraser}
            data-testid="remote-window-clear"
            onClick={() => void tap(post('/api/v1/clear/background'))}
          >
            Clear
          </Button>
        </div>
      )}
      <Button
        size="lg"
        className="min-h-12 w-full"
        icon={Search}
        disabled={looking}
        data-testid="remote-windows-look"
        onClick={() => void lookForWindows()}
      >
        {looking ? 'Looking for windows…' : windows ? 'Look again' : 'Look for windows'}
      </Button>
      {windows &&
        (windows.ok ? (
          windows.windows.length === 0 ? (
            <p className="text-base text-muted">
              No other app has a window open on the Drashti computer now.
            </p>
          ) : (
            <ul className="space-y-2">
              {windows.windows.map((w) => (
                <li
                  key={w.id}
                  className="flex items-center gap-2 rounded-lg border border-line bg-panel-2 py-1 pr-1 pl-3"
                  data-testid="remote-window"
                  data-name={w.name}
                >
                  <span className="min-w-0 flex-1 text-base break-words text-fg" translate="no">
                    {w.name}
                  </span>
                  {up?.sourceId === w.id && <Badge tone="live">On the screens</Badge>}
                  <Button
                    size="lg"
                    className="min-h-12"
                    instant
                    variant="primary"
                    aria-label={`Show ${w.name}`}
                    data-testid="remote-window-show"
                    onClick={() => void tap(post('/api/v1/windows/show', { id: w.id }))}
                  >
                    Show
                  </Button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <Notice tone="warning" data-testid="remote-windows-refused">
            {windows.message}
          </Notice>
        ))}
    </section>
  );
}

export function InputsSheet() {
  const problem = useDesktop((s) => s.problem);
  return (
    <PhoneSheet
      title="Video inputs and windows"
      subtitle="The Drashti computer’s cameras and capture inputs, and other apps’ windows."
      onClose={closeSheet}
      testId="remote-inputs-sheet"
    >
      {problem && (
        <Notice
          tone="warning"
          data-testid="remote-inputs-problem"
          onDismiss={() => useDesktop.setState({ problem: null })}
        >
          {problem}
        </Notice>
      )}
      <Inputs />
      <Windows />
    </PhoneSheet>
  );
}
