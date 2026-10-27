import { useEffect } from 'react';
import type { PendingScreens } from '../../../../shared/keep-screens';
import {
  SWITCH_NAMES,
  SWITCH_OFF_WORDS,
  switchOffQuestion,
  TURN_OFF,
} from '../../../../shared/screen-switches';
import { useNow } from '../../render/useNow';
import { Button } from '../../ui/Button';
import { Monitor, Video } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { plural } from '../../ui/text';
import { answerKeep, answerOff, openSheet, startDesktop, useDesktop } from './desktop-store';
import { PhoneQuestion } from './PhoneSheet';
import { InputsSheet } from './InputsSheet';
import { ScreensSheet, SwitchButtons } from './ScreensSheet';

/*
 * The phone as a full Drashti (Session 54, the owner's item 3): in More, first, what the operator window's top bar
 * has for the computer's own screens (Audience and Stage, and Screens, opened here as a sheet); and over the
 * remote, the sheet open now and the window's questions asked on the phone: Keep these screens?, with its
 * countdown, once a change of this phone's waits for it (or the Screens sheet is open), and "Turn Audience off?"
 * before a switch goes off while its screens show something.
 */

export function DesktopTools() {
  const problem = useDesktop((s) => (s.sheet === null ? s.problem : null));
  return (
    <section className="space-y-2" aria-labelledby="remote-desktop-title" data-testid="remote-desktop">
      <h2 id="remote-desktop-title" className="text-base font-bold tracking-wider text-muted uppercase">
        Screens
      </h2>
      <p className="text-base text-muted">
        The Drashti computer’s own screens, set up from here as in Drashti.
      </p>
      <SwitchButtons />
      {problem && (
        <Notice
          tone="warning"
          data-testid="remote-desktop-problem"
          onDismiss={() => useDesktop.setState({ problem: null })}
        >
          {problem}
        </Notice>
      )}
      <Button
        size="lg"
        className="min-h-12 w-full"
        icon={Monitor}
        data-testid="remote-open-screens"
        onClick={() => {
          openSheet('screens');
        }}
      >
        Set up the screens…
      </Button>
      <Button
        size="lg"
        className="min-h-12 w-full"
        icon={Video}
        data-testid="remote-open-inputs"
        onClick={() => {
          openSheet('inputs');
        }}
      >
        Video inputs and windows…
      </Button>
    </section>
  );
}

/** Whole seconds left until `deadline` (the computer's clock), never below none. */
const secondsLeft = (deadline: number, now: number) => Math.max(0, Math.ceil((deadline - now) / 1000));

/** Keep these screens?, while a change waits that this phone made (or its Screens sheet is open). */
function KeepQuestion() {
  const pending = useDesktop((s) => s.screens?.pending ?? null);
  const shown = useDesktop((s) => s.mine || s.sheet === 'screens');
  // Made again for each new deadline (a second change starts the countdown again).
  return pending && shown ? <Keep key={pending.deadline} pending={pending} /> : null;
}

/** The question as the window asks it: the seconds left in words, read from the engine's clock. */
function Keep({ pending }: { pending: PendingScreens }) {
  const busy = useDesktop((s) => s.busy);
  const now = useNow(250);
  const seconds = secondsLeft(pending.deadline, now);
  return (
    <PhoneQuestion
      title="Keep these screens?"
      safe="Go back"
      act="Keep"
      actVariant="primary"
      focusAct
      busy={busy}
      testId="remote-keep-screens"
      onSafe={() => void answerKeep(false)}
      onAct={() => void answerKeep(true)}
    >
      <p>The screens have changed. Keep them as they are now, or go back to how they were.</p>
      <p
        role="timer"
        className="font-medium text-fg"
        data-testid="remote-keep-countdown"
        data-seconds={seconds}
      >
        {seconds > 0 ? `Going back by itself in ${plural(seconds, 'second')}.` : 'Going back now…'}
      </p>
      {pending.coversControls && (
        <p>An output covers the Drashti controls on the computer now, and asks the same there.</p>
      )}
    </PhoneQuestion>
  );
}

/** "Turn Audience off?", in the window's words, before a switch goes off while its screens show something. */
function OffQuestion() {
  const which = useDesktop((s) => s.askingOff);
  if (!which) return null;
  return (
    <PhoneQuestion
      title={switchOffQuestion(which)}
      safe="Cancel"
      act={TURN_OFF}
      testId="remote-switch-ask"
      onSafe={() => void answerOff(false)}
      onAct={() => void answerOff(true)}
    >
      <p>{SWITCH_OFF_WORDS[which]}</p>
      <p>The show carries on. {SWITCH_NAMES[which]} On puts them back where they were.</p>
    </PhoneQuestion>
  );
}

/** Over the remote: the sheet open now, and the window's questions asked on the phone. Mounted once, by the remote. */
export function DesktopLayer() {
  const sheet = useDesktop((s) => s.sheet);
  useEffect(() => {
    startDesktop();
  }, []);
  return (
    <>
      {sheet === 'screens' && <ScreensSheet />}
      {sheet === 'inputs' && <InputsSheet />}
      <KeepQuestion />
      <OffQuestion />
    </>
  );
}
