import { useEffect, useId } from 'react';
import { type OperatorAction, shortcutText } from '../../../shared/keymap';
import {
  SCREEN_SWITCHES,
  type ScreenSwitch,
  SWITCH_NAMES,
  SWITCH_OFF_WORDS,
  switchOffQuestion,
  TURN_OFF,
} from '../../../shared/screen-switches';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { MonitorOff } from '../ui/icons';
import { Tooltip } from '../ui/Tooltip';
import { useNotice } from './actions';
import {
  answerFromOutput,
  cancelAsk,
  confirmAsk,
  toggleSwitch,
  turnOnIfOff,
  useScreenSwitches,
} from './screen-switches-store';

/*
 * Audience and Stage (Session 50) in the operator window: the top bar's two switches beside Screens (Pro Mode),
 * each saying On or Off in words; the question before one goes off while its screens show something; and, while
 * one is off, the status bar's "Audience off" with Turn on, in both modes (Simple Mode's only way to change
 * them, and only on). When an output covers these controls, it asks the same, large (Session 51, S2-2).
 */

const KEY: Record<ScreenSwitch, OperatorAction> = { audience: 'toggleAudience', stage: 'toggleStage' };

/** The screens each covers, as the tooltips say them. */
const WHOSE: Record<ScreenSwitch, string> = {
  audience: 'the hall’s screens on this computer (key and fill too)',
  stage: 'the stage screens on this computer',
};

const say = (problem: string | null) => {
  if (problem) useNotice.setState({ text: problem });
};

function SwitchButton({ which, platform }: { which: ScreenSwitch; platform: string }) {
  const on = useScreenSwitches((s) => s.switches[which]);
  const name = SWITCH_NAMES[which];
  return (
    <Tooltip
      content={
        on
          ? `Turn off ${WHOSE[which]}: their displays go back to the computer. The show carries on.`
          : `Turn on ${WHOSE[which]} again, where they were.`
      }
      kbd={shortcutText(KEY[which], platform)}
      side="bottom"
    >
      {/* Its name is read out with its state (a switch, on or off); On and Off are there for the eye, in words.
          Not a show control (no `instant`): the header is decoration, and no show control sits on it. */}
      <Button
        size="sm"
        variant={on ? 'secondary' : 'warning'}
        role="switch"
        aria-checked={on}
        data-testid={`switch-${which}`}
        data-on={on ? 'true' : 'false'}
        onClick={() => void toggleSwitch(which).then(say)}
      >
        {name}
        <span aria-hidden="true" className="font-bold">
          {on ? 'On' : 'Off'}
        </span>
      </Button>
    </Tooltip>
  );
}

/** The top bar's switches, beside Screens (Pro Mode). */
export function ScreenSwitchButtons({ platform }: { platform: string }) {
  return (
    <span
      role="group"
      aria-label="This computer’s screens"
      data-testid="screen-switches"
      className="flex items-center gap-1"
    >
      {SCREEN_SWITCHES.map((which) => (
        <SwitchButton key={which} which={which} platform={platform} />
      ))}
    </span>
  );
}

/**
 * The question itself, as a confirmation asks (an alertdialog, Cancel then the danger button), with the keyboard
 * on Cancel, so Enter or Esc never turns the screens off unseen. While an output covers these controls and asks
 * the same in its middle (Session 51, S2-2), Turn off has it instead, so Enter does what that output says.
 */
function Asking({ which, covered, platform }: { which: ScreenSwitch; covered: boolean; platform: string }) {
  const textId = useId();
  const name = SWITCH_NAMES[which];
  return (
    <Dialog
      title={switchOffQuestion(which)}
      role="alertdialog"
      size="sm"
      onClose={cancelAsk}
      closeButton={false}
      describedBy={textId}
      testId="screen-switch-ask"
      footer={
        <>
          <Button data-autofocus={covered ? undefined : true} onClick={cancelAsk}>
            Cancel
          </Button>
          <Button
            variant="danger"
            data-autofocus={covered ? true : undefined}
            data-testid="screen-switch-turn-off"
            onClick={() => void confirmAsk().then(say)}
          >
            {TURN_OFF}
          </Button>
        </>
      }
    >
      <div id={textId} className="space-y-2 text-sm text-muted">
        <p>{SWITCH_OFF_WORDS[which]}</p>
        <p>
          The show carries on. {name} On ({shortcutText(KEY[which], platform)}) puts them back where they
          were.
        </p>
        {covered && (
          <p data-testid="screen-switch-covered">
            An output covers these controls now and asks the same in its middle: Enter turns {name} off, Esc
            cancels.
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** "Turn Audience off?": asked before one goes off while its screens show something (Pro Mode). */
export function ScreenSwitchAsk({ platform }: { platform: string }) {
  const asking = useScreenSwitches((s) => s.asking);
  const covered = useScreenSwitches((s) => s.covered);
  // Answered on the output over these controls, as it had the keyboard: acted on here, as this window's buttons.
  useEffect(
    () =>
      window.drashti.screenSwitches.onAnswered((yes) => {
        void answerFromOutput(yes).then(say);
      }),
    [],
  );
  if (!asking) return null;
  // Made again when an output over the controls starts or stops asking, so the keyboard starts where it should.
  return <Asking key={covered ? 'covered' : 'here'} which={asking} covered={covered} platform={platform} />;
}

/** The status bar's word while one is off, with Turn on: one click (both modes). */
export function SwitchedOffStatus() {
  const switches = useScreenSwitches((s) => s.switches);
  return (
    <>
      {SCREEN_SWITCHES.filter((which) => !switches[which]).map((which) => (
        <div
          key={which}
          role="status"
          data-testid={`switch-off-${which}`}
          className="flex shrink-0 items-center gap-1.5 rounded-sm bg-warning-bg px-1.5 py-0.5 text-warning-fg"
        >
          <MonitorOff size={13} aria-hidden="true" className="shrink-0" />
          <span className="font-medium">{SWITCH_NAMES[which]} off</span>
          <Button
            variant="secondary"
            size="sm"
            className="h-5"
            aria-label={`Turn on ${SWITCH_NAMES[which]}`}
            onClick={() => void turnOnIfOff(which).then(say)}
          >
            Turn on
          </Button>
        </div>
      ))}
    </>
  );
}
