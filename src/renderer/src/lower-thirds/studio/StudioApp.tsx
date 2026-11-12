import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { lowerThirdName, shownLines, WHERE_NAMES } from '../../../../shared/lower-thirds';
import { connectEngine, useEngine } from '../../engine/engine-store';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { Captions, Play, Plus, Trash2 } from '../../ui/icons';
import { KeepChangesDialog, settingsChanged } from '../../ui/KeepChanges';
import { Notice } from '../../ui/Notice';
import { radioKeys, radioTabIndex } from '../../ui/radio';
import { Truncate } from '../../ui/Truncate';
import { BACKDROP_NAMES, BACKDROPS, type Backdrop, StudioPreview } from './StudioPreview';
import { AnimationTab, BackgroundTab, StyleTab, TimingTab, WordsTab } from './StudioTabs';
import { TemplatePicker } from './TemplatePicker';
import {
  choose,
  connectStudio,
  isDirty,
  makeNew,
  playAgain,
  remove,
  save,
  showOrHide,
  type StudioTab,
  undoDelete,
  useStudio,
} from './studio-store';

/*
 * The Lower Thirds studio (Session 55, Part 16): a window of its own. On the left, the library's lower thirds (one
 * up on the screens says so) and New and Templates; in the middle, the live preview of the one open, playing as it
 * will on the screens; on the right, its words, its style and look, how it comes in and goes out, its moving
 * background and how long it stays up, a tab each; along the bottom, Delete, Show (or Hide) and Save. Choosing
 * another, a new one or a template with changes not saved asks first, and so does closing the window.
 */

const TABS: readonly { id: StudioTab; name: string }[] = [
  { id: 'words', name: 'Words' },
  { id: 'style', name: 'Style' },
  { id: 'animation', name: 'Animation' },
  { id: 'background', name: 'Background' },
  { id: 'timing', name: 'Timing' },
];

/**
 * Closing the window with changes not saved: the main process keeps it open and says so (it knows from here whether
 * there are any), and this asks first; answered, the window closes.
 */
function useCloseGuard(): void {
  const dirty = useStudio((s) => isDirty(s));
  useEffect(() => {
    void window.drashti.lowerThirds.dirty(dirty);
  }, [dirty]);
  useEffect(
    () =>
      window.drashti.lowerThirds.onAskClose(() => {
        useStudio.setState({
          asking: {
            then: () => {
              void window.drashti.lowerThirds.close();
            },
          },
        });
      }),
    [],
  );
}

