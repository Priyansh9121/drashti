import { useMemo } from 'react';
import type { PresentationDoc } from '../../../shared/library';
import { LANGS } from '../../../shared/model';
import { LANG_NAMES } from '../../../shared/themes';
import { slideLines } from '../../../shared/tracks';
import { editWords } from '../library/words-store';
import { useLibrary } from '../library/library-store';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Languages } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { SectionTitle } from '../ui/Panel';
import { Loading } from '../ui/States';
import { closeKirtan, draftChanged, makeKirtan, notKirtan, saveDraft, useKirtan } from './kirtan-store';
import { MakeTransliteration } from './MakeTransliteration';
import { KirtanDetailsForm } from './KirtanDetailsForm';

/** Each language: on how many of the slides that play it has words. */
function TrackSummary({ doc }: { doc: PresentationDoc }) {
  const counts = useMemo(() => {
    const slides = doc.groups.flatMap((g) => g.slides);
    return {
      total: slides.length,
      per: LANGS.map((lang) => ({
        lang,
        n: slides.filter((s) => slideLines(s.slide.elements).lines[lang]).length,
      })),
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
  const doc = useLibrary((s) => (s.doc?.id === open?.presentationId ? s.doc : null));
  if (!open) return null;
  const kirtan = doc?.kirtan ?? null;
  return (
    <Dialog
      title={`Kirtan: “${open.name}”`}
      subtitle="Its words in up to four languages, slide by slide."
      size="md"
      onClose={closeKirtan}
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
                closeKirtan();
                void editWords(open.presentationId, open.name, 'tracks');
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
    </Dialog>
  );
}
