import { useEffect, useMemo, useState } from 'react';
import type { PresentationSummary } from '../../../shared/library';
import { SHASTRA_SLOT } from '../../../shared/playlists';
import { useLibrary } from '../library/library-store';
import { PassagePicker } from '../shastra/PassagePicker';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Select, TextInput } from '../ui/Field';
import { Search } from '../ui/icons';
import { rowClass } from '../ui/ListRow';
import { EmptyState } from '../ui/States';
import { addSlot, fillSlot, nodeOf, saveAsTemplate, usePlaylists } from './playlist-store';

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
              <li key={item.id} className="pt-2 text-2xs font-bold tracking-wider text-muted uppercase">
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
