import { useEffect } from 'react';
import type { ArtiPrompt as Prompt } from '../../../shared/arti';
import { countdownText } from '../../../shared/arti';
import { useNow } from '../render/useNow';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { Flame } from '../ui/icons';
import { cancelArtiCountdown, connectArti, notNowArti, putUpArti, useArti } from './arti-store';

/*
 * The arti prompt: across the operator window under its header, or (Simple
 * Mode) as a big button over the others. It counts down to the time; from
 * the time the arti is what Next shows. Put up Arti now, or Not now. A
 * schedule that goes up by itself counts ten seconds first, with Cancel.
 */

/** What the prompt says, changing only as it moves on (screen readers hear each once). */
function sentence(p: Prompt, now: number): string {
  if (p.byItselfAt !== null) return `${p.name} goes up by itself in ten seconds.`;
  if (now < p.at) return `${p.name} at ${p.time}.`;
  return `${p.name}: it is time (${p.time}). Next puts it up.`;
}

/** The ticking part: time to go, or to going up by itself. */
function ticking(p: Prompt, now: number): string {
  if (p.byItselfAt !== null) return `Up in ${String(Math.max(0, Math.ceil((p.byItselfAt - now) / 1000)))}`;
  if (now < p.at) return `in ${countdownText(p.at - now)}`;
  return `${countdownText(now - p.at)} ago`;
}

export function ArtiPrompt({ big = false }: { big?: boolean }) {
  const prompt = useArti((s) => s.view?.prompt ?? null);
  useEffect(() => {
    connectArti();
  }, []);
  const now = useNow(250);
  if (!prompt) return null;
  const { key } = prompt;
  const counting = prompt.byItselfAt !== null;
  return (
    <section
      aria-label="Arti prompt"
      data-testid="arti-prompt"
      data-counting={counting ? 'true' : undefined}
      className={cx(
        'flex shrink-0 items-center border-warning/60 bg-warning-bg text-warning-fg',
        big ? 'gap-3 border-t p-3' : 'gap-3 border-b px-4 py-2 text-sm',
      )}
    >
      <Flame size={big ? 32 : 18} aria-hidden="true" className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p role="status" className={cx('font-medium', big && 'text-xl font-bold')}>
          {sentence(prompt, now)}
        </p>
        <p
          aria-hidden="true"
          data-testid="arti-countdown"
          className={cx('font-bold tabular-nums', big ? 'text-3xl' : 'text-base')}
        >
          {ticking(prompt, now)}
        </p>
      </div>
      {counting && (
        <Button
          size={big ? 'xl' : 'md'}
          variant="secondary"
          data-testid="arti-cancel"
          onClick={() => void cancelArtiCountdown(key)}
        >
          Cancel
        </Button>
      )}
      <Button
        size={big ? 'xxl' : 'md'}
        variant="primary"
        icon={big ? Flame : undefined}
        data-testid="arti-put-up"
        className={big ? 'flex-[2]' : undefined}
        onClick={() => void putUpArti(key)}
      >
        Put up Arti now
      </Button>
      <Button
        size={big ? 'xl' : 'md'}
        variant="secondary"
        data-testid="arti-not-now"
        onClick={() => void notNowArti(key)}
      >
        Not now
      </Button>
    </section>
  );
}
