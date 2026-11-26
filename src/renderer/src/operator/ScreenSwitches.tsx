import { useEffect, useId } from 'react';
import { type OperatorAction, shortcutText } from '../../../shared/keymap';
import {
  SCREEN_SWITCHES,
  type ScreenSwitch,
  stageOffHint,
  stageTabletsShowing,
  type ScreenSwitches,
  SWITCH_NAMES,
  SWITCH_OFF_WORDS,
  switchOffQuestion,
  TURN_OFF,
} from '../../../shared/screen-switches';
import { Button, type ButtonVariant } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { MonitorOff, TabletSmartphone } from '../ui/icons';
import { Tooltip } from '../ui/Tooltip';
import { cx } from '../ui/cx';
import { useNetwork } from '../network/network-store';
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
 * each saying On or Off in words (since alpha.24 after a small dot, and quiet while on); the question before one goes
 * off while its screens show something; and, while one is off, the status bar's "Audience off" with Turn on, in both
 * modes (Simple Mode's only way to change them, and only on). When an output covers these controls, it asks the same, large (Session 51, S2-2).
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

/**
 * A switch as the top bar shows it (alpha.22, a22-review-stage S6): pressed only once the main process has said
 * which are on, so it never says On and then flips to Off as a library with Stage kept off starts. The keys and the
 * View menu are not held back: they ask first in those moments (Session 51, S2-4).
 */
export function switchButton(
  which: ScreenSwitch,
  switches: ScreenSwitches,
  known: boolean,
): { on: boolean; disabled: boolean } {
  return { on: switches[which], disabled: !known };
}

/**
 * How a switch looks in the top bar's group (alpha.24, uitop): on, a quiet ghost button, a small dot in the success
 * colour before its name and On; off, the warning's box and its dot, with Off. The words say it, never the colour alone.
 */
export function switchLook(on: boolean): { variant: ButtonVariant; dot: string; word: 'On' | 'Off' } {
  return on
    ? { variant: 'ghost', dot: 'bg-success', word: 'On' }
    : { variant: 'warning', dot: 'bg-warning', word: 'Off' };
}

/**
 * Audience and Stage change the hall's screens, so no interface motion ever moves them (uimotion's review): no lift
 * as the pointer rests on one, no press, no colour fade; each state is there at once, as a show control's is. They are
 * not marked show controls (data-show-control) all the same: the header's decoration gradient never lies under one
 * (appearance-drawing.spec.ts, in every appearance that has one). Important, so these hold over the motion rules.
 */
export const SWITCH_STILL = 'translate-none! transform-none! transition-none!';

function SwitchButton({ which, platform }: { which: ScreenSwitch; platform: string }) {
  const switches = useScreenSwitches((s) => s.switches);
  const known = useScreenSwitches((s) => s.known);
  const { on, disabled } = switchButton(which, switches, known);
  const look = switchLook(on);
  const name = SWITCH_NAMES[which];
  return (
    <Tooltip
      content={
        on
          ? which === 'stage'
            ? `Turn off ${WHOSE[which]}: they show the audience picture instead. The show carries on.`
            : `Turn off ${WHOSE[which]}: their displays go back to the computer. The show carries on.`
          : `Turn on ${WHOSE[which]} again, where they were.`
      }
      kbd={shortcutText(KEY[which], platform)}
      side="bottom"
    >
      {/* Its name is read out with its state (a switch, on or off); On and Off are there for the eye, in words.
          Not a show control (no `instant`): the header is decoration, and no show control sits on it; still all the
          same (SWITCH_STILL). */}
      <Button
        size="sm"
        variant={look.variant}
        role="switch"
        aria-checked={on}
        disabled={disabled}
        data-testid={`switch-${which}`}
        data-on={on ? 'true' : 'false'}
        className={SWITCH_STILL}
        onClick={() => void toggleSwitch(which).then(say)}
      >
        <span aria-hidden="true" className={cx('h-1.5 w-1.5 shrink-0 rounded-full', look.dot)} />
        {name}
        <span aria-hidden="true" className="font-bold">
          {look.word}
        </span>
      </Button>
    </Tooltip>
  );
}

/** The top bar's switches, beside Screens in its group (Pro Mode). */
export function ScreenSwitchButtons({ platform }: { platform: string }) {
  return (
    <span
      role="group"
      aria-label="This computer’s screens"
      data-testid="screen-switches"
      className="flex items-center gap-0.5"
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

/**
 * The status bar's word while one is off, with Turn on: one click (both modes). With Stage off and a stage tablet
 * connected (alpha.23, the owner's QA23-STAGE8-2, "Keep Off, say so (Rec.)"), Stage's says that the tablet shows the
 * audience picture: a tablet in place of the screen icon, the sentence as its tooltip and in its words for screen
 * readers, so the status bar is not one pixel wider (a22-review-stage8, third look: in CI's 1024 × 645 with Audience
 * off too, the row has no room for more words).
 */
export function SwitchedOffStatus() {
  const switches = useScreenSwitches((s) => s.switches);
  const tablets = useNetwork((s) => (s.status ? stageTabletsShowing(s.status) : 0));
  const hint = stageOffHint(tablets);
  return (
    <>
      {SCREEN_SWITCHES.filter((which) => !switches[which]).map((which) => {
        // Said only of Stage, only with a tablet connected.
        const said = which === 'stage' ? hint : null;
        const item = (
          <div
            key={which}
            role="status"
            data-testid={`switch-off-${which}`}
            className="flex shrink-0 items-center gap-1.5 rounded-sm bg-warning-bg px-1.5 py-0.5 text-warning-fg"
          >
            {said !== null ? (
              <TabletSmartphone
                size={13}
                aria-hidden="true"
                className="shrink-0"
                data-testid="switch-off-stage-tablet"
              />
            ) : (
              <MonitorOff size={13} aria-hidden="true" className="shrink-0" />
            )}
            <span className="font-medium">{SWITCH_NAMES[which]} off</span>
            {said !== null && (
              <span className="sr-only">
                {' · '}
                <span data-testid="switch-off-stage-hint">{said}</span>
              </span>
            )}
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
        );
        return said !== null ? (
          // The words are in the item already, for screen readers: the tooltip only shows them.
          <Tooltip key={which} content={`Stage off: ${said}.`} describes={false}>
            {item}
          </Tooltip>
        ) : (
          item
        );
      })}
    </>
  );
}
