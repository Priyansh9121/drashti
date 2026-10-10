import { useEffect, useMemo, useState } from 'react';
import type { PresentationSummary } from '../../../shared/library';
import type { TimerState } from '../../../shared/timers';
import type { TimerCue } from '../../../shared/playlists';
import { MAX_TIMER_CUES, SHASTRA_SLOT, TIMER_CUE_ACTIONS, TIMER_CUE_NAMES } from '../../../shared/playlists';
import { useEngine } from '../engine/engine-store';
import { useLibrary } from '../library/library-store';
import { PassagePicker } from '../shastra/PassagePicker';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Select, TextInput } from '../ui/Field';
import { Search } from '../ui/icons';
import { rowClass } from '../ui/ListRow';
import { EmptyState } from '../ui/States';
import {
  addSlot,
  editSlot,
  fillSlot,
  nodeOf,
  saveAsTemplate,
  setTimerCues,
  usePlaylists,
} from './playlist-store';

const NO_TIMERS: TimerState[] = [];

/** Every category a kirtan can have (Drashti's, the mandir's, and any a kirtan has). */
function useCategories(): string[] {
  const [categories, setCategories] = useState<string[]>([]);
  useEffect(() => {
    void window.drashti.kirtans.categories().then(setCategories);
  }, []);
  return categories;
}

/**
 * Save a playlist as a template: each presentation stays the same every
 * time, or becomes a slot filled each time (a kirtan's slot is named by its
 * category, and filling it searches there first). Headers and media stay;
 * placeholders become slots.
 */
export function SaveTemplateDialog() {
  const playlistId = usePlaylists((s) => s.savingTemplate);
  return playlistId ? <SaveTemplate key={playlistId} playlistId={playlistId} /> : null;
}

function SaveTemplate({ playlistId }: { playlistId: string }) {
  const items = usePlaylists((s) => s.items);
  const presentations = useLibrary((s) => s.presentations);
  const node = nodeOf(playlistId);
  const [name, setName] = useState(() => (node ? `${node.name} template` : 'Template'));
  const kirtanOf = useMemo(() => new Map(presentations.map((p) => [p.id, p.kirtan])), [presentations]);
  // Kirtans become slots unless the operator says otherwise; anything else stays.
  const [slots, setSlots] = useState<Set<string>>(
    () =>
      new Set(
        items.flatMap((i) => (i.kind === 'presentation' && kirtanOf.get(i.presentationId) ? [i.id] : [])),
      ),
  );
  const close = () => {
    usePlaylists.setState({ savingTemplate: null });
  };
  return (
    <Dialog
      title={`Save “${node?.name ?? 'the playlist'}” as a template`}
      subtitle="A running order to make each week's playlist from. Templates are kept apart from the playlists."
      size="md"
      onClose={close}
      testId="save-template"
      bodyClassName="space-y-4"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            disabled={name.trim() === ''}
            onClick={() => void saveAsTemplate(playlistId, name, [...slots])}
          >
            Save template
          </Button>
        </>
      }
    >
      <Field label="Name">
        <TextInput
          data-testid="template-name"
          value={name}
          maxLength={200}
          autoFocus
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </Field>
      <ol className="space-y-1.5" aria-label="What the template keeps" data-testid="template-items">
        {items.map((item) => {
          if (item.kind === 'header')
            return (
              <li key={item.id} className="pt-2 text-xs font-bold text-muted">
                {item.label}
              </li>
            );
          if (item.kind !== 'presentation')
            return (
              <li key={item.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <span className="text-xs text-muted">{item.kind === 'media' ? 'Kept' : 'A slot'}</span>
              </li>
            );
          const kirtan = kirtanOf.get(item.presentationId);
          return (
            <li key={item.id} className="flex items-center gap-2 text-sm" data-testid="template-item">
              <span className="min-w-0 flex-1 truncate">{item.presentationName ?? item.label}</span>
              <Select
                aria-label={`${item.presentationName ?? item.label} in the template`}
                className="h-8 w-56 text-xs"
                value={slots.has(item.id) ? 'slot' : 'fixed'}
                onChange={(e) => {
                  const next = new Set(slots);
                  if (e.target.value === 'slot') next.add(item.id);
                  else next.delete(item.id);
                  setSlots(next);
                }}
              >
                <option value="fixed">The same every time</option>
                <option value="slot">A slot to fill{kirtan?.category ? ` (${kirtan.category})` : ''}</option>
              </Select>
            </li>
          );
        })}
      </ol>
    </Dialog>
  );
}

