import { useState } from 'react';
import { animationById } from '../../../../shared/lower-third-animations';
import {
  BEST_LOWER_THIRD_TEMPLATES,
  LOWER_THIRD_TEMPLATES,
  type LowerThirdTemplate,
} from '../../../../shared/lower-third-studio';
import { Button, IconButton } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { Dialog } from '../../ui/Dialog';
import { Field, Select, TextInput } from '../../ui/Field';
import { LayoutTemplate, Star } from '../../ui/icons';
import { usePersistentState } from '../../ui/persist';
import { makeNew } from './studio-store';
import { StudioPreview } from './StudioPreview';

const COLLECTIONS = {
  best: 'Best 20',
  all: 'All templates',
  favourites: 'Favourites',
  recent: 'Recently used',
} as const;
const COLLECTION_KEYS = ['best', 'all', 'favourites', 'recent'] as const;
type Collection = (typeof COLLECTION_KEYS)[number];

const FILTERS = {
  direction: {
    label: 'Direction',
    values: { left: 'Left', right: 'Right', up: 'Up', down: 'Down', centre: 'Centre' },
  },
  kind: {
    label: 'Kind',
    values: { slide: 'Slide', wipe: 'Wipe', reveal: 'Reveal', pop: 'Pop', letters: 'Letters' },
  },
  feel: { label: 'Feel', values: { quick: 'Quick', elegant: 'Elegant', bold: 'Bold', calm: 'Calm' } },
  speed: { label: 'Speed', values: { quick: 'Quick', steady: 'Steady', slow: 'Slow' } },
} as const;
const FILTER_KEYS = ['direction', 'kind', 'feel', 'speed'] as const;

const TEMPLATE_BY_ID = new Map(LOWER_THIRD_TEMPLATES.map((template) => [template.id, template]));
const isIdList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((id: unknown) => typeof id === 'string');

function templatesIn(collection: Collection, favourites: readonly string[], recent: readonly string[]) {
  switch (collection) {
    case 'best':
      return BEST_LOWER_THIRD_TEMPLATES;
    case 'all':
      return LOWER_THIRD_TEMPLATES;
    case 'favourites':
      return LOWER_THIRD_TEMPLATES.filter((t) => favourites.includes(t.id));
    case 'recent':
      return recent.flatMap((id) => {
        const template = TEMPLATE_BY_ID.get(id);
        return template ? [template] : [];
      });
  }
}