function StudioList({ upId }: { upId: string | null }) {
  const list = useStudio((s) => s.list);
  const id = useStudio((s) => s.id);
  const dirty = useStudio((s) => isDirty(s));
  return (
    <aside aria-label="Lower thirds" className="flex w-52 shrink-0 flex-col border-r border-line">
      <ul data-testid="studio-list" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
        {list === null ? null : list.length === 0 ? (
          <li className="px-2 py-1.5 text-xs text-muted">
            None yet: New makes one, or start from one of the Templates.
          </li>
        ) : (
          list.map((lt) => {
            const open = lt.id === id;
            const rest = [WHERE_NAMES[lt.where], lt.seconds === undefined ? null : `${String(lt.seconds)} s`]
              .filter((x) => x !== null)
              .join(' · ');
            return (
              <li
                key={lt.id}
                data-testid="studio-row"
                data-id={lt.id}
                data-up={lt.id === upId ? 'true' : undefined}
                data-saved={open && dirty ? 'false' : 'true'}
              >
                <button
                  type="button"
                  aria-current={open ? 'true' : undefined}
                  className={cx(
                    'flex w-full min-w-0 flex-col items-start gap-0.5 rounded-md px-2.5 py-1.5 text-left',
                    open ? 'bg-panel-3 text-fg' : 'text-muted hover:bg-panel-2 hover:text-fg',
                  )}
                  onClick={() => {
                    choose(lt.id);
                  }}
                >
                  <span className="flex w-full min-w-0 items-center gap-1.5">
                    {lt.id === upId && (
                      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-live" />
                    )}
                    <Truncate
                      text={lowerThirdName(lt.lines)}
                      className="min-w-0 text-sm font-medium text-fg"
                    />
                  </span>
                  <span className="text-xs">
                    {rest}
                    {lt.id === upId ? ' · Up now' : ''}
                    {open && dirty ? ' · Not saved' : ''}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </aside>
  );
}

function TabPanel({ tab }: { tab: StudioTab }): ReactNode {
  switch (tab) {
    case 'words':
      return <WordsTab />;
    case 'style':
      return <StyleTab />;
    case 'animation':
      return <AnimationTab />;
    case 'background':
      return <BackgroundTab />;
    case 'timing':
      return <TimingTab />;
  }
}

export function StudioApp() {
  useEffect(() => {
    connectStudio();
    connectEngine();
  }, []);
  useCloseGuard();
  const draft = useStudio((s) => s.draft);
  const saved = useStudio((s) => s.saved);
  const id = useStudio((s) => s.id);
  const tab = useStudio((s) => s.tab);
  const play = useStudio((s) => s.play);
  const saving = useStudio((s) => s.saving);
  const problem = useStudio((s) => s.problem);
  const asking = useStudio((s) => s.asking);
  const deleted = useStudio((s) => s.deleted);
  const upId = useEngine((s) => s.state?.layers.lowerThird?.id ?? null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [backdrop, setBackdrop] = useState<Backdrop>('picture');
  const dirty = isDirty({ draft, saved });
  const hasWords = shownLines(draft.lines).length > 0;
  const up = id !== null && id === upId;
  const tabIds = TABS.map((t) => t.id);
  return (
    <div data-testid="lt-studio" className="flex h-full min-h-0 min-w-0 flex-col bg-ink text-fg">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4">
        <Captions size={18} aria-hidden="true" className="text-muted" />
        <h1 className="text-sm font-semibold">Lower Thirds</h1>
        <span className="truncate text-xs text-muted">
          {id === null ? 'A new lower third' : lowerThirdName(draft.lines)}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            icon={Plus}
            data-testid="studio-new"
            onClick={() => {
              makeNew();
            }}
          >
            New
          </Button>
          <TemplatePicker open={templatesOpen} onOpenChange={setTemplatesOpen} />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <StudioList upId={upId} />
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 gap-4 p-4">
            <section aria-label="Preview" className="flex min-w-0 flex-1 flex-col gap-2">
              <StudioPreview input={draft} play={play} backdrop={backdrop} paused={templatesOpen} />
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" icon={Play} onClick={playAgain}>
                  Play again
                </Button>
                <div
                  role="radiogroup"
                  aria-label="Behind the preview"
                  className="ml-auto flex gap-1"
                  onKeyDown={radioKeys(BACKDROPS, backdrop, setBackdrop)}
                >
                  {BACKDROPS.map((b, i) => (
                    <button
                      key={b}
                      type="button"
                      role="radio"
                      aria-checked={b === backdrop}
                      tabIndex={radioTabIndex(b === backdrop, i, true)}
                      className={cx(
                        'h-7 rounded-md border px-2 text-xs',
                        b === backdrop
                          ? 'border-accent bg-panel-3 text-fg'
                          : 'border-field bg-panel-2 text-muted hover:text-fg',
                      )}
                      onClick={() => {
                        setBackdrop(b);
                      }}
                    >
                      {BACKDROP_NAMES[b]}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted">
                The preview plays it as the screens will: in, held, then out. Changes show at once; Save keeps
                them, and changes it on the screens at once if it is up.
              </p>
            </section>
            <section aria-label="Its settings" className="flex w-84 shrink-0 flex-col">
              <div
                role="tablist"
                aria-label="Settings"
                className="flex shrink-0 flex-wrap gap-0.5 border-b border-line pb-2"
                onKeyDown={radioKeys(tabIds, tab, (next) => {
                  useStudio.setState({ tab: next });
                  requestAnimationFrame(() => {
                    document.getElementById(`studio-tab-${next}`)?.focus();
                  });
                })}
              >
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    id={`studio-tab-${t.id}`}
                    type="button"
                    role="tab"
                    aria-selected={t.id === tab}
                    aria-controls="studio-tab-panel"
                    tabIndex={t.id === tab ? 0 : -1}
                    className={cx(
                      'h-7 rounded-md px-1.5 text-sm',
                      t.id === tab ? 'bg-panel-3 font-medium text-fg' : 'text-muted hover:text-fg',
                    )}
                    onClick={() => {
                      useStudio.setState({ tab: t.id });
                    }}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
              <div
                id="studio-tab-panel"
                role="tabpanel"
                aria-labelledby={`studio-tab-${tab}`}
                tabIndex={0}
                className="min-h-0 flex-1 overflow-y-auto pt-3 pr-1"
              >
                <TabPanel tab={tab} />
              </div>
            </section>
          </div>
          <footer className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-2">
            <Button
              variant="ghost"
              size="sm"
              icon={Trash2}
              data-testid="studio-delete"
              disabled={id === null && !dirty}
              onClick={() => void remove()}
            >
              Delete
            </Button>
            <div className="min-w-0 flex-1">
              {problem ? (
                <Notice tone="danger" compact>
                  {problem}
                </Notice>
              ) : deleted ? (
                <Notice
                  tone="info"
                  compact
                  data-testid="studio-deleted"
                  actions={
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid="studio-undo"
                      onClick={() => void undoDelete()}
                    >
                      Undo
                    </Button>
                  }
                >
                  <span className="block truncate">Deleted “{deleted.name}”</span>
                </Notice>
              ) : null}
            </div>
            <Button
              variant={up ? 'live' : 'secondary'}
              size="sm"
              instant
              data-testid="studio-show"
              disabled={!hasWords || saving}
              onClick={() => void showOrHide(up)}
            >
              {up ? 'Hide' : dirty || id === null ? 'Save and show' : 'Show'}
            </Button>
            <Button
              variant="primary"
              size="sm"
              data-testid="lower-third-save"
              disabled={!hasWords || saving || (!dirty && id !== null)}
              onClick={() => void save()}
            >
              Save
            </Button>
          </footer>
        </main>
      </div>
      {asking && (
        <KeepChangesDialog
          name={id === null ? 'the new lower third' : `“${lowerThirdName(draft.lines)}”`}
          lost={
            saved === null
              ? 'This new lower third is not saved yet.'
              : `You changed ${String(Math.max(1, settingsChanged(saved, draft)))} setting${settingsChanged(saved, draft) === 1 ? '' : 's'}.`
          }
          {...(up ? { live: 'Saving changes it at once on the screens.' } : {})}
          onKeepEditing={() => {
            useStudio.setState({ asking: null });
          }}
          onSave={() => {
            const then = asking.then;
            useStudio.setState({ asking: null });
            void save().then((kept) => {
              if (kept) then();
            });
          }}
          onThrowAway={() => {
            const then = asking.then;
            useStudio.setState({ asking: null });
            then();
          }}
          saving={saving}
        />
      )}
    </div>
  );
}
