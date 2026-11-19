import { useEffect, useMemo, useRef, useState } from 'react';
import {
  indexChapter,
  type IndexedChapter,
  MANUAL_CHAPTERS,
  type ManualChapterId,
  type ManualPrinted,
  manualChapter,
  manualPictureName,
  manualPictureUrl,
  savedWhere,
  searchManual,
} from '../../../shared/manual';
import { type Block, parseMarkdown, passagesOf } from '../../../shared/markdown';
import { cutText } from '../../../shared/text';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { Dialog } from '../ui/Dialog';
import { TextInput } from '../ui/Field';
import { Loading } from '../ui/States';
import { GuideText, type PictureOf } from './GuideText';
import { closeManual, useManual } from './manual-store';

/*
 * The Drashti Manual (x37, Session 60; the owner's "A, new Manual", 19 Nov 2026): Help › Drashti Manual…, in Pro Mode
 * and Simple Mode, and a panel's "?". Its chapters are read from the files that came with this Drashti, through the
 * bridge, and drawn by Drashti's own Markdown reader, as the guides are: nothing is fetched, and nothing in it can open
 * anything. The chapters down the left, one shown; a search finds the passages holding every word typed, by chapter
 * and feature, and a result opens its chapter there, marked. Print… and Save as PDF… print the whole manual from a
 * hidden window of the main process's. It is a dialog like the guides: Esc closes it, and the show's keys wait while
 * it is open. Nothing in it touches the show.
 */

interface Loaded {
  chapters: Record<ManualChapterId, Block[]>;
  index: IndexedChapter[];
  sizes: Record<string, [number, number]>;
}

export function ManualDialog() {
  const open = useManual((s) => s.open);
  return open ? <ManualWindow /> : null;
}

/** A passage's words, short enough for a result. */
const snippet = (text: string) => (text.length > 220 ? `${cutText(text, 217).trimEnd()}…` : text);

/** The manual's pictures, as its chapters write them ("../screenshots/<name>.png"). */
const manualPicture: PictureOf = (src) => {
  const url = manualPictureUrl(src);
  const name = manualPictureName(src);
  return url && name ? { url, name } : null;
};

/** What Print… or Save as PDF… said, in words: null when the person cancelled. */
function outcome(kind: 'print' | 'pdf', result: ManualPrinted): { text: string; problem: boolean } | null {
  if (result.ok)
    return kind === 'pdf' && result.file
      ? { text: `Saved the manual as a PDF: ${savedWhere(result.file)}.`, problem: false }
      : { text: 'The manual went to the printer.', problem: false };
  return result.cancelled ? null : { text: result.message, problem: true };
}

