import { useEffect, useId, useState } from 'react';
import type { PendingScreens } from '../../../shared/keep-screens';
import { shortcutText } from '../../../shared/keymap';
import { plural } from '../../../shared/text';
import { useOutput } from './output-store';

/*
 * Keep these screens? on the output that covers the controls (Session 50): the operator window's question,
 * large, in this output's middle, with its countdown, as the controls under it cannot be seen. Enter keeps and
 * Esc goes back: the keys reach the operator window under it (an output never takes the keyboard), and this
 * page answers them too when it has them (a windowed output). Setting up, never the show: the hall may see it
 * for those 15 s.
 */

/** Whole seconds left until `deadline` (ms since the epoch), never below none. */
const secondsLeft = (deadline: number, now: number) => Math.max(0, Math.ceil((deadline - now) / 1000));

/** A key, as large as the words around it. */
const Key = ({ children }: { children: string }) => (
  <kbd className="rounded-[0.6vmin] border-[0.3vmin] border-white px-[1.2vmin] font-bold">{children}</kbd>
);

function Asked({ question }: { question: PendingScreens }) {
  const titleId = useId();
  const [platform, setPlatform] = useState('darwin');
  // The countdown by this computer's clock, as Main set the deadline by it: setting up, never a frame of the show.
  // eslint-disable-next-line no-restricted-properties -- Keep these screens?'s countdown (setting up, never the show)
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // eslint-disable-next-line no-restricted-syntax -- Keep these screens?'s countdown: never decides a frame of the show
    const timer = setInterval(() => {
      // eslint-disable-next-line no-restricted-properties -- Keep these screens?'s countdown (setting up, never the show)
      setNow(Date.now());
    }, 250);
    return () => {
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    void window.drashti.app.getInfo().then((info) => {
      setPlatform(info.platform);
    });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || (e.key !== 'Enter' && e.key !== 'Escape')) return;
      e.preventDefault();
      void window.drashti.output.keepAnswer(e.key === 'Enter');
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  const seconds = secondsLeft(question.deadline, now);
  return (
    <div
      className="absolute inset-0 z-[60] flex items-center justify-center bg-black/70 p-[4vmin]"
      data-testid="keep-question"
      data-seconds={seconds}
      role="alertdialog"
      aria-labelledby={titleId}
    >
      <div className="flex max-w-[86vw] flex-col items-center gap-[3vmin] rounded-[2vmin] border-[0.6vmin] border-accent bg-black px-[6vmin] py-[5vmin] text-center text-white">
        <h1 id={titleId} className="text-[9vmin] leading-tight font-bold">
          Keep these screens?
        </h1>
        <p role="timer" className="text-[5vmin]" data-testid="keep-question-countdown">
          {seconds > 0 ? `Going back by itself in ${plural(seconds, 'second')}.` : 'Going back now…'}
        </p>
        <p className="text-[3.6vmin] leading-relaxed">
          <Key>Enter</Key> keeps · <Key>Esc</Key> goes back ·{' '}
          <Key>{shortcutText('uncoverControls', platform)}</Key> turns this output off
        </p>
      </div>
    </div>
  );
}

/** The question on this output while it covers the controls and a change waits; nothing otherwise. */
export function KeepQuestion() {
  const question = useOutput((s) => s.keepQuestion);
  // Made again for each new deadline (a second change starts the countdown again).
  return question ? <Asked key={question.deadline} question={question} /> : null;
}
