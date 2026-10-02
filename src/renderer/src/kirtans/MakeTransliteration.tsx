import { useEffect, useId, useState } from 'react';
import type { MakeTranslitResult, ManualLines } from '../../../shared/kirtans';
import type { PresentationDoc } from '../../../shared/library';
import type { TranslitStyle } from '../../../shared/translit';
import { selectPresentation, useLibrary } from '../library/library-store';
import { pushRemoval } from '../library/undo';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Notice } from '../ui/Notice';
import { SectionTitle } from '../ui/Panel';
import { plural } from '../ui/text';

type Ask = NonNullable<Extract<MakeTranslitResult, { ok: false }>['ask']>;

/** What making it did, in words. */
function summary(r: Extract<MakeTranslitResult, { ok: true }>): string {
  const parts = [
    r.added > 0 ? `${plural(r.added, 'line')} filled in` : '',
    r.renewed > 0 ? `${plural(r.renewed, 'line')} made again` : '',
    r.replaced > 0 ? `${plural(r.replaced, 'changed line')} replaced` : '',
    r.kept > 0 ? `${plural(r.kept, 'line')} you changed kept as they are` : '',
    r.same > 0 && r.added + r.renewed + r.replaced === 0 ? 'it was already up to date' : '',
  ].filter((p) => p !== '');
  const none =
    r.noSource > 0 ? ` ${plural(r.noSource, 'slide')} with no Gujarati or Hindi words left as they are.` : '';
  return `Transliteration made: ${parts.join(', ') || 'nothing to change'}.${none}`;
}

/**
 * A kirtan's transliteration track, made from its Gujarati lines (or Hindi,
 * on a slide with none): Plain (no accent marks) or With accent marks (ISO
 * 15919), remembered for next time. Lines it makes stay editable; a line
 * changed by hand is never replaced without asking.
 */
export function MakeTransliteration({ doc }: { doc: PresentationDoc }) {
  const [style, setStyle] = useState<TranslitStyle>('plain');
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [said, setSaid] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const name = useId();
  useEffect(() => {
    void window.drashti.kirtans.getTranslitStyle().then(setStyle);
  }, []);
  const hasWords = doc.kirtan?.tracks.some((l) => l === 'gu' || l === 'hi') ?? false;

  const make = async (manual: ManualLines) => {
    setBusy(true);
    setSaid(null);
    const r = await window.drashti.kirtans.makeTransliteration(doc.id, style, manual);
    setBusy(false);
    if (!r.ok) {
      if (r.ask) setAsk(r.ask);
      else setSaid({ tone: 'danger', text: r.message });
      return;
    }
    setAsk(null);
    setSaid({ tone: 'success', text: summary(r) });
    const { revisionId } = r;
    if (revisionId)
      pushRemoval({
        text: `Made the transliteration of “${doc.name}”`,
        restore: async () => {
          await window.drashti.library.restoreRevision(revisionId);
          if (useLibrary.getState().selectedId === doc.id) await selectPresentation(doc.id);
        },
      });
    if (useLibrary.getState().selectedId === doc.id) await selectPresentation(doc.id);
  };

  return (
    <section className="space-y-2" data-testid="make-transliteration">
      <SectionTitle>Transliteration</SectionTitle>
      <p className="text-xs text-muted">
        Made from each slide’s Gujarati lines (or Hindi), as the words are said. Lines Drashti makes can be
        edited; a line you change is yours, and is kept when it is made again unless you choose to replace it.
      </p>
      <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <legend className="sr-only">Style</legend>
        {(
          [
            ['plain', 'Plain (no accent marks)'],
            ['iso', 'With accent marks (ISO 15919)'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="inline-flex items-center gap-2">
            <input
              type="radio"
              name={name}
              className="h-4 w-4 accent-accent-strong"
              checked={style === value}
              data-testid={`translit-style-${value}`}
              onChange={() => {
                setStyle(value);
                void window.drashti.kirtans.setTranslitStyle(value);
              }}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <Button disabled={busy || !hasWords} data-testid="make-translit" onClick={() => void make('ask')}>
        Make transliteration
      </Button>
      {!hasWords && <p className="text-xs text-muted">It has no Gujarati or Hindi words to make it from.</p>}
      {said && (
        <Notice tone={said.tone} data-testid="translit-result">
          {said.text}
        </Notice>
      )}
      {ask && (
        <Dialog
          title="Replace lines you changed?"
          role="alertdialog"
          size="sm"
          onClose={() => {
            setAsk(null);
          }}
          closeButton={false}
          testId="translit-ask"
          footer={
            <>
              <Button
                onClick={() => {
                  setAsk(null);
                }}
              >
                Cancel
              </Button>
              <Button data-autofocus disabled={busy} onClick={() => void make('keep')}>
                Keep my lines
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => void make('replace')}>
                Replace them
              </Button>
            </>
          }
        >
          <div className="space-y-2 text-sm text-muted">
            <p>
              {plural(ask.count, 'transliteration line')} {ask.count === 1 ? 'was' : 'were'} changed by hand.
              Keep them as they are and make the rest, or replace them too?
            </p>
            <ul className="space-y-1">
              {ask.examples.map((e) => (
                <li key={e.number}>
                  Slide {e.number}: “{e.now}” (Drashti would make “{e.made}”)
                </li>
              ))}
            </ul>
          </div>
        </Dialog>
      )}
    </section>
  );
}