function ManualWindow() {
  const chapter = useManual((s) => s.chapter);
  const passage = useManual((s) => s.passage);
  const query = useManual((s) => s.query);
  const [loaded, setLoaded] = useState<Loaded | string | null>(null);
  const [busy, setBusy] = useState<'print' | 'pdf' | null>(null);
  const [said, setSaid] = useState<{ text: string; problem: boolean } | null>(null);
  const content = useRef<HTMLDivElement>(null);
  // Every chapter, read once as the window opens (they are small, and the search looks in them all).
  useEffect(() => {
    let live = true;
    void window.drashti.manual.read().then((r) => {
      if (!live) return;
      if (!r.ok) {
        setLoaded(r.message);
        return;
      }
      const chapters = {} as Record<ManualChapterId, Block[]>;
      for (const c of r.chapters) chapters[c.id] = parseMarkdown(c.text);
      setLoaded({
        chapters,
        index: r.chapters.map((c) => indexChapter(c.id, passagesOf(chapters[c.id]))),
        sizes: r.sizes,
      });
    });
    return () => {
      live = false;
    };
  }, []);
  const doc = typeof loaded === 'object' && loaded !== null ? loaded : null;
  const results = useMemo(() => (doc ? searchManual(doc.index, query) : []), [doc, query]);
  const title = manualChapter(chapter).title;
  // The passage asked for (a result, a "?"), or the chapter's start, brought into view.
  useEffect(() => {
    if (doc === null || query !== '') return;
    const box = content.current;
    if (!box) return;
    if (passage === null) box.scrollTop = 0;
    else box.querySelector(`[data-passage="${String(passage)}"]`)?.scrollIntoView({ block: 'center' });
  }, [passage, chapter, doc, query]);
  const go = (id: ManualChapterId, at: number | null) => {
    useManual.setState({ chapter: id, passage: at, query: '' });
  };
  const run = (kind: 'print' | 'pdf') => {
    setBusy(kind);
    setSaid({ text: kind === 'pdf' ? 'Making the PDF…' : 'Opening the print dialog…', problem: false });
    void (kind === 'pdf' ? window.drashti.manual.pdf() : window.drashti.manual.print())
      .then((result) => {
        setSaid(outcome(kind, result));
      })
      .finally(() => {
        setBusy(null);
      });
  };

  return (
    <Dialog
      title="Drashti Manual"
      subtitle="How to use every part of Drashti, as it came with this Drashti: nothing is fetched from the internet."
      size="xl"
      onClose={closeManual}
      closeLabel="Close the manual"
      testId="manual"
      className="h-[min(48rem,100%)]"
      bodyClassName="flex min-h-0 flex-col gap-3 p-0"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <TextInput
          type="search"
          aria-label="Search the manual"
          placeholder="Search the manual"
          data-autofocus=""
          value={query}
          onChange={(e) => {
            useManual.setState({ query: e.target.value });
          }}
          className="w-64"
        />
        <p
          role="status"
          className={cx('min-w-0 flex-1 truncate text-sm', said?.problem ? 'text-warning-fg' : 'text-muted')}
          title={said?.text}
        >
          {said?.text ?? ''}
        </p>
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null || doc === null}
            onClick={() => {
              run('print');
            }}
          >
            Print…
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null || doc === null}
            onClick={() => {
              run('pdf');
            }}
          >
            Save as PDF…
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Chapters" className="w-56 shrink-0 overflow-y-auto border-r border-line px-3 pb-3">
          <ul className="space-y-0.5 text-sm">
            {MANUAL_CHAPTERS.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  aria-current={c.id === chapter && query === '' ? 'true' : undefined}
                  onClick={() => {
                    go(c.id, null);
                  }}
                  className={cx(
                    'w-full rounded-md px-2 py-1 text-left hover:bg-panel-2 hover:text-fg',
                    c.id === chapter && query === '' ? 'bg-panel-2 font-semibold text-fg' : 'text-muted',
                  )}
                >
                  {c.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div
          ref={content}
          tabIndex={0}
          role="region"
          aria-label={query === '' ? title : 'What the search found'}
          className="min-w-0 flex-1 overflow-y-auto px-5 pb-6 focus:outline-none"
        >
          {query !== '' && doc !== null && (
            <div data-testid="manual-results" className="space-y-4 pt-3">
              {results.length === 0 && (
                <p className="text-muted">
                  Nothing in the manual holds every word of “{query}”. Try fewer words, or another word for
                  it.
                </p>
              )}
              {results.map((r) => {
                const named = manualChapter(r.chapter).title;
                const where = r.section === named ? named : `${named} · ${r.section}`;
                return (
                  <section key={`${r.chapter} ${r.section}`} aria-label={where}>
                    <h3 className="mb-1 text-sm font-semibold text-muted">{where}</h3>
                    <ul className="space-y-1">
                      {r.hits.slice(0, 8).map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            data-testid="manual-hit"
                            onClick={() => {
                              go(r.chapter, p.id);
                            }}
                            className="w-full rounded-md border border-line px-3 py-2 text-left text-sm hover:bg-panel-2"
                          >
                            <span className="block text-xs text-muted">{where}</span>
                            {snippet(p.text)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
          <div className={cx('max-w-[46rem] pt-3', query !== '' && 'hidden')}>
            {loaded === null ? (
              <Loading label="Opening the manual…" />
            ) : typeof loaded === 'string' ? (
              <p role="alert">{loaded}</p>
            ) : (
              <GuideText
                blocks={loaded.chapters[chapter]}
                current={passage}
                sizes={loaded.sizes}
                pictureOf={manualPicture}
              />
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