/** A slot: a named place for a presentation, with the category its search starts at. */
export function AddSlotDialog() {
  const open = usePlaylists((s) => s.addingSlot);
  return open ? <AddSlot /> : null;
}

function AddSlot() {
  const categories = useCategories();
  const [label, setLabel] = useState('Kirtan');
  const [category, setCategory] = useState<string>('Kirtan');
  const close = () => {
    usePlaylists.setState({ addingSlot: false });
  };
  return (
    <Dialog
      title="Add a slot"
      subtitle="A place for a presentation, chosen each time: for example a kirtan, or the pravachan title."
      size="sm"
      onClose={close}
      testId="add-slot"
      bodyClassName="space-y-3"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            disabled={label.trim() === ''}
            onClick={() => void addSlot(label, category === '' ? null : category)}
          >
            Add slot
          </Button>
        </>
      }
    >
      <Field label="Name">
        <TextInput
          data-testid="slot-label"
          value={label}
          maxLength={200}
          autoFocus
          onChange={(e) => {
            setLabel(e.target.value);
          }}
        />
      </Field>
      <Field
        label="Search in"
        hint={
          category === SHASTRA_SLOT
            ? 'Filling the slot asks for a Shastra passage, by its reference or its words.'
            : 'Filling the slot starts with the kirtans of this category.'
        }
      >
        <Select
          data-testid="slot-category"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
          }}
        >
          <option value="">Every presentation</option>
          <option value={SHASTRA_SLOT}>A Shastra passage</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </Field>
    </Dialog>
  );
}

/** One presentation to choose, with its kirtan details. */
function Choice({ p, first }: { p: PresentationSummary; first: boolean }) {
  const details = p.kirtan
    ? [p.kirtan.category, p.kirtan.kavi, p.kirtan.raag].filter((d): d is string => d !== null)
    : [];
  return (
    <li>
      <button
        type="button"
        data-testid="slot-choice"
        data-first={first ? 'true' : undefined}
        className={`${rowClass({})} w-full px-2.5 py-1.5 text-left`}
        onClick={() => void fillSlot(p.id)}
      >
        <span className="block truncate text-sm font-medium">{p.name}</span>
        <span className="block truncate text-xs text-muted">
          {details.length > 0 ? details.join(' · ') : p.libraryName}
        </span>
      </button>
    </li>
  );
}

/**
 * Filling a slot: search, ready to pick, starting with the slot's category.
 * Typing searches titles, slide text, kavi and raag; Enter takes the first.
 */
export function FillSlotDialog() {
  const slot = usePlaylists((s) => s.filling);
  return slot ? <FillSlot key={slot.id} slot={slot} /> : null;
}

function FillSlot({ slot }: { slot: NonNullable<ReturnType<typeof usePlaylists.getState>['filling']> }) {
  if (slot.category === SHASTRA_SLOT) return <FillWithPassage slot={slot} />;
  return <FillWithPresentation slot={slot} />;
}

/** A slot that asks for a Shastra passage: its reference, or its words. */
function FillWithPassage({
  slot,
}: {
  slot: NonNullable<ReturnType<typeof usePlaylists.getState>['filling']>;
}) {
  const close = () => {
    usePlaylists.setState({ filling: null });
  };
  return (
    <Dialog
      title={`Fill “${slot.label}”`}
      subtitle="Choose the Shastra passage for this time."
      size="md"
      onClose={close}
      testId="fill-slot"
      bodyClassName="flex min-h-0 flex-col gap-3"
      footer={<Button onClick={close}>Cancel</Button>}
    >
      <PassagePicker
        onPick={(passageId) => {
          void fillSlot(passageId);
        }}
      />
    </Dialog>
  );
}

