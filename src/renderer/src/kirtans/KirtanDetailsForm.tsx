import { useEffect, useId, useMemo, useState } from 'react';
import { OCCASION_SUGGESTIONS } from '../../../shared/kirtans';
import type { PresentationDoc } from '../../../shared/library';
import { MediaPicker } from '../editor/MediaPicker';
import { loadMedia, useLibrary, useMedia } from '../library/library-store';
import { Button, IconButton } from '../ui/Button';
import { Field, Select, TextInput } from '../ui/Field';
import { Music, Play, Plus, X } from '../ui/icons';
import { SectionTitle } from '../ui/Panel';
import { addCategory, editDraft, loadDraft, useKirtan } from './kirtan-store';

/** Every value of a detail among the library's kirtans, for suggestions. */
function useKnown(pick: (k: { kavi: string | null; raag: string | null; occasions: string[] }) => string[]) {
  const presentations = useLibrary((s) => s.presentations);
  return useMemo(() => {
    const set = new Set<string>();
    for (const p of presentations) if (p.kirtan) for (const v of pick(p.kirtan)) set.add(v);
    return [...set].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  }, [presentations, pick]);
}

const kavis = (k: { kavi: string | null }) => (k.kavi ? [k.kavi] : []);
const raags = (k: { raag: string | null }) => (k.raag ? [k.raag] : []);
const occasionsOf = (k: { occasions: string[] }) => k.occasions;

/**
 * A kirtan's details: its category (Drashti's list, which can be added to),
 * kavi and raag (with the library's own as suggestions), the occasions it is
 * sung for (any number), and a recording from the media library. The
 * library filters by them and search finds kirtans by kavi and raag.
 */
