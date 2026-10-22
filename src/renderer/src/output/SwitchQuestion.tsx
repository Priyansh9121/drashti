import { useEffect } from 'react';
import {
  type ScreenSwitch,
  SWITCH_NAMES,
  SWITCH_OFF_WORDS,
  switchOffQuestion,
} from '../../../shared/screen-switches';
import { BigQuestion, Key } from './KeepQuestion';
import { useOutput } from './output-store';

/*
 * The operator window's "Turn Audience off?" (or Stage) on the output that covers the controls (Session 51, S2-2),
 * as Keep these screens? is asked there: with only the one display, the question in the window under this output
 * could not be seen. Enter turns it off and Esc cancels: the keys reach the operator window under it (an output
 * never takes the keyboard), whose question then has Turn off ready for Enter, and this page answers them too
 * when it has them (a windowed output). Setting up, never the show: the hall may see it until it is answered.
 */

function Asked({ which }: { which: ScreenSwitch }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || (e.key !== 'Enter' && e.key !== 'Escape')) return;
      e.preventDefault();
      void window.drashti.output.switchAnswer(e.key === 'Enter');
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  return (
    <BigQuestion title={switchOffQuestion(which)} testId="switch-question" data-switch={which}>
      <p className="text-[5vmin]">{SWITCH_OFF_WORDS[which]}</p>
      <p className="text-[3.6vmin] leading-relaxed">
        <Key>Enter</Key> turns {SWITCH_NAMES[which]} off · <Key>Esc</Key> cancels
      </p>
    </BigQuestion>
  );
}

/** The window's question on this output while it covers the controls; nothing otherwise. */
export function SwitchQuestion() {
  const which = useOutput((s) => s.switchQuestion);
  return which ? <Asked key={which} which={which} /> : null;
}