function FillWithPresentation({
  slot,
}: {
  slot: NonNullable<ReturnType<typeof usePlaylists.getState>['filling']>;
}) {
  const presentations = useLibrary((s) => s.presentations);
  const categories = useCategories();
  const [category, setCategory] = useState<string>(slot.category ?? '');
  const [query, setQuery] = useState('');
  // What the library's search found for what was typed (titles, words, kavi and raag).
  const [found, setFound] = useState<{ query: string; ids: string[] } | null>(null);
  useEffect(() => {
    if (query.trim() === '') return;
    let live = true;
    void window.drashti.library.search(query).then((r) => {
      if (live) setFound({ query, ids: r.hits.map((h) => h.presentationId) });
    });
    return () => {
      live = false;
    };
  }, [query]);
  const choices = useMemo(() => {
    const searched = query.trim() === '' ? null : (found?.ids ?? []);
    const inCategory = (p: PresentationSummary) => category === '' || p.kirtan?.category === category;
    if (searched === null) return presentations.filter(inCategory);
    const byId = new Map(presentations.map((p) => [p.id, p]));
    return searched.flatMap((id) => {
      const p = byId.get(id);
      return p && inCategory(p) ? [p] : [];
    });
  }, [presentations, query, found, category]);
  const close = () => {
    usePlaylists.setState({ filling: null });
  };
  return (
    <Dialog
      title={`Fill “${slot.label}”`}
      subtitle={slot.hint ? `Not found at import: ${slot.hint}` : 'Choose what goes here this time.'}
      size="md"
      onClose={close}
      testId="fill-slot"
      bodyClassName="flex min-h-0 flex-col gap-3"
      footer={<Button onClick={close}>Cancel</Button>}
    >
      <div className="flex flex-wrap gap-2">
        <span className="relative flex min-w-48 flex-1 items-center">
          <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2 text-faint" />
          <TextInput
            type="search"
            aria-label="Search"
            data-testid="slot-search"
            className="w-full pl-7"
            placeholder="Title, words, kavi or raag"
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            onKeyDown={(e) => {
              const first = choices[0];
              if (e.key === 'Enter' && first) {
                e.preventDefault();
                void fillSlot(first.id);
              }
            }}
          />
        </span>
        <Select
          aria-label="Category"
          data-testid="slot-filter"
          className="w-48"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
          }}
        >
          <option value="">Every presentation</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </div>
      {choices.length === 0 ? (
        <EmptyState icon={Search} title="Nothing here yet" compact>
          {category
            ? `No kirtan in ${category}${query ? ' has those words' : ''}: choose Every presentation, or give a kirtan this category in Kirtan.`
            : 'Nothing has those words.'}
        </EmptyState>
      ) : (
        <ul className="max-h-[50vh] min-h-0 space-y-1 overflow-y-auto" data-testid="slot-choices">
          {choices.slice(0, 200).map((p, i) => (
            <Choice key={p.id} p={p} first={i === 0} />
          ))}
        </ul>
      )}
    </Dialog>
  );
}

/** Renaming a slot, and changing the category its search starts at (Session 12). */
export function EditSlotDialog() {
  const slot = usePlaylists((s) => s.editingSlot);
  return slot ? <EditSlot key={slot.id} slot={slot} /> : null;
}