function Gallery({
  favourites,
  recent,
  onFavourite,
  onChoose,
  onClose,
}: {
  favourites: readonly string[];
  recent: readonly string[];
  onFavourite: (id: string) => void;
  onChoose: (template: LowerThirdTemplate) => void;
  onClose: () => void;
}) {
  const [collection, setCollection] = useState<Collection>('best');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({ direction: '', kind: '', feel: '', speed: '' });
  const [playing, setPlaying] = useState<string | null>(null);
  const stop = (id: string) => {
    setPlaying((current) => (current === id ? null : current));
  };
  const words = query.toLowerCase().trim().split(/\s+/u);
  const available = templatesIn(collection, favourites, recent);
  const matches = available.filter((template) => {
    const animation = animationById(template.input.animation);
    const text = [template.name, animation.name, ...FILTER_KEYS.map((key) => template[key])]
      .join(' ')
      .toLowerCase();
    return (
      FILTER_KEYS.every((key) => !filters[key] || filters[key] === template[key]) &&
      words.every((word) => text.includes(word))
    );
  });
  const empty =
    available.length === 0 && collection === 'favourites'
      ? 'Star a template to keep it here.'
      : available.length === 0 && collection === 'recent'
        ? 'Choose a template to see it here.'
        : 'No templates match. Try a different search or filter.';

  return (
    <Dialog
      title="Lower third templates"
      size="lg"
      className="h-[min(36rem,100%)]"
      onClose={onClose}
      bodyClassName="flex flex-col overflow-hidden! p-0!"
    >
      <div className="shrink-0 space-y-3 border-b border-line px-5 py-3">
        <div role="group" aria-label="Template collections" className="flex flex-wrap gap-1.5">
          {COLLECTION_KEYS.map((key) => (
            <Button
              key={key}
              variant={key === collection ? 'strong' : 'ghost'}
              size="sm"
              aria-pressed={key === collection}
              onClick={() => {
                setCollection(key);
                setPlaying(null);
              }}
            >
              {COLLECTIONS[key]}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          <Field label="Search templates" className="col-span-4 min-w-0 sm:col-span-2">
            <TextInput
              type="search"
              value={query}
              data-autofocus=""
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setPlaying(null);
              }}
            />
          </Field>
          {FILTER_KEYS.map((key) => (
            <Field key={key} label={FILTERS[key].label} className="min-w-0">
              <Select
                value={filters[key]}
                onChange={(event) => {
                  setFilters({ ...filters, [key]: event.currentTarget.value });
                  setPlaying(null);
                }}
              >
                <option value="">Any</option>
                {Object.entries(FILTERS[key].values).map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </Select>
            </Field>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {matches.length === 0 ? (
          <p role="status" className="text-sm text-muted">
            {empty}
          </p>
        ) : (
          <ul aria-label="Templates" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {matches.map((template) => {
              const active = playing === template.id;
              const favourite = favourites.includes(template.id);
              return (
                <li key={template.id} className="relative min-w-0">
                  <button
                    type="button"
                    className="w-full overflow-hidden rounded-lg border border-field bg-panel-2 text-left hover:border-accent"
                    data-testid="studio-template"
                    data-template={template.id}
                    data-style={template.input.look.style ?? 'box'}
                    onPointerEnter={(event) => {
                      if (event.pointerType !== 'touch') setPlaying(template.id);
                    }}
                    onPointerLeave={() => {
                      stop(template.id);
                    }}
                    onFocus={(event) => {
                      if (event.currentTarget.matches(':focus-visible')) setPlaying(template.id);
                    }}
                    onBlur={() => {
                      stop(template.id);
                    }}
                    onClick={() => {
                      onChoose(template);
                    }}
                  >
                    <StudioPreview
                      key={active ? 'play' : 'still'}
                      input={template.input}
                      play={0}
                      backdrop="picture"
                      thumbnail={active ? 'play' : 'still'}
                    />
                    <span className="block truncate px-3 py-2 text-sm font-medium">{template.name}</span>
                  </button>
                  <IconButton
                    icon={Star}
                    label={`Favourite ${template.name}`}
                    aria-pressed={favourite}
                    variant={favourite ? 'strong' : 'secondary'}
                    size="sm"
                    tooltipSide="bottom"
                    className={cx('absolute top-2 right-2', favourite && '[&_svg]:fill-current')}
                    onClick={() => {
                      onFavourite(template.id);
                    }}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

export function TemplatePicker() {
  const [open, setOpen] = useState(false);
  const [favourites, setFavourites] = usePersistentState('lower-third-template-favourites', [], isIdList);
  const [recent, setRecent] = usePersistentState('lower-third-template-recent', [], isIdList);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        icon={LayoutTemplate}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="studio-templates"
        onClick={(event) => {
          event.currentTarget.focus();
          setOpen(true);
        }}
      >
        Templates
      </Button>
      {open && (
        <Gallery
          favourites={favourites}
          recent={recent}
          onClose={() => {
            setOpen(false);
          }}
          onFavourite={(id) => {
            setFavourites(
              favourites.includes(id) ? favourites.filter((item) => item !== id) : [...favourites, id],
            );
          }}
          onChoose={(template) => {
            setOpen(false);
            makeNew(template.input, () => {
              setRecent([template.id, ...recent.filter((id) => id !== template.id)].slice(0, 20));
            });
          }}
        />
      )}
    </>
  );
}
