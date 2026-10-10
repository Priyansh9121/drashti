import { useMemo, useState } from 'react';
import type { PresentationDoc } from '../../../shared/library';
import { KIRTAN_LANGS, LANGS } from '../../../shared/model';
import { LANG_NAMES } from '../../../shared/themes';
import { slideLines } from '../../../shared/tracks';
import { editWords } from '../library/words-store';
import { useLibrary } from '../library/library-store';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { KeepChangesDialog, settingsChanged } from '../ui/KeepChanges';
import { Languages } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { SectionTitle } from '../ui/Panel';
import { Loading } from '../ui/States';
import { plural } from '../ui/text';
import { closeKirtan, draftChanged, makeKirtan, notKirtan, saveDraft, useKirtan } from './kirtan-store';
import { MakeTransliteration } from './MakeTransliteration';
import { KirtanDetailsForm } from './KirtanDetailsForm';

/** Each language: on how many of the slides that play it has words. */
function TrackSummary({ doc }: { doc: PresentationDoc }) {
  const counts = useMemo(() => {
    const slides = doc.groups.flatMap((g) => g.slides);
    return {
      total: slides.length,
      // The four kirtan languages, and Sanskrit when a slide has it.
      per: LANGS.map((lang) => ({
        lang,
        n: slides.filter((s) => slideLines(s.slide.elements).lines[lang]).length,
      })).filter(({ lang, n }) => n > 0 || (KIRTAN_LANGS as readonly string[]).includes(lang)),
    };
  }, [doc]);
  return (
    <ul className="space-y-1.5" data-testid="kirtan-tracks">
      {counts.per.map(({ lang, n }) => (
        <li
          key={lang}
          className="flex items-center gap-2 text-sm"
          data-testid="kirtan-track"
          data-lang={lang}
        >
          <span className="w-32 font-medium">{LANG_NAMES[lang]}</span>
          {n === 0 ? (
            <span className="text-muted">None yet</span>
          ) : (
            <span>
              {n === counts.total ? `Every slide (${n})` : `${n} of ${counts.total} slides`}
              {n < counts.total && (
                <Badge tone="warning" className="ml-2">
                  {counts.total - n} missing
                </Badge>
              )}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Whether a presentation is a kirtan, and its language tracks. A kirtan's
 * words come in up to four languages, slide by slide, and each screen can
 * show its own (Screens). Its words are its slides' own either way.
 */
export function KirtanDialog() {
  const open = useKirtan((s) => s.open);
  const saving = useKirtan((s) => s.saving);
  const problem = useKirtan((s) => s.problem);
  const changed = useKirtan(draftChanged);
  const draft = useKirtan((s) => s.draft);
  const saved = useKirtan((s) => s.saved);
  const doc = useLibrary((s) => (s.doc?.id === open?.presentationId ? s.doc : null));
  /** Asking before the typed details are lost; then what closing was for (Edit words by language). */
  const [asking, setAsking] = useState<{ then: () => void } | null>(null);
  // A question left from a dialog closed some other way never shows on the next one.
  const [askedFor, setAskedFor] = useState(open);
  if (askedFor !== open) {
    setAskedFor(open);
    setAsking(null);
  }
  if (!open) return null;
  const kirtan = doc?.kirtan ?? null;
  /** Close (then go on), asking first when typed details would be lost. */
  const requestClose = (then: () => void = () => undefined) => {
    if (changed) setAsking({ then });
    else {
      closeKirtan();
      then();
    }
  };
  return (
    <Dialog
      title={`Kirtan: “${open.name}”`}
      subtitle="Its words in up to four languages, slide by slide."
      size="md"
      onClose={() => {
        requestClose();
      }}
      testId="kirtan-dialog"
      bodyClassName="space-y-5"
      footer={
        doc &&
        (kirtan ? (
          <>
            <Button
              className="mr-auto"
              disabled={saving}
              data-testid="not-kirtan"
              onClick={() => void notKirtan()}
            >
              Not a kirtan
            </Button>
            <Button
              icon={Languages}
              onClick={() => {
                requestClose(() => void editWords(open.presentationId, open.name, 'tracks'));
              }}
            >
              Edit words by language
            </Button>
            <Button
              variant="primary"
              disabled={saving}
              data-testid="kirtan-done"
              onClick={() =>
                void saveDraft().then((ok) => {
                  if (ok) closeKirtan();
                })
              }
            >
              {changed ? 'Save' : 'Done'}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={closeKirtan}>Cancel</Button>
            <Button
              variant="primary"
              disabled={saving}
              data-testid="make-kirtan"
              onClick={() => void makeKirtan()}
            >
              Make it a kirtan
            </Button>
          </>
        ))
      }
    >
      {!doc ? (
        <Loading label="Opening the presentation…" />
      ) : kirtan ? (
        <section className="space-y-2">
          <SectionTitle>Languages</SectionTitle>
          <TrackSummary doc={doc} />
          <p className="text-xs text-muted">
            A slide with no words in a language shows it as missing in Edit words, By language, where it can
            be typed in. Screens sets which languages each screen shows.
          </p>
        </section>
      ) : null}
      {doc && kirtan && <KirtanDetailsForm doc={doc} />}
      {doc && kirtan && <MakeTransliteration doc={doc} />}
      {!doc || kirtan ? null : (
        <div className="space-y-2 text-sm">
          <p>
            A kirtan’s words come in language tracks: Gujarati, Hindi, English (the meaning) and
            transliteration, slide by slide. Each screen can then show its own languages, and the words can be
            edited one language at a time.
          </p>
          <p className="text-muted">
            Its words stay exactly where they are on its slides. “Not a kirtan” turns it back at any time.
          </p>
        </div>
      )}
      {problem && <Notice tone="danger">{problem}</Notice>}
      {asking && (
        <KeepChangesDialog
          name={<>the details of “{open.name}”</>}
          lost={`You changed ${plural(Math.max(1, settingsChanged(saved, draft)), 'detail')}.`}
          note="Its details never change what the screens show."
          saving={saving}
          onKeepEditing={() => {
            setAsking(null);
          }}
          onSave={() => {
            const { then } = asking;
            setAsking(null);
            void saveDraft().then((ok) => {
              if (!ok) return;
              closeKirtan();
              then();
            });
          }}
          onThrowAway={() => {
            const { then } = asking;
            setAsking(null);
            closeKirtan();
            then();
          }}
        />
      )}
    </Dialog>
  );
}
