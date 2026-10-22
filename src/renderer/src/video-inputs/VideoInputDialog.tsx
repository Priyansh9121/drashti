import { useEffect, useState } from 'react';
import type { LiveFit } from '../../../shared/engine/state';
import type { VideoInput } from '../../../shared/video-inputs';
import { inputDeviceNames } from '../render/video-input-state';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { Dialog } from '../ui/Dialog';
import { Field, Select, TextInput } from '../ui/Field';
import { RotateCw, Settings, Video } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { radioKeys, radioTabIndex } from '../ui/radio';
import { EmptyState } from '../ui/States';
import { Truncate } from '../ui/Truncate';
import { InputPicture, useSmallPicture } from './InputPicture';
import { askAccess, closeInputDialog, readAccess, saveInput, useVideoInputs } from './video-inputs-store';
import {
  accessView,
  CAMERA_WHY,
  FIT_WORDS,
  nameProblem,
  nextInputName,
  NO_SOUND,
  NOT_DRASHTI_ITSELF,
  refusedWords,
  settingsLabel,
} from './words';

/*
 * Add a Video Input… (Session 50): this computer's cameras and capture inputs (a capture card, a video mixer's
 * USB output), each by name with a small live picture, to name one ("Input 1") and keep it in Media's Video
 * inputs, on this computer. Nothing goes up from here: one click on it in Media does that. On a Mac not asked
 * yet, it says why before macOS asks for the camera, and where to turn it on if it was refused; on Windows, it
 * says plainly when the camera privacy setting is off. Changing an input (its name, its input, its fit) is the
 * same dialog.
 */

interface Found {
  /** The inputs' names, in the computer's order. */
  names: string[];
  /** There are inputs, but the page cannot see their names. */
  unnamed: boolean;
}

async function lookForInputs(): Promise<Found> {
  const devices = await navigator.mediaDevices.enumerateDevices().catch((): MediaDeviceInfo[] => []);
  const names = inputDeviceNames(devices);
  return { names, unnamed: names.length === 0 && devices.some((d) => d.kind === 'videoinput') };
}

function DeviceChoice({
  device,
  connected,
  chosen,
  index,
  anyChosen,
  choose,
}: {
  device: string;
  connected: boolean;
  chosen: boolean;
  index: number;
  anyChosen: boolean;
  choose: (device: string) => void;
}) {
  const capture = useSmallPicture(connected ? device : null);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={chosen}
      tabIndex={radioTabIndex(chosen, index, anyChosen)}
      data-testid="video-input-device"
      data-name={device}
      onClick={() => {
        choose(device);
      }}
      className={cx(
        'flex min-w-0 flex-col gap-1.5 rounded-lg border p-1.5 text-left text-sm',
        chosen ? 'border-accent bg-panel-3 font-bold text-fg' : 'border-line bg-panel-2 text-muted',
      )}
    >
      <InputPicture capture={capture} className="w-full" />
      <span className="min-w-0 px-0.5">
        <Truncate text={device} />
        {!connected && <span className="block text-xs font-normal text-warning-fg">Not connected now</span>}
      </span>
    </button>
  );
}

export function VideoInputDialog({ platform }: { platform: string }) {
  const dialog = useVideoInputs((s) => s.dialog);
  if (!dialog) return null;
  return <InputDialog key={dialog.editing?.id ?? 'new'} editing={dialog.editing} platform={platform} />;
}

