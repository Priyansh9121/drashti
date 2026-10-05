import { useEffect, useId } from 'react';
import { describeDisplay } from '../../../shared/display-match';
import { shortcutText } from '../../../shared/keymap';
import { LANG_NAMES } from '../../../shared/themes';
import { LanguagePicker } from '../screens/LanguagePicker';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { ConfirmDialog, Dialog } from '../ui/Dialog';
import { Field, Select } from '../ui/Field';
import { Monitor, ScanEye, Volume2 } from '../ui/icons';
import { Kbd } from '../ui/Kbd';
import { Notice } from '../ui/Notice';
import { Loading } from '../ui/States';
import { plural } from '../ui/text';
import type { DeviceChoice } from '../../../shared/stream';
import { useStream, watchProgram } from '../stream/stream-store';
import type { OutputChoice, PinChoice } from './setup-store';
import { PinInput } from '../roles/RolesDialogs';
import {
  chooseOutput,
  closeSetup,
  finishSetup,
  goTo,
  pinsReady,
  planOf,
  skipStep,
  STEPS,
  useSetup,
} from './setup-store';

const useStreamStatus = () => useStream((s) => s.status);

const USE_NAMES = {
  audience: 'The audience picture',
  stage: 'The stage view (performers)',
  none: 'Not used',
} as const;

/** Which step it is, in words and as a row of numbers. */
function StepList({ step }: { step: number }) {
  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Steps">
      {STEPS.map((name, i) => (
        <li
          key={name}
          aria-current={i === step ? 'step' : undefined}
          className={cx('flex items-center gap-1.5', i === step ? 'font-bold text-fg' : 'text-muted')}
        >
          <span
            aria-hidden="true"
            className={cx(
              'inline-flex h-5 w-5 items-center justify-center rounded-full border text-2xs',
              i === step ? 'border-accent bg-accent text-white' : 'border-line-strong',
            )}
          >
            {i + 1}
          </span>
          {name}
        </li>
      ))}
    </ol>
  );
}