export function KirtanDetailsForm({ doc }: { doc: PresentationDoc }) {
  const draft = useKirtan((s) => s.draft);
  const categories = useKirtan((s) => s.categories);
  const [adding, setAdding] = useState<string | null>(null);
  const [occasion, setOccasion] = useState('');
  const [picking, setPicking] = useState(false);
  const media = useMedia((s) => s.media);
  const ids = { kavi: useId(), raag: useId(), occasion: useId() };
  const knownKavis = useKnown(kavis);
  const knownRaags = useKnown(raags);
  const knownOccasions = useKnown(occasionsOf);
  const kirtan = doc.kirtan;
  useEffect(() => {
    void loadMedia();
  }, []);
  // Start from the kirtan's details whenever they are loaded again (after a save, or Undo).
  useEffect(() => {
    if (kirtan)
      loadDraft({
        category: kirtan.category,
        kavi: kirtan.kavi,
        raag: kirtan.raag,
        occasions: kirtan.occasions,
        audioMediaId: kirtan.audioMediaId,
      });
  }, [kirtan]);
  if (!draft) return null;
  const recording = media.find((m) => m.id === draft.audioMediaId) ?? null;
  const addOccasion = () => {
    const o = occasion.trim();
    if (o !== '' && !draft.occasions.includes(o)) editDraft({ occasions: [...draft.occasions, o] });
    setOccasion('');
  };
  const categoryList =
    draft.category && !categories.includes(draft.category) ? [...categories, draft.category] : categories;
  return (
    <section className="space-y-3" data-testid="kirtan-details">
      <SectionTitle>Details</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Category">
          {adding === null ? (
            <div className="flex gap-1.5">
              <Select
                className="min-w-0 flex-1"
                data-testid="kirtan-category"
                value={draft.category ?? ''}
                onChange={(e) => {
                  editDraft({ category: e.target.value === '' ? null : e.target.value });
                }}
              >
                <option value="">No category</option>
                {categoryList.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
              <IconButton
                icon={Plus}
                label="Add a category"
                data-testid="add-category"
                onClick={() => {
                  setAdding('');
                }}
              />
            </div>
          ) : (
            <form
              className="flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                void addCategory(adding).then((ok) => {
                  if (ok) setAdding(null);
                });
              }}
            >
              <TextInput
                aria-label="New category"
                data-testid="new-category"
                className="min-w-0 flex-1"
                autoFocus
                maxLength={60}
                value={adding}
                placeholder="For example Bhajan"
                onChange={(e) => {
                  setAdding(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setAdding(null);
                  }
                }}
              />
              <Button type="submit" disabled={adding.trim() === ''}>
                Add
              </Button>
            </form>
          )}
        </Field>
        <Field label="Kavi">
          <TextInput
            list={ids.kavi}
            data-testid="kirtan-kavi"
            maxLength={120}
            value={draft.kavi ?? ''}
            placeholder="Who wrote it"
            onChange={(e) => {
              editDraft({ kavi: e.target.value });
            }}
          />
        </Field>
        <Field label="Raag">
          <TextInput
            list={ids.raag}
            data-testid="kirtan-raag"
            maxLength={120}
            value={draft.raag ?? ''}
            onChange={(e) => {
              editDraft({ raag: e.target.value });
            }}
          />
        </Field>
        <Field label="Recording">
          <div className="flex min-w-0 items-center gap-1.5" data-testid="kirtan-recording">
            <Music size={14} aria-hidden="true" className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate text-sm">
              {recording ? recording.name : draft.audioMediaId ? 'A recording' : 'None'}
            </span>
            {draft.audioMediaId && (
              <>
                <IconButton
                  icon={Play}
                  label="Play it on the audio layer"
                  onClick={() =>
                    void window.drashti.engine.dispatch({
                      type: 'playAudio',
                      audio: {
                        id: `kirtan-recording:${doc.id}`,
                        title: recording?.name ?? doc.name,
                        mediaId: draft.audioMediaId,
                        volume: 1,
                        loop: false,
                      },
                    })
                  }
                />
                <IconButton
                  icon={X}
                  label="No recording"
                  onClick={() => {
                    editDraft({ audioMediaId: null });
                  }}
                />
              </>
            )}
            <Button
              size="sm"
              data-testid="choose-recording"
              onClick={() => {
                setPicking(true);
              }}
            >
              Choose…
            </Button>
          </div>
        </Field>
      </div>
      <Field label="Occasions">
        <div className="space-y-1.5">
          {draft.occasions.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Occasions" data-testid="kirtan-occasions">
              {draft.occasions.map((o) => (
                <li
                  key={o}
                  className="inline-flex items-center gap-1 rounded-md border border-line-strong bg-panel-2 py-0.5 pr-0.5 pl-2 text-sm"
                >
                  {o}
                  <IconButton
                    icon={X}
                    size="sm"
                    label={`Not for ${o}`}
                    onClick={() => {
                      editDraft({ occasions: draft.occasions.filter((x) => x !== o) });
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-1.5">
            <TextInput
              aria-label="Add an occasion"
              list={ids.occasion}
              data-testid="kirtan-occasion"
              className="min-w-0 flex-1"
              maxLength={120}
              value={occasion}
              placeholder="For example Diwali"
              onChange={(e) => {
                setOccasion(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addOccasion();
                }
              }}
            />
            <Button icon={Plus} disabled={occasion.trim() === ''} onClick={addOccasion}>
              Add
            </Button>
          </div>
        </div>
      </Field>
      <datalist id={ids.kavi}>
        {knownKavis.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
      <datalist id={ids.raag}>
        {knownRaags.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <datalist id={ids.occasion}>
        {[...new Set([...OCCASION_SUGGESTIONS, ...knownOccasions])].map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      {picking && (
        <MediaPicker
          title="Choose its recording"
          sounds
          onChoose={(m) => {
            editDraft({ audioMediaId: m.id });
            setPicking(false);
          }}
          onClose={() => {
            setPicking(false);
          }}
        />
      )}
    </section>
  );
}