function InputDialog({ editing, platform }: { editing: VideoInput | null; platform: string }) {
  const inputs = useVideoInputs((s) => s.inputs);
  const access = useVideoInputs((s) => s.access);
  const view = accessView(access, platform);
  const [found, setFound] = useState<Found | null>(null);
  const [looks, setLooks] = useState(0);
  const [device, setDevice] = useState<string | null>(editing?.device ?? null);
  const [name, setName] = useState(() => editing?.name ?? nextInputName(useVideoInputs.getState().inputs));
  const [fit, setFit] = useState<LiveFit>(editing?.fit ?? 'fit');
  const [typed, setTyped] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Whether Drashti may use the cameras, asked afresh as it opens.
  useEffect(() => {
    void readAccess();
  }, []);
  // The inputs, once it may: looked for again as they are plugged in or out, and with Look again.
  useEffect(() => {
    if (view !== 'list') return;
    let on = true;
    const look = () => {
      void lookForInputs().then((next) => {
        if (on) setFound(next);
      });
    };
    look();
    navigator.mediaDevices.addEventListener('devicechange', look);
    return () => {
      on = false;
      navigator.mediaDevices.removeEventListener('devicechange', look);
    };
  }, [view, looks]);
  const lookAgain = () => {
    setLooks((n) => n + 1);
  };
  // The input it has (changing it) stays a choice while it is not connected.
  const connected = found?.names ?? [];
  const names =
    editing && found && !connected.includes(editing.device) ? [...connected, editing.device] : connected;
  const chosen = device !== null && names.includes(device) ? device : null;
  const nameError = nameProblem(name, inputs, editing?.id ?? null);
  const ready = view === 'list' && nameError === null && !saving;
  const save = async () => {
    if (!ready || chosen === null) return;
    setSaving(true);
    const message = await saveInput(editing, { name: name.trim(), device: chosen, fit });
    setSaving(false);
    if (message === null) closeInputDialog();
    else setProblem(message);
  };
  const refused = refusedWords(access ?? 'denied', platform);
  return (
    <Dialog
      title={editing ? `Change “${editing.name}”` : 'Add a Video Input'}
      subtitle="A camera or capture input on this computer (a video mixer’s program through its USB output, say), named in Media’s Video inputs. Nothing goes up until you click it there."
      onClose={closeInputDialog}
      closeLabel={editing ? `Close Change “${editing.name}”` : 'Close Add a Video Input'}
      size="lg"
      testId="video-input-dialog"
      footer={
        <>
          <Button onClick={closeInputDialog}>Cancel</Button>
          <Button
            variant="primary"
            icon={Video}
            data-testid="video-input-save"
            disabled={!ready || chosen === null}
            onClick={() => void save()}
          >
            {editing ? 'Save' : 'Add to Media'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {problem && (
          <Notice tone="danger" compact>
            {problem}
          </Notice>
        )}
        {view === 'checking' ? (
          <p className="text-sm text-muted">Asking whether Drashti may use the camera…</p>
        ) : view === 'ask' ? (
          <Notice
            tone="info"
            title="Let Drashti use the camera"
            data-testid="video-input-why"
            actions={
              <Button
                variant="primary"
                size="sm"
                icon={Video}
                data-testid="video-input-ask"
                onClick={() => void askAccess()}
              >
                Continue
              </Button>
            }
          >
            {CAMERA_WHY}
          </Notice>
        ) : view === 'refused' ? (
          <Notice
            tone="info"
            title={refused.title}
            data-testid="video-input-refused"
            actions={
              <>
                <Button
                  variant="primary"
                  size="sm"
                  icon={Settings}
                  data-testid="video-input-open-settings"
                  onClick={() => void window.drashti.videoInputs.openSettings()}
                >
                  {settingsLabel(platform)}
                </Button>
                <Button size="sm" icon={RotateCw} onClick={() => void readAccess()}>
                  Look again
                </Button>
              </>
            }
          >
            {refused.text}
          </Notice>
        ) : found === null ? (
          <p className="text-sm text-muted">Looking for this computer’s cameras and capture inputs…</p>
        ) : found.unnamed && names.length === 0 ? (
          <Notice
            tone="warning"
            compact
            actions={
              <Button size="sm" icon={RotateCw} onClick={lookAgain}>
                Look again
              </Button>
            }
          >
            Drashti cannot read the names of this computer’s cameras and capture inputs. Look again in a
            moment; if it stays so, quit Drashti and open it again.
          </Notice>
        ) : names.length === 0 ? (
          <EmptyState
            icon={Video}
            title="No camera or capture input is connected"
            compact
            data-testid="video-input-none"
            action={
              <Button size="sm" icon={RotateCw} onClick={lookAgain}>
                Look again
              </Button>
            }
          >
            Connect it (a capture card, or the video mixer’s USB output), then look again.
          </EmptyState>
        ) : (
          <div
            role="radiogroup"
            aria-label="Cameras and capture inputs"
            className="grid grid-cols-3 gap-2"
            onKeyDown={radioKeys(names, chosen ?? names[0] ?? '', setDevice)}
          >
            {names.map((n, i) => (
              <DeviceChoice
                key={n}
                device={n}
                connected={connected.includes(n)}
                chosen={n === chosen}
                index={i}
                anyChosen={chosen !== null}
                choose={setDevice}
              />
            ))}
          </div>
        )}
        {view === 'list' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" error={typed ? nameError : null}>
              <TextInput
                data-testid="video-input-name"
                value={name}
                maxLength={60}
                spellCheck={false}
                onChange={(e) => {
                  setName(e.target.value);
                  setTyped(true);
                  setProblem(null);
                }}
              />
            </Field>
            <Field label="Fit">
              <Select
                data-testid="video-input-fit"
                value={fit}
                onChange={(e) => {
                  setFit(e.target.value === 'fill' ? 'fill' : 'fit');
                }}
              >
                <option value="fit">{FIT_WORDS.fit.choice}</option>
                <option value="fill">{FIT_WORDS.fill.choice}</option>
              </Select>
            </Field>
          </div>
        )}
        <div className="space-y-1 text-xs text-muted">
          <p>{NO_SOUND}</p>
          <p>{NOT_DRASHTI_ITSELF}</p>
        </div>
      </div>
    </Dialog>
  );
}
