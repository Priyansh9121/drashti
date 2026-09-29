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
import { Button } from '../ui/Button';
import { plural } from '../ui/text';
import { closeThemes, useThemesPanel } from './themes-store';

/** Placeholder lines, one per language, for the preview. */
const SAMPLE: Record<Lang, string> = {
  gu: 'નમૂના પંક્તિ',
  translit: 'Namūnā pankti',
  hi: 'नमूना पंक्ति',
  en: 'Placeholder line',
};

const field =
  'rounded-md border border-line bg-ink px-2 py-1 text-sm text-white focus-visible:outline-2 focus-visible:outline-accent';

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
    <div className="space-y-4" data-testid="theme-editor">
      <label className="flex items-center gap-2 text-sm">
        <span className="w-16 text-muted">Name</span>
        <input
          aria-label="Theme name"
          className={`${field} flex-1`}
          value={draft.name}
          maxLength={80}
          onChange={(e) => {
            setDraft((d) => ({ ...d, name: e.target.value }));
          }}
        />
      </label>
      <div className="overflow-hidden rounded-md border border-line bg-black">
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
      <table className="w-full text-sm" data-testid="theme-langs">
        <thead className="text-left text-xs text-muted">
          <tr>
            <th className="py-1 font-normal">Language</th>
            <th className="font-normal">Font</th>
            <th className="font-normal">Size</th>
            <th className="font-normal">Weight</th>
            <th className="font-normal">Colour</th>
            <th className="font-normal">Shadow</th>
          </tr>
        </thead>
        <tbody>
          {LANGS.map((lang) => {
            const s = draft.langs[lang];
            const name = LANG_NAMES[lang];
            return (
              <tr key={lang} data-lang={lang}>
                <td className="py-1 pr-2">{name}</td>
                <td className="pr-2">
                  <input
                    aria-label={`${name} font`}
                    placeholder="Bundled font"
                    className={`${field} w-full`}
                    value={s.font ?? ''}
                    onChange={(e) => {
                      setLang(lang, { font: e.target.value.trim() === '' ? null : e.target.value });
                    }}
                  />
                </td>
                <td className="pr-2">
                  <input
                    aria-label={`${name} size`}
                    type="number"
                    min={8}
                    max={600}
                    className={`${field} w-20`}
                    value={s.size}
                    onChange={(e) => {
                      setLang(lang, { size: Number(e.target.value) || s.size });
                    }}
                  />
                </td>
                <td className="pr-2">
                  <select
                    aria-label={`${name} weight`}
                    className={field}
                    value={s.weight}
                    onChange={(e) => {
                      setLang(lang, { weight: Number(e.target.value) });
                    }}
                  >
                    <option value={400}>Regular</option>
                    <option value={500}>Medium</option>
                    <option value={700}>Bold</option>
                  </select>
                </td>
                <td className="pr-2">
                  <input
                    aria-label={`${name} colour`}
                    type="color"
                    className="h-8 w-12 rounded border border-line bg-ink"
                    value={s.color}
                    onChange={(e) => {
                      setLang(lang, { color: e.target.value });
                    }}
                  />
                </td>
                <td>
                  <input
                    aria-label={`${name} shadow`}
                    type="checkbox"
                    checked={s.shadow}
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
      <fieldset className="space-y-2 text-sm">
        <legend className="text-xs font-semibold uppercase tracking-wide text-muted">
          Text box (the first on each slide)
        </legend>
        <div className="flex flex-wrap items-center gap-2">
          {(['x', 'y', 'width', 'height'] as const).map((k) => (
            <label key={k} className="flex items-center gap-1 text-xs text-muted">
              {k === 'x' ? 'From left' : k === 'y' ? 'From top' : k === 'width' ? 'Width' : 'Height'}
              <input
                aria-label={`Box ${k}`}
                type="number"
                min={0}
                max={100}
                step={0.5}
                className={`${field} w-20`}
                value={percent(draft.box[k])}
                onChange={(e) => {
                  setBox({ [k]: Math.min(1, Math.max(0, Number(e.target.value) / 100)) });
                }}
              />
              %
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Alignment"
            className={field}
            value={draft.box.align}
            onChange={(e) => {
              setBox({ align: e.target.value as ThemeFields['box']['align'] });
            }}
          >
            <option value="left">Left</option>
            <option value="center">Centre</option>
            <option value="right">Right</option>
          </select>
          <select
            aria-label="Vertical alignment"
            className={field}
            value={draft.box.verticalAlign}
            onChange={(e) => {
              setBox({ verticalAlign: e.target.value as ThemeFields['box']['verticalAlign'] });
            }}
          >
            <option value="top">Top</option>
            <option value="middle">Middle</option>
            <option value="bottom">Bottom</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-muted">
            Line spacing
            <input
              aria-label="Line spacing"
              type="number"
              min={0.6}
              max={3}
              step={0.05}
              className={`${field} w-20`}
              value={draft.box.lineHeight}
              onChange={(e) => {
                setBox({ lineHeight: Number(e.target.value) || draft.box.lineHeight });
              }}
            />
          </label>
        </div>
      </fieldset>
      <fieldset className="flex flex-wrap items-center gap-2 text-sm">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Background</legend>
        <select
          aria-label="Background"
          className={field}
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
        </select>
        {bg.kind === 'color' && (
          <input
            aria-label="Background colour"
            type="color"
            className="h-8 w-12 rounded border border-line bg-ink"
            value={bg.color}
            onChange={(e) => {
              setDraft((d) => ({ ...d, background: { kind: 'color', color: e.target.value } }));
            }}
          />
        )}
        {bg.kind === 'media' && (
          <select
            aria-label="Background picture or video"
            className={`${field} max-w-64`}
            value={bg.mediaId}
            onChange={(e) => {
              const m = pictures.find((p) => p.id === e.target.value);
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
          </select>
        )}
      </fieldset>
      {problem && (
        <p role="alert" className="text-sm text-amber-200">
          {problem}
        </p>
      )}
      {note && <p className="text-sm text-emerald-200">{note}</p>}
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Button tone="primary" disabled={!changed} onClick={() => void save()}>
          Save
        </Button>
        <Button disabled={targets.length === 0} onClick={() => void apply()}>
          Apply to {targets.length === 0 ? 'presentations' : plural(targets.length, 'presentation')}
        </Button>
        <span className="flex-1 text-xs text-muted">
          Applies to the presentations marked in the library (Cmd/Ctrl-click to mark more). Words stay as they
          are; Undo puts the look back.
        </span>
        {!isDefault && (
          <Button
            tone="danger"
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
  const [themes, setThemes] = useState<Theme[]>([]);
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
  useEffect(() => {
    void window.drashti.themes.list().then((list) => {
      show(list);
    });
  }, []);
  const theme = themes.find((t) => t.id === chosen) ?? null;
  const make = async () => {
    const base = themes.find((t) => t.id === defaultId) ?? { ...DEFAULT_THEME };
    const { id: _id, ...fields } = base as Theme;
    const result = await window.drashti.themes.save(null, { ...fields, name: 'New theme' });
    if (result.ok) await reload(result.id);
  };
  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label="Themes"
    >
      <div
        className="flex h-full w-full max-w-4xl flex-col border-l border-line bg-panel shadow-2xl"
        data-testid="themes-panel"
      >
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h2 className="flex-1 text-lg font-semibold">Themes</h2>
          <Button onClick={() => void make()}>+ New theme</Button>
          <Button tone="ghost" onClick={closeThemes} aria-label="Close themes">
            Close
          </Button>
        </header>
        <div className="flex min-h-0 flex-1">
          <ul
            className="w-56 shrink-0 space-y-1 overflow-y-auto border-r border-line p-2"
            aria-label="Themes"
          >
            {themes.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  data-testid="theme-item"
                  aria-current={t.id === chosen ? 'true' : undefined}
                  onClick={() => {
                    setChosen(t.id);
                  }}
                  className={`w-full truncate rounded-md px-3 py-2 text-left text-sm ${
                    t.id === chosen ? 'bg-panel-2 ring-1 ring-accent' : 'hover:bg-panel-2'
                  }`}
                >
                  {t.name}
                  {t.id === defaultId && <span className="ml-1 text-xs text-muted">(default)</span>}
                </button>
              </li>
            ))}
          </ul>
          <div className="min-w-0 flex-1 overflow-y-auto p-4">
            {theme && (
              <ThemeEditor
                key={theme.id}
                theme={theme}
                isDefault={theme.id === defaultId}
                onSaved={(id) => void reload(id)}
                onRemoved={() => void reload()}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
