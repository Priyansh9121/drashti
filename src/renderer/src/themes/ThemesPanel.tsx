import { useEffect, useMemo, useState } from 'react';
import type { Lang, RenderSlide, TextRun } from '../../../shared/model';
import { LANGS } from '../../../shared/model';
import type { Theme, ThemeFields } from '../../../shared/themes';
import { DEFAULT_THEME, LANG_NAMES } from '../../../shared/themes';
import { loadMedia, selectPresentation, useLibrary, useMedia } from '../library/library-store';
import { pushRemoval } from '../library/undo';
import { MediaStill } from '../render/MediaStill';
import { PlacedInParent } from '../render/Placed';
import { SlideView } from '../render/SlideView';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { ColorInput, Field, NumberInput, Select, TextInput } from '../ui/Field';
import { Palette, Plus, Trash2 } from '../ui/icons';
import { ListRow } from '../ui/ListRow';
import { Notice } from '../ui/Notice';
import { SectionTitle } from '../ui/Panel';
import { EmptyState, Loading } from '../ui/States';
import { plural } from '../ui/text';
import { closeThemes, useThemesPanel } from './themes-store';

/** Placeholder lines, one per language, for the preview. */
const SAMPLE: Record<Lang, string> = {
  gu: 'નમૂના પંક્તિ',
  translit: 'Namūnā pankti',
  hi: 'नमूना पंक्ति',
  en: 'Placeholder line',
};

/** A slide showing a line in each language under the theme. */
function previewSlide(t: ThemeFields): RenderSlide {
  const runs: TextRun[] = (['gu', 'translit', 'hi', 'en'] as const).map((lang, i, all) => ({
    text: i < all.length - 1 ? `${SAMPLE[lang]}\n` : SAMPLE[lang],
    lang,
    font: t.langs[lang].font,
    size: t.langs[lang].size,
    weight: t.langs[lang].weight,
    color: t.langs[lang].color,
    shadow: t.langs[lang].shadow,
  }));
  return {
    id: 'theme-preview',
    width: 1920,
    height: 1080,
    background:
      t.background.kind === 'color' ? t.background.color : t.background.kind === 'none' ? '#000000' : null,
    elements: [
      {
        id: 'theme-preview-text',
        kind: 'text',
        frame: {
          x: t.box.x * 1920,
          y: t.box.y * 1080,
          width: t.box.width * 1920,
          height: t.box.height * 1080,
        },
        text: runs.map((r) => r.text).join(''),
        lang: 'gu',
        style: {
          fontFamily: t.langs.en.font,
          fontSize: t.langs.en.size,
          fontWeight: t.langs.en.weight,
          color: t.langs.en.color,
          align: t.box.align,
          verticalAlign: t.box.verticalAlign,
          lineHeight: t.box.lineHeight,
          shadow: t.langs.en.shadow,
        },
        runs,
      },
    ],
  };
}

const percent = (n: number) => Math.round(n * 1000) / 10;

