import { useEffect, useMemo, useRef, useState } from 'react';
import { type GuideId, indexGuide, type IndexedGuide, searchGuides } from '../../../shared/guides';
import { type Block, parseMarkdown, passagesOf } from '../../../shared/markdown';
import { Dialog } from '../ui/Dialog';
import { TextInput } from '../ui/Field';
import { Loading } from '../ui/States';
import { TabPanel, Tabs } from '../ui/Tabs';
import { GuideText } from './GuideText';
import { closeGuides, useGuides } from './guides-store';

/*
 * The guides inside Drashti (Sessions 31–36): Help › Guides…, in Pro Mode and Simple Mode (which is given
 * the operator's and the presenter's guides only). The guides are read from the files that came with this
 * Drashti, through the bridge, and drawn by Drashti's own Markdown reader: nothing is fetched, and nothing
 * in a guide can open anything. A search finds the passages holding every word typed, by section; a result
 * opens its guide there, marked. It is a dialog like the keys sheet: Esc closes it, and the show's keys
 * wait while it is open.
 */

interface Loaded {
  blocks: Block[];
  index: IndexedGuide;
  sizes: Record<string, [number, number]>;
}

export function GuidesDialog() {
  const open = useGuides((s) => s.open);
  return open ? <GuidesWindow /> : null;
}

/** A passage's words, short enough for a result. */
const snippet = (text: string) => (text.length > 220 ? `${text.slice(0, 217).trimEnd()}…` : text);

function GuidesWindow() {
  const guide = useGuides((s) => s.guide);
  const passage = useGuides((s) => s.passage);
  const query = useGuides((s) => s.query);
  const [list, setList] = useState<{ id: GuideId; tab: string }[] | null>(null);
  const [loaded, setLoaded] = useState<Partial<Record<GuideId, Loaded | string>>>({});
  const content = useRef<HTMLDivElement>(null);
  // The guides this mode may read, each read once as the window opens (they are small).
  useEffect(() => {
    let live = true;
    void window.drashti.guides.list().then(async (guides) => {
      const read = await Promise.all(
        guides.map(async (g) => [g.id, await window.drashti.guides.read(g.id)] as const),
      );
      if (!live) return;
      setList(guides);
      const next: Partial<Record<GuideId, Loaded | string>> = {};
      for (const [id, r] of read) {
        if (!r.ok) next[id] = r.message;
        else {
          const blocks = parseMarkdown(r.text);
          next[id] = { blocks, index: indexGuide(id, passagesOf(blocks)), sizes: r.sizes };
        }
      }
      setLoaded(next);
    });
    return () => {
      live = false;
    };
  }, []);
  // The guide shown: the one asked for, if this mode may read it; else the first.
  const shown: GuideId = list?.some((g) => g.id === guide) ? guide : (list?.[0]?.id ?? guide);
  const doc = loaded[shown];
  const tabOf = (id: GuideId) => list?.find((g) => g.id === id)?.tab ?? id;
  const indexed = useMemo(
    () =>
      (list ?? []).flatMap((g) => {
        const l = loaded[g.id];
        return typeof l === 'object' ? [l.index] : [];
      }),
    [list, loaded],
  );
  const results = useMemo(() => searchGuides(indexed, query), [indexed, query]);
  const sections =
    typeof doc === 'object'
      ? doc.blocks.flatMap((b) => (b.kind === 'heading' && b.level === 2 ? [b] : []))
      : [];
  // The passage asked for (a result, Read more, a section) brought into view.
  useEffect(() => {
    if (passage === null || typeof doc !== 'object' || query !== '') return;
    content.current
      ?.querySelector(`[data-passage="${String(passage)}"]`)
      ?.scrollIntoView({ block: 'center' });
  }, [passage, doc, query]);
  const go = (id: GuideId, at: number | null) => {
    useGuides.setState({ guide: id, passage: at, query: '' });
  };

  return (
    <Dialog
      title="Guides"
      subtitle="As they came with this Drashti: nothing is fetched from the internet."
      size="xl"
      onClose={closeGuides}
      closeLabel="Close the guides"
      testId="guides"
      className="h-[min(48rem,100%)]"
      bodyClassName="flex min-h-0 flex-col gap-3 p-0"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <TextInput
          type="search"
          aria-label="Search the guides"
          placeholder="Search the guides"
          value={query}
          onChange={(e) => {
            useGuides.setState({ query: e.target.value });
          }}
          className="w-64"
        />
        {list && list.length > 0 && (
          <Tabs
            group="guides"
            label="The guides"
            items={list.map((g) => ({ id: g.id, label: g.tab }))}
            value={shown}
            onChange={(id) => {
              go(id, null);
            }}
          />
        )}
      </div>
      <div className="flex min-h-0 flex-1">
        {query === '' && sections.length > 0 && (
          <nav aria-label="Sections" className="w-56 shrink-0 overflow-y-auto border-r border-line px-3 pb-3">
            <ul className="space-y-0.5 text-sm">
              {sections.map((h) => (
                <li key={h.pid}>
                  <button
                    type="button"
                    onClick={() => {
                      go(shown, h.pid);
                    }}
                    className="w-full rounded-md px-2 py-1 text-left text-muted hover:bg-panel-2 hover:text-fg"
                  >
                    {h.children.map((c) => (c.kind === 'text' ? c.text : '')).join('')}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <div
          ref={content}
          tabIndex={0}
          role="region"
          aria-label={query === '' ? `The ${tabOf(shown)} guide` : 'What the search found'}
          className="min-w-0 flex-1 overflow-y-auto px-5 pb-6 focus:outline-none"
        >
          {query !== '' ? (
            <div data-testid="guide-results" className="space-y-4">
              {results.length === 0 && (
                <p className="text-muted">
                  Nothing in the guides holds every word of “{query}”. Try fewer words, or another word for
                  it.
                </p>
              )}
              {results.map((r) => (
                <section key={`${r.guide} ${r.section}`} aria-label={`${tabOf(r.guide)}: ${r.section}`}>
                  <h3 className="mb-1 text-sm font-semibold text-muted">
                    {tabOf(r.guide)} · {r.section}
                  </h3>
                  <ul className="space-y-1">
                    {r.hits.slice(0, 8).map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          data-testid="guide-hit"
                          onClick={() => {
                            go(r.guide, p.id);
                          }}
                          className="w-full rounded-md border border-line px-3 py-2 text-left text-sm hover:bg-panel-2"
                        >
                          <span className="block text-xs text-muted">
                            {tabOf(r.guide)} · {r.section}
                          </span>
                          {snippet(p.text)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <TabPanel group="guides" id={shown} className="max-w-[46rem]">
              {doc === undefined ? (
                <Loading label="Opening the guide…" />
              ) : typeof doc === 'string' ? (
                <p role="alert">{doc}</p>
              ) : (
                <GuideText blocks={doc.blocks} current={passage} sizes={doc.sizes} />
              )}
            </TabPanel>
          )}
        </div>
      </div>
    </Dialog>
  );
}
