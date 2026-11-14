import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { findTemplates, TEMPLATE_QUICK_WORDS } from '../../../../shared/lower-third-search';
import {
  BEST_LOWER_THIRD_TEMPLATES,
  LOWER_THIRD_TEMPLATES,
  type LowerThirdTemplate,
} from '../../../../shared/lower-third-templates';
import { Button, IconButton } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { Dialog } from '../../ui/Dialog';
import { LayoutTemplate, Star } from '../../ui/icons';
import { usePersistentState } from '../../ui/persist';
import { FindBox } from './FindBox';
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

/*
 * Its four tags in words, for the tile's description (Session 58: the gallery's filters are words its one search box
 * understands now, lower-third-search.ts).
 */
const TAGS = {
  kind: { slide: 'Slide', wipe: 'Wipe', reveal: 'Reveal', pop: 'Pop', letters: 'Letters' },
  feel: { quick: 'Quick', elegant: 'Elegant', bold: 'Bold', calm: 'Calm' },
  speed: { quick: 'Quick', steady: 'Steady', slow: 'Slow' },
} as const satisfies {
  [K in 'kind' | 'feel' | 'speed']: Record<LowerThirdTemplate[K], string>;
};
const DIRECTIONS: Record<LowerThirdTemplate['direction'], string> = {
  left: 'From the left',
  right: 'From the right',
  up: 'From below',
  down: 'From above',
  centre: 'In the centre',
};

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

const TemplateTile = memo(function TemplateTile({
  template,
  active,
  favourite,
  onPlay,
  onStop,
  onChoose,
  onFavourite,
}: {
  template: LowerThirdTemplate;
  active: boolean;
  favourite: boolean;
  onPlay: (id: string) => void;
  onStop: (id: string) => void;
  onChoose: (template: LowerThirdTemplate) => void;
  onFavourite: (id: string) => void;
}) {
  const { id, name, direction, kind, feel, speed } = template;
  const description = [
    TAGS.kind[kind],
    DIRECTIONS[direction],
    TAGS.feel[feel] + ' feel',
    TAGS.speed[speed] + ' speed',
  ].join('. ');
  return (
    <li
      className="relative min-w-0"
      onPointerEnter={(event) => {
        if (event.pointerType !== 'touch') onPlay(id);
      }}
      onPointerLeave={() => {
        onStop(id);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onStop(id);
      }}
    >
      <button
        type="button"
        className="w-full overflow-hidden rounded-lg border border-field bg-panel-2 text-left hover:border-accent"
        data-testid="studio-template"
        data-template={id}
        data-style={template.input.look.style ?? 'box'}
        data-direction={direction}
        data-kind={kind}
        data-feel={feel}
        data-speed={speed}
        aria-description={description}
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible')) onPlay(id);
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
        <span className="block truncate px-3 py-2 text-sm font-medium">{name}</span>
      </button>
      <IconButton
        icon={Star}
        label={'Favourite ' + name}
        aria-pressed={favourite}
        variant={favourite ? 'strong' : 'secondary'}
        size="sm"
        tooltipSide="bottom"
        className={cx('absolute top-2 right-2', favourite && '[&_svg]:fill-current')}
        onClick={() => {
          onFavourite(id);
        }}
      />
    </li>
  );
});

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
  const [playing, setPlaying] = useState<string | null>(null);
  const favouritesButton = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const finding = useRef<HTMLDivElement>(null);
  const stop = useCallback((id: string) => {
    setPlaying((current) => (current === id ? null : current));
  }, []);
  const favourite = useCallback(
    (id: string) => {
      if (collection === 'favourites') favouritesButton.current?.focus();
      onFavourite(id);
    },
    [collection, onFavourite],
  );
  const available = useMemo(
    () => templatesIn(collection, favourites, recent),
    [collection, favourites, recent],
  );
  const matches = useMemo(() => findTemplates(available, query), [available, query]);
  // Searching Best 20, Favourites or Recently used: how many more All templates has.
  const asked = query.trim() !== '';
  const more = useMemo(
    () =>
      asked && collection !== 'all' ? findTemplates(LOWER_THIRD_TEMPLATES, query).length - matches.length : 0,
    [asked, collection, matches, query],
  );
  // What the box found starts at the top.
  useEffect(() => {
    grid.current?.scrollTo({ top: 0 });
  }, [query, collection]);
  const empty =
    collection === 'favourites'
      ? 'Star a template to keep it here.'
      : collection === 'recent'
        ? 'Choose a template to see it here.'
        : null;
  const count = `${String(matches.length)} template${matches.length === 1 ? '' : 's'}`;

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
              {...(key === 'favourites' ? { ref: favouritesButton } : {})}
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
        <div ref={finding} className="max-w-2xl">
          <FindBox
            label="Find a template"
            query={query}
            onQuery={(next) => {
              setQuery(next);
              setPlaying(null);
            }}
            placeholder="gold, from below, calm, slow…"
            testId="studio-template-search"
            statusTestId="studio-template-status"
            words={TEMPLATE_QUICK_WORDS}
            found={more > 0 ? `${count}; ${String(more)} more in All templates` : count}
            nothing={asked && matches.length === 0}
            {...(collection === 'all' ? {} : { where: COLLECTIONS[collection] })}
            actions={
              more > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setCollection('all');
                    setPlaying(null);
                    // It goes as All shows them all: the box keeps the keyboard.
                    finding.current?.querySelector('input')?.focus();
                  }}
                >
                  Look in All templates
                </Button>
              )
            }
            onDown={() => {
              grid.current?.querySelector<HTMLElement>('[data-testid="studio-template"]')?.focus();
            }}
            autoFocus
          />
        </div>
      </div>
      <div ref={grid} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {matches.length === 0 ? (
          !asked &&
          empty && (
            <p role="status" className="text-sm text-muted">
              {empty}
            </p>
          )
        ) : (
          <ul aria-label="Templates" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {matches.map((template) => (
              <TemplateTile
                key={template.id}
                template={template}
                active={playing === template.id}
                favourite={favourites.includes(template.id)}
                onPlay={setPlaying}
                onStop={stop}
                onChoose={onChoose}
                onFavourite={favourite}
              />
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

export function TemplatePicker({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
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
          onOpenChange(true);
        }}
      >
        Templates
      </Button>
      {open && (
        <Gallery
          favourites={favourites}
          recent={recent}
          onClose={() => {
            onOpenChange(false);
          }}
          onFavourite={(id) => {
            setFavourites(
              favourites.includes(id) ? favourites.filter((item) => item !== id) : [...favourites, id],
            );
          }}
          onChoose={(template) => {
            onOpenChange(false);
            makeNew(template.input, () => {
              setRecent([template.id, ...recent.filter((id) => id !== template.id)].slice(0, 20));
            });
          }}
        />
      )}
    </>
  );
}