function EditSlot({ slot }: { slot: NonNullable<ReturnType<typeof usePlaylists.getState>['editingSlot']> }) {
  const categories = useCategories();
  const [label, setLabel] = useState(slot.label);
  const [category, setCategory] = useState<string>(slot.category ?? '');
  const close = () => {
    usePlaylists.setState({ editingSlot: null });
  };
  // The slot's own category stays offered, even if no kirtan has it now.
  const offered =
    slot.category && !categories.includes(slot.category) && slot.category !== SHASTRA_SLOT
      ? [slot.category, ...categories]
      : categories;
  return (
    <Dialog
      title="Edit slot"
      subtitle="Its name in the running order, and where filling it starts."
      size="sm"
      onClose={close}
      testId="edit-slot"
      bodyClassName="space-y-3"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            disabled={label.trim() === ''}
            data-testid="save-slot"
            onClick={() => void editSlot(label.trim(), category === '' ? null : category)}
          >
            Save
          </Button>
        </>
      }
    >
      <Field label="Name">
        <TextInput
          data-testid="slot-label"
          value={label}
          maxLength={200}
          autoFocus
          onChange={(e) => {
            setLabel(e.target.value);
          }}
        />
      </Field>
      <Field label="Search in">
        <Select
          data-testid="slot-category"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
          }}
        >
          <option value="">Every presentation</option>
          <option value={SHASTRA_SLOT}>A Shastra passage</option>
          {offered.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </Field>
    </Dialog>
  );
}

/**
 * What an item does to timers when it goes up (Session 12): start one from
 * the beginning, reset one, or show one on the audience screens. Templates
 * keep these, and a playlist made from a template gets them.
 */
export function TimerCuesDialog() {
  const item = usePlaylists((s) => s.cuesFor);
  return item ? <TimerCues key={item.id} item={item} /> : null;
}

function TimerCues({ item }: { item: NonNullable<ReturnType<typeof usePlaylists.getState>['cuesFor']> }) {
  const timers = useEngine((s) => s.state?.timers) ?? NO_TIMERS;
  const [cues, setCues] = useState<TimerCue[]>(item.timers);
  const close = () => {
    usePlaylists.setState({ cuesFor: null });
  };
  const first = timers[0];
  const change = (i: number, patch: Partial<TimerCue>) => {
    setCues((c) => c.map((cue, k) => (k === i ? { ...cue, ...patch } : cue)));
  };
  return (
    <Dialog
      title="Timers when it goes up"
      subtitle={`What “${item.label}” does to timers as it goes up (not when going back to it).`}
      size="md"
      onClose={close}
      testId="timer-cues"
      bodyClassName="space-y-3"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" data-testid="save-timer-cues" onClick={() => void setTimerCues(cues)}>
            Save
          </Button>
        </>
      }
    >
      {timers.length === 0 ? (
        <p className="text-sm text-muted">There are no timers yet: make one in the Timers panel first.</p>
      ) : (
        <>
          {cues.length === 0 && <p className="text-sm text-muted">It does nothing to timers.</p>}
          <ul className="space-y-2">
            {cues.map((cue, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2" data-testid="timer-cue">
                <Select
                  aria-label={`What cue ${i + 1} does`}
                  value={cue.action}
                  onChange={(e) => {
                    const action = TIMER_CUE_ACTIONS.find((a) => a === e.target.value);
                    if (action) change(i, { action });
                  }}
                >
                  {TIMER_CUE_ACTIONS.map((a) => (
                    <option key={a} value={a}>
                      {TIMER_CUE_NAMES[a]}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label={`The timer cue ${i + 1} is for`}
                  value={cue.timerId}
                  onChange={(e) => {
                    change(i, { timerId: e.target.value });
                  }}
                >
                  {!timers.some((t) => t.id === cue.timerId) && (
                    <option value={cue.timerId}>(a timer since removed)</option>
                  )}
                  {timers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setCues((c) => c.filter((_, k) => k !== i));
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          {first && cues.length < MAX_TIMER_CUES && (
            <Button
              size="sm"
              data-testid="add-timer-cue"
              onClick={() => {
                setCues((c) => [...c, { timerId: first.id, action: 'start' }]);
              }}
            >
              Add a timer
            </Button>
          )}
        </>
      )}
    </Dialog>
  );
}