function ScreensStep() {
  const displays = useSetup((s) => s.displays);
  const outputs = useSetup((s) => s.outputs);
  const operatorDisplayId = useSetup((s) => s.operatorDisplayId);
  const skipped = useSetup((s) => s.outputsSkipped);
  return (
    <div className="space-y-3">
      <p className="text-sm">
        For each display the computer has, choose what it shows: the audience picture, the stage view for the
        performers, or nothing. Audience and stage outputs can show a kirtan in their own languages.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          icon={ScanEye}
          data-testid="setup-identify"
          onClick={() => void window.drashti.setup.identifyDisplays()}
        >
          Show each display’s number on it
        </Button>
        <span className="text-xs text-muted">
          Volunteers can then see which output feeds which screens. The display with the controls is left as
          it is.
        </span>
      </div>
      {skipped && (
        <Notice tone="info">
          Skipped: the screens stay as they are. Choose below to set them after all.
        </Notice>
      )}
      <ol className="space-y-2" aria-label="Displays">
        {displays.map((d, i) => {
          const choice: OutputChoice = outputs[d.id] ?? { use: 'none', languages: null };
          const controls = d.id === operatorDisplayId;
          return (
            <li
              key={d.id}
              className="space-y-2 rounded-lg border border-line bg-panel-2 px-3 py-2.5"
              data-testid="setup-display"
              data-display-id={d.id}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-accent text-sm font-bold text-white"
                >
                  {i + 1}
                </span>
                <Monitor size={16} aria-hidden="true" className="text-muted" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  Display {i + 1}: {describeDisplay(d)}
                </span>
                {controls && <Badge tone="warning">The Drashti controls are here</Badge>}
                <Select
                  aria-label={`What display ${i + 1} shows`}
                  data-testid="setup-use"
                  className="w-60"
                  value={choice.use}
                  onChange={(e) => {
                    chooseOutput(d.id, { use: e.target.value as OutputChoice['use'] });
                  }}
                >
                  {(['audience', 'stage', 'none'] as const).map((u) => (
                    <option key={u} value={u}>
                      {USE_NAMES[u]}
                    </option>
                  ))}
                </Select>
              </div>
              {controls && choice.use !== 'none' && (
                <p className="text-xs text-warning-fg">
                  An output here covers the Drashti controls. Finish asks before it does.
                </p>
              )}
              {choice.use !== 'none' && (
                <LanguagePicker
                  label="A kirtan’s languages on it"
                  value={choice.languages}
                  onChange={(languages) => {
                    chooseOutput(d.id, { languages });
                  }}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function SoundStep() {
  const devices = useSetup((s) => s.devices);
  const sound = useSetup((s) => s.sound);
  const name = useId();
  const chosenId = sound === 'skip' ? null : (sound?.id ?? '');
  const options = [{ id: '', label: 'The computer’s default output' }, ...devices];
  return (
    <div className="space-y-3">
      <p className="text-sm">
        Where the sound goes: usually the mixer. Play a test tone to hear which output is which.
      </p>
      {sound === 'skip' && <Notice tone="info">Skipped: the sound output stays as it is.</Notice>}
      <fieldset className="space-y-1.5">
        <legend className="sr-only">Sound output</legend>
        {options.map((d) => (
          <label
            key={d.id || 'default'}
            className="flex items-center gap-2 text-sm"
            data-testid="setup-sound"
          >
            <input
              type="radio"
              name={name}
              className="h-4 w-4 accent-accent-strong"
              checked={chosenId === d.id}
              onChange={() => {
                useSetup.setState({ sound: d.id === '' ? null : { id: d.id, label: d.label } });
              }}
            />
            {d.label}
          </label>
        ))}
      </fieldset>
      <Button
        icon={Volume2}
        data-testid="setup-tone"
        disabled={sound === 'skip'}
        onClick={() => void window.drashti.setup.testTone(sound === 'skip' ? null : sound)}
      >
        Play a test tone
      </Button>
    </div>
  );
}

/** The stream's camera and sound input: optional, and the key can wait. */
function StreamStep() {
  const stream = useSetup((s) => s.stream);
  const status = useStreamStatus();
  useEffect(() => watchProgram(), []);
  const chosen = stream === 'skip' ? { camera: null, sound: null } : stream;
  const set = (patch: Partial<{ camera: DeviceChoice | null; sound: DeviceChoice | null }>) => {
    useSetup.setState({ stream: { ...chosen, ...patch } });
  };
  const pick = (
    label: string,
    testId: string,
    devices: DeviceChoice[],
    value: DeviceChoice | null,
    none: string,
    key: 'camera' | 'sound',
  ) => (
    <Field label={label} className="min-w-0 flex-1">
      <Select
        data-testid={testId}
        value={value?.id ?? ''}
        onChange={(e) => {
          set({ [key]: devices.find((d) => d.id === e.target.value) ?? null });
        }}
      >
        <option value="">{none}</option>
        {devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
          </option>
        ))}
      </Select>
    </Field>
  );
  return (
    <div className="space-y-3">
      <p className="text-sm">
        Only for the computer that streams the sabha to YouTube. Choose the camera (or capture card) and the
        sound input (the mixer’s line in). The stream key can be added later, in Stream settings.
      </p>
      {stream === 'skip' && (
        <Notice tone="info">Skipped: the stream’s camera and sound stay as they are.</Notice>
      )}
      {!status?.programOn ? (
        <Loading label="Looking for cameras and sound inputs…" />
      ) : (
        <div className="flex flex-wrap gap-3">
          {pick('Camera', 'setup-stream-camera', status.inputs.cameras, chosen.camera, 'No camera', 'camera')}
          {pick(
            'Sound input',
            'setup-stream-sound',
            status.inputs.microphones,
            chosen.sound,
            'No sound input',
            'sound',
          )}
        </div>
      )}
      {status?.inputs.message && <Notice tone="warning">{status.inputs.message}</Notice>}
    </div>
  );
}

function ThemeStep() {
  const themes = useSetup((s) => s.themes);
  const themeId = useSetup((s) => s.themeId);
  const defaultThemeId = useSetup((s) => s.defaultThemeId);
  const name = useId();
  return (
    <div className="space-y-3">
      <p className="text-sm">
        The look presentations made in Drashti start with. Themes can be changed later in Themes.
      </p>
      {themeId === null && <Notice tone="info">Skipped: the default theme stays as it is.</Notice>}
      <fieldset className="space-y-1.5">
        <legend className="sr-only">Default theme</legend>
        {themes.map((t) => (
          <label key={t.id} className="flex items-center gap-2 text-sm" data-testid="setup-theme">
            <input
              type="radio"
              name={name}
              className="h-4 w-4 accent-accent-strong"
              checked={themeId === t.id}
              onChange={() => {
                useSetup.setState({ themeId: t.id });
              }}
            />
            {t.name}
            {t.id === defaultThemeId && <Badge>Default now</Badge>}
          </label>
        ))}
      </fieldset>
    </div>
  );
}

function PinsStep() {
  const pins = useSetup((s) => s.pins);
  const rolesOn = useSetup((s) => s.rolesOn);
  const name = useId();
  if (rolesOn)
    return (
      <Notice tone="info">
        Roles are on: two PINs are set. Change them, or turn roles off, in File, Roles and PINs.
      </Notice>
    );
  const typed = pins === 'skip' ? null : pins;
  const set = (patch: Partial<Exclude<PinChoice, 'skip'>>) => {
    useSetup.setState({
      pins: { ...(typed ?? { admin: '', adminAgain: '', operator: '', operatorAgain: '' }), ...patch },
    });
  };
  const problem = typed && typed.adminAgain !== '' && typed.operatorAgain !== '' ? pinsReady(typed) : null;
  return (
    <div className="space-y-3 text-sm">
      <p>
        PINs keep setting up apart from running the show. With two PINs, Drashti starts in Simple Mode; the
        operator PIN leaves it for Pro Mode, and the admin PIN also unlocks setting up (screens, the library,
        schedules, backups). Without them, anyone in Pro Mode can change anything.
      </p>
      <fieldset className="space-y-1.5">
        <legend className="sr-only">PINs</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={name}
            className="h-4 w-4 accent-accent-strong"
            checked={typed === null}
            onChange={() => {
              useSetup.setState({ pins: 'skip' });
            }}
          />
          No PINs for now
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={name}
            data-testid="setup-pins-on"
            className="h-4 w-4 accent-accent-strong"
            checked={typed !== null}
            onChange={() => {
              set({});
            }}
          />
          Set an admin PIN and an operator PIN
        </label>
      </fieldset>
      {typed && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-4">
            <Field label="Admin PIN (4 to 12 digits)">
              <PinInput
                data-testid="setup-admin-pin"
                value={typed.admin}
                onChange={(e) => set({ admin: e.target.value })}
              />
            </Field>
            <Field label="Again">
              <PinInput value={typed.adminAgain} onChange={(e) => set({ adminAgain: e.target.value })} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-4">
            <Field label="Operator PIN">
              <PinInput
                data-testid="setup-operator-pin"
                value={typed.operator}
                onChange={(e) => set({ operator: e.target.value })}
              />
            </Field>
            <Field label="Again">
              <PinInput
                value={typed.operatorAgain}
                onChange={(e) => set({ operatorAgain: e.target.value })}
              />
            </Field>
          </div>
          {typeof problem === 'string' && <p className="text-danger-fg">{problem}</p>}
        </div>
      )}
    </div>
  );
}

function FinishStep() {
  const state = useSetup();
  const plan = planOf(state);
  const finished = state.finished;
  if (finished)
    return (
      <Notice tone="success" data-testid="setup-done">
        Done.{' '}
        {finished.tested > 0
          ? `A test slide is on ${plural(finished.tested, 'screen')} for a few seconds, each in its own languages.`
          : 'No screen is showing yet.'}
      </Notice>
    );
  const themeName = state.themes.find((t) => t.id === plan.themeId)?.name;
  return (
    <div className="space-y-3 text-sm">
      <p>Finish sets these, then shows a test slide on every screen. Nothing has changed yet.</p>
      <ul className="space-y-1.5" data-testid="setup-summary">
        {plan.outputs === null ? (
          <li>The screens stay as they are.</li>
        ) : (
          plan.outputs.map((o, i) => (
            <li key={o.displayId}>
              Display {i + 1}: {USE_NAMES[o.use]}
              {o.use !== 'none' &&
                `, ${o.languages ? o.languages.map((l) => LANG_NAMES[l]).join(', ') : 'every language'}`}
            </li>
          ))
        )}
        <li>
          Sound:{' '}
          {plan.sound === 'skip'
            ? 'stays as it is'
            : plan.sound === null
              ? 'the computer’s default output'
              : plan.sound.label}
        </li>
        <li>
          Stream:{' '}
          {state.stream === 'skip'
            ? 'stays as it is'
            : `camera ${state.stream.camera?.label ?? 'none'}, sound input ${state.stream.sound?.label ?? 'none'}`}
        </li>
        <li>Default theme: {themeName ?? 'stays as it is'}</li>
        <li>
          PINs:{' '}
          {state.rolesOn ? 'roles stay on' : state.pins === 'skip' ? 'none (roles stay off)' : 'two PINs set'}
        </li>
      </ul>
    </div>
  );
}

/**
 * The setup wizard: it opens on the first start, and from View > Set Up
 * Screens… (never in Simple Mode). Every step can be skipped, and nothing
 * changes until Finish.
 */
export function SetupWizard({ platform }: { platform: string }) {
  const open = useSetup((s) => s.open);
  const step = useSetup((s) => s.step);
  const busy = useSetup((s) => s.busy);
  const problem = useSetup((s) => s.problem);
  const askCover = useSetup((s) => s.askCover);
  const finished = useSetup((s) => s.finished);
  if (!open) return null;
  const name = STEPS[step] ?? 'Welcome';
  const last = step === STEPS.length - 1;
  const skippable =
    name === 'Screens' || name === 'Sound' || name === 'Stream' || name === 'Theme' || name === 'PINs';
  return (
    <>
      <Dialog
        title="Set up Drashti"
        subtitle={<StepList step={step} />}
        size="xl"
        onClose={closeSetup}
        closeLabel="Close the setup"
        testId="setup-wizard"
        bodyClassName="space-y-4"
        footer={
          finished ? (
            <Button variant="primary" onClick={closeSetup}>
              Close
            </Button>
          ) : (
            <>
              {step > 0 && (
                <Button className="mr-auto" onClick={() => goTo(step - 1)}>
                  Back
                </Button>
              )}
              {skippable && (
                <Button data-testid="setup-skip" onClick={skipStep}>
                  Skip this step
                </Button>
              )}
              {last ? (
                <Button
                  variant="primary"
                  data-testid="setup-finish"
                  disabled={busy}
                  onClick={() => void finishSetup()}
                >
                  Finish
                </Button>
              ) : (
                <Button
                  variant="primary"
                  data-testid="setup-next"
                  disabled={busy}
                  onClick={() => goTo(step + 1)}
                >
                  {step === 0 ? 'Start' : 'Next'}
                </Button>
              )}
            </>
          )
        }
      >
        <h3 className="text-base font-bold" data-testid="setup-step">
          {name}
        </h3>
        {busy && step === 0 ? (
          <Loading label="Looking at the displays and sound outputs…" />
        ) : name === 'Welcome' ? (
          <div className="space-y-2 text-sm">
            <p>
              A few steps to set Drashti up on this computer: which output feeds which screens, the languages
              each shows, where the sound goes, the stream’s camera and sound (if this computer streams), and
              the look new presentations start with.
            </p>
            <p className="text-muted">
              Nothing changes until you press Finish at the end. Each step can be skipped to keep things as
              they are, and the setup can be run again from View, Set Up Screens. Drashti never changes a
              display’s resolution.
            </p>
          </div>
        ) : name === 'Screens' ? (
          <ScreensStep />
        ) : name === 'Sound' ? (
          <SoundStep />
        ) : name === 'Stream' ? (
          <StreamStep />
        ) : name === 'Theme' ? (
          <ThemeStep />
        ) : name === 'PINs' ? (
          <PinsStep />
        ) : (
          <FinishStep />
        )}
        {problem && <Notice tone="danger">{problem}</Notice>}
      </Dialog>
      {askCover && (
        <ConfirmDialog
          title="Cover the Drashti controls?"
          confirmLabel="Cover the controls"
          onCancel={() => {
            useSetup.setState({ askCover: false });
          }}
          onConfirm={() => void finishSetup(true)}
          testId="setup-cover-confirm"
        >
          <p>
            An output is set to show on the display the Drashti controls are on. It will cover them
            completely. Nothing has changed yet.
          </p>
          <p>
            To get the controls back, press{' '}
            <Kbd className="text-fg">{shortcutText('uncoverControls', platform)}</Kbd> (Uncover the controls).
            It works even while Drashti is covered, and turns that output off.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