function ThemeEditor({
  theme,
  isDefault,
  onSaved,
  onRemoved,
}: {
  theme: Theme;
  isDefault: boolean;
  onSaved: (id: string) => void;
  onRemoved: () => void;
}) {
  const [draft, setDraft] = useState<ThemeFields>(theme);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const marked = useLibrary((s) => s.marked);
  const selectedId = useLibrary((s) => s.selectedId);
  const media = useMedia((s) => s.media);
  useEffect(() => {
    void loadMedia();
  }, []);
  // The draft starts as the theme itself (id and all), so the two compare directly.
  const changed = JSON.stringify(draft) !== JSON.stringify(theme);
  const slide = useMemo(() => previewSlide(draft), [draft]);
  const setLang = (lang: Lang, patch: Partial<ThemeFields['langs'][Lang]>) => {
    setDraft((d) => ({ ...d, langs: { ...d.langs, [lang]: { ...d.langs[lang], ...patch } } }));
  };
  const setBox = (patch: Partial<ThemeFields['box']>) => {
    setDraft((d) => ({ ...d, box: { ...d.box, ...patch } }));
  };
  const targets = marked.length > 0 ? marked : selectedId ? [selectedId] : [];

  const save = async () => {
    const { id: _id, ...fields } = draft as Theme;
    const result = await window.drashti.themes.save(theme.id, fields);
    setProblem(result.ok ? null : result.message);
    if (result.ok) onSaved(result.id);
  };
  const apply = async () => {
    if (changed) await save();
    const result = await window.drashti.themes.apply(theme.id, targets);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setProblem(null);
    setNote(`Applied to ${plural(result.count, 'presentation')}.`);
    const { revisionId } = result;
    pushRemoval({
      text: `Applied the theme “${draft.name}” to ${plural(result.count, 'presentation')}`,
      restore: async () => {
        await window.drashti.library.restoreRevision(revisionId);
        const shown = useLibrary.getState().selectedId;
        if (shown) await selectPresentation(shown);
      },
    });
    const shown = useLibrary.getState().selectedId;
    if (shown) await selectPresentation(shown);
  };
  const bg = draft.background;
  const pictures = media.filter((m) => m.kind !== 'audio' && !m.missing && m.unplayable === null);

  return (
    <div className="space-y-5" data-testid="theme-editor">
      <Field label="Name" layout="inline">
        <TextInput
          aria-label="Theme name"
          className="flex-1"
          value={draft.name}
          maxLength={80}
          onChange={(e) => {
            setDraft((d) => ({ ...d, name: e.target.value }));
          }}
        />
      </Field>
      <div
        className="overflow-hidden rounded-lg border border-line-strong bg-black"
        data-a11y-picture
        aria-hidden="true"
      >
        <PlacedInParent
          content={{ width: 1920, height: 1080 }}
          mode="fit"
          className="relative aspect-video w-full"
        >
          <span className="absolute inset-0">
            {bg.kind === 'media' && <MediaStill mediaId={bg.mediaId} media={bg.media} fit={bg.fit} />}
            <SlideView slide={slide} media="still" />
          </span>
        </PlacedInParent>
      </div>
      <section className="space-y-2">
        <SectionTitle>Each language</SectionTitle>
        <table className="w-full text-sm" data-testid="theme-langs">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="py-1 font-medium">Language</th>
              <th className="font-medium">Font</th>
              <th className="font-medium">Size</th>
              <th className="font-medium">Weight</th>
              <th className="font-medium">Colour</th>
              <th className="font-medium">Shadow</th>
            </tr>
          </thead>
          <tbody>
            {LANGS.map((lang) => {
              const st = draft.langs[lang];
              const name = LANG_NAMES[lang];
              return (
                <tr key={lang} data-lang={lang}>
                  <td className="py-1 pr-2 font-medium">{name}</td>
                  <td className="pr-2">
                    <TextInput
                      aria-label={`${name} font`}
                      placeholder="Bundled font"
                      className="w-full"
                      value={st.font ?? ''}
                      onChange={(e) => {
                        setLang(lang, { font: e.target.value.trim() === '' ? null : e.target.value });
                      }}
                    />
                  </td>
                  <td className="pr-2">
                    <NumberInput
                      aria-label={`${name} size`}
                      min={8}
                      max={600}
                      value={st.size}
                      onChange={(e) => {
                        setLang(lang, { size: Number(e.target.value) || st.size });
                      }}
                    />
                  </td>
                  <td className="pr-2">
                    <Select
                      aria-label={`${name} weight`}
                      value={st.weight}
                      onChange={(e) => {
                        setLang(lang, { weight: Number(e.target.value) });
                      }}
                    >
                      <option value={400}>Regular</option>
                      <option value={500}>Medium</option>
                      <option value={700}>Bold</option>
                    </Select>
                  </td>
                  <td className="pr-2">
                    <ColorInput
                      aria-label={`${name} colour`}
                      value={st.color}
                      onChange={(e) => {
                        setLang(lang, { color: e.target.value });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`${name} shadow`}
                      type="checkbox"
                      className="h-4 w-4 accent-accent-strong"
                      checked={st.shadow}
                      onChange={(e) => {
                        setLang(lang, { shadow: e.target.checked });
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <fieldset className="space-y-2 text-sm">
        <legend className="mb-2">
          <SectionTitle>Text box (the first on each slide)</SectionTitle>
        </legend>
        <div className="flex flex-wrap items-center gap-3">
          {(['x', 'y', 'width', 'height'] as const).map((k) => (
            <label key={k} className="flex items-center gap-1.5 text-xs text-muted">
              {k === 'x' ? 'From left' : k === 'y' ? 'From top' : k === 'width' ? 'Width' : 'Height'}
              <NumberInput
                aria-label={`Box ${k}`}
                min={0}
                max={100}
                step={0.5}
                unit="%"
                value={percent(draft.box[k])}
                onChange={(e) => {
                  setBox({ [k]: Math.min(1, Math.max(0, Number(e.target.value) / 100)) });
                }}
              />
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Alignment"
            value={draft.box.align}
            onChange={(e) => {
              setBox({ align: e.target.value as ThemeFields['box']['align'] });
            }}
          >
            <option value="left">Left</option>
            <option value="center">Centre</option>
            <option value="right">Right</option>
          </Select>
          <Select
            aria-label="Vertical alignment"
            value={draft.box.verticalAlign}
            onChange={(e) => {
              setBox({ verticalAlign: e.target.value as ThemeFields['box']['verticalAlign'] });
            }}
          >
            <option value="top">Top</option>
            <option value="middle">Middle</option>
            <option value="bottom">Bottom</option>
          </Select>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            Line spacing
            <NumberInput
              aria-label="Line spacing"
              min={0.6}
              max={3}
              step={0.05}
              value={draft.box.lineHeight}
              onChange={(e) => {
                setBox({ lineHeight: Number(e.target.value) || draft.box.lineHeight });
              }}
            />
          </label>
        </div>
      </fieldset>
      <fieldset className="flex flex-wrap items-center gap-2 text-sm">
        <legend className="mb-2">
          <SectionTitle>Background</SectionTitle>
        </legend>
        <Select
          aria-label="Background"
          value={bg.kind}
          onChange={(e) => {
            const kind = e.target.value;
            const first = pictures[0];
            setDraft((d) => ({
              ...d,
              background:
                kind === 'color'
                  ? { kind: 'color', color: '#000000' }
                  : kind === 'media' && first
                    ? {
                        kind: 'media',
                        mediaId: first.id,
                        media: first.kind === 'video' ? 'video' : 'image',
                        fit: 'fill',
                        loop: true,
                      }
                    : { kind: 'none' },
            }));
          }}
        >
          <option value="none">Leave as it is</option>
          <option value="color">A colour</option>
          <option value="media" disabled={pictures.length === 0}>
            A picture or video
          </option>
        </Select>
        {bg.kind === 'color' && (
          <ColorInput
            aria-label="Background colour"
            value={bg.color}
            onChange={(e) => {
              setDraft((d) => ({ ...d, background: { kind: 'color', color: e.target.value } }));
            }}
          />
        )}
        {bg.kind === 'media' && (
          <Select
            aria-label="Background picture or video"
            className="max-w-64"
            value={bg.mediaId}
            onChange={(e) => {
              const m = pictures.find((pic) => pic.id === e.target.value);
              if (m)
                setDraft((d) => ({
                  ...d,
                  background: { ...bg, mediaId: m.id, media: m.kind === 'video' ? 'video' : 'image' },
                }));
            }}
          >
            {pictures.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        )}
      </fieldset>
      {problem && <Notice tone="danger">{problem}</Notice>}
      {note && (
        <Notice tone="success" role="status">
          {note}
        </Notice>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Button variant="primary" disabled={!changed} onClick={() => void save()}>
          Save
        </Button>
        <Button disabled={targets.length === 0} onClick={() => void apply()}>
          Apply to {targets.length === 0 ? 'presentations' : plural(targets.length, 'presentation')}
        </Button>
        <span className="min-w-48 flex-1 text-xs text-muted">
          Applies to the presentations marked in the library (Cmd/Ctrl-click to mark more). Words stay as they
          are; Undo puts the look back.
        </span>
        {!isDefault && (
          <Button
            variant="danger"
            icon={Trash2}
            onClick={() => {
              void window.drashti.themes.remove(theme.id).then((r) => {
                if (r.ok) onRemoved();
                else setProblem(r.message);
              });
            }}
          >
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}

/** The themes: pick one to see and change it, make new ones, apply one to presentations. */
export function ThemesPanel() {
  const open = useThemesPanel((s) => s.open);
  return open ? <Panel initial={useThemesPanel.getState().pick} /> : null;
}

function Panel({ initial }: { initial: string | null }) {
  const [themes, setThemes] = useState<Theme[] | null>(null);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(initial);
  const show = (list: { themes: Theme[]; defaultId: string }, pick?: string) => {
    setThemes(list.themes);
    setDefaultId(list.defaultId);
    setChosen((c) => pick ?? (c && list.themes.some((t) => t.id === c) ? c : (list.themes[0]?.id ?? null)));
  };
  const reload = async (pick?: string) => {
    show(await window.drashti.themes.list(), pick);
  };
  // Loaded as the panel opens, and again whenever themes change (one made from a template or a slide).
  useEffect(() => {
    const load = () => {
      void window.drashti.themes.list().then((list) => {
        show(list);
      });
    };
    load();
    return window.drashti.library.onChanged((what) => {
      if (what === 'themes') load();
    });
  }, []);
  const theme = themes?.find((t) => t.id === chosen) ?? null;
  const make = async () => {
    const base = themes?.find((t) => t.id === defaultId) ?? { ...DEFAULT_THEME };
    const { id: _id, ...fields } = base as Theme;
    const result = await window.drashti.themes.save(null, { ...fields, name: 'New theme' });
    if (result.ok) await reload(result.id);
  };
  return (
    <Dialog
      title="Themes"
      placement="right"
      size="xl"
      onClose={closeThemes}
      closeLabel="Close themes"
      panelTestId="themes-panel"
      bodyClassName="flex min-h-0 p-0"
      headerActions={
        <Button icon={Plus} onClick={() => void make()}>
          New theme
        </Button>
      }
    >
      {themes === null ? (
        <Loading label="Loading the themes…" className="flex-1" />
      ) : (
        <>
          <ul
            className="w-56 shrink-0 space-y-1 overflow-y-auto border-r border-line p-2"
            aria-label="Themes"
          >
            {themes.map((t) => (
              <li key={t.id}>
                <ListRow
                  data-testid="theme-item"
                  aria-current={t.id === chosen ? 'true' : undefined}
                  selected={t.id === chosen}
                  density="compact"
                  title={t.name}
                  trailing={t.id === defaultId ? <Badge tone="info">Default</Badge> : undefined}
                  onClick={() => {
                    setChosen(t.id);
                  }}
                />
              </li>
            ))}
          </ul>
          <div className="min-w-0 flex-1 overflow-y-auto p-5">
            {theme ? (
              <ThemeEditor
                key={theme.id}
                theme={theme}
                isDefault={theme.id === defaultId}
                onSaved={(id) => void reload(id)}
                onRemoved={() => void reload()}
              />
            ) : (
              <EmptyState icon={Palette} title="No theme chosen">
                Pick a theme on the left, or make a new one.
              </EmptyState>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
