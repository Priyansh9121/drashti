import { useEffect, useRef, useState } from 'react';
import type { ScreenGroupConfig } from '../../../shared/screens';
import type { TextElement } from '../../../shared/model';
import type { TranslationLanguage } from '../../../shared/prepared-translations';
import {
  noTranslator,
  translationForSource,
  type TranslationEngineStatus,
} from '../../../shared/prepared-translations';
import {
  translationLayoutProblem,
  translationSource,
  translationSourceSupported,
  type TranslationChoice,
  type TranslationDisplay,
} from '../../../shared/prepared-translation-view';
import { renderEditedSlide } from '../../../shared/slide-design';
import { LANG_NAMES } from '../../../shared/themes';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, TextInput as Input, Select, Textarea } from '../ui/Field';
import { Notice } from '../ui/Notice';
import { useScreens } from '../screens/screens-store';
import { TranslationPreview } from './TranslationPreview';
import { commit, useEditor } from './editor-store';
import {
  approvePreparedWords,
  defaultTranslationDisplay,
  draftTargets,
  editPreparedWords,
  placeDraft,
  placePreparedWords,
  preparedRows,
  routePreparedWords,
} from './prepared-translation-ops';

const NO_GROUPS: ScreenGroupConfig[] = [];
const languages = ['gu', 'hi', 'en'] as const;
const language = (value: string): TranslationLanguage => languages.find((item) => item === value) ?? 'gu';
const choice = (value: string): TranslationChoice => (value === 'off' ? 'off' : language(value));
function Choices({ inherit = false }: { inherit?: boolean }) {
  return (
    <>
      {inherit && <option value="">Use presentation or group choice</option>}
      <option value="off">Off</option>
      {languages.map((lang) => (
        <option key={lang} value={lang}>
          {LANG_NAMES[lang]}
        </option>
      ))}
    </>
  );
}

export function TranslationDialog({ onClose, readOnly }: { onClose: () => void; readOnly: boolean }) {
  const doc = useEditor((state) => state.doc);
  const groups = useScreens((state) => state.snapshot?.groups ?? NO_GROUPS);
  const rows = doc ? preparedRows(doc) : [];
  const first = rows[0]?.element;
  const saved = first?.translations?.[0];
  const [from, setFrom] = useState<TranslationLanguage>(
    saved?.sourceLanguage ?? (first?.lang === 'hi' || first?.lang === 'gu' ? first.lang : 'en'),
  );
  const [to, setTo] = useState<TranslationLanguage>(saved?.targetLanguage ?? (from === 'gu' ? 'en' : 'gu'));
  const [reader, setReader] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [preview, setPreview] = useState(rows[0]?.slide.id ?? '');
  // Prepare translations (alpha.22): the offline engine's state for this direction, and a run under way.
  const [engine, setEngine] = useState<TranslationEngineStatus | null>(null);
  const [preparing, setPreparing] = useState<{ done: number; total: number } | null>(null);
  const stopped = useRef(false);
  useEffect(() => {
    // Simple Mode only reads saved translations: it never asks for the engine.
    if (readOnly) return;
    let current = true;
    void window.drashti.slideEditor.translationStatus(from, to).then((status) => {
      if (current) setEngine(status);
    });
    return () => {
      current = false;
    };
  }, [from, to, preparing, readOnly]);
  useEffect(
    () => () => {
      stopped.current = true;
    },
    [],
  );
  if (!doc) return null;
  const prepare = async () => {
    const targets = draftTargets(doc, from, to);
    if (readOnly || preparing || targets.length === 0) return;
    stopped.current = false;
    setProblem(null);
    setPreparing({ done: 0, total: targets.length });
    const drafted: { target: (typeof targets)[number]; text: string }[] = [];
    for (const [i, target] of targets.entries()) {
      if (stopped.current) break;
      const draft = await window.drashti.slideEditor.translationDraft({ source: target.source, from, to });
      if (stopped.current) break;
      if (!draft.ok) {
        setProblem(draft.message);
        // Only this box's words could not be drafted (too long, a model marker): go on with the next box.
        if (!draft.thisBoxOnly) break;
      } else drafted.push({ target, text: draft.text });
      setPreparing({ done: i + 1, total: targets.length });
    }
    // The drafts made, put in together (Stop keeps those made before it): one Undo takes the run back. A box the
    // operator typed into meanwhile keeps its words (placeDraft).
    const latest = useEditor.getState().doc;
    if (latest && drafted.length > 0)
      commit(drafted.reduce((next, d) => placeDraft(next, d.target, from, to, d.text), latest));
    setPreparing(null);
  };
  const stopPreparing = () => {
    stopped.current = true;
    void window.drashti.slideEditor.translationCancel();
  };
  const drafts = readOnly ? 0 : draftTargets(doc, from, to).length;
  const change = (fn: () => void) => {
    if (readOnly) return;
    try {
      fn();
      setProblem(null);
    } catch (error) {
      setProblem(
        error instanceof Error
          ? error.message
          : 'The translation could not be changed. Check the source, target and reserved area, then try again.',
      );
    }
  };
  const route = first?.translationDisplay;
  const routeChange = (
    defaultChoice: TranslationChoice,
    groupRoutes: Record<string, TranslationChoice>,
    outputRoutes: Record<string, TranslationChoice>,
  ) => change(() => commit(routePreparedWords(doc, defaultChoice, groupRoutes, outputRoutes, from)));
  const shown = doc.groups.flatMap((group) => group.slides).find((slide) => slide.id === preview);
  const rendered = shown ? renderEditedSlide(doc, shown) : null;
  const checked = rows.filter(({ element }) =>
    element.translations?.some(
      (item) =>
        item.targetLanguage === to &&
        translationForSource(item, translationSource(element)).state === 'checked',
    ),
  ).length;
  const layout = (el: TextElement, display: TranslationDisplay) => {
    const row = rows.find((item) => item.element.id === el.id);
    if (row) change(() => commit(placePreparedWords(doc, row.slide.id, el.id, display)));
  };
  return (
    <Dialog title="Translation" onClose={onClose} size="lg" footer={<Button onClick={onClose}>Done</Button>}>
      <div className="space-y-4" data-testid="translation-dialog">
        <Notice>
          {engine?.available
            ? engine.message
            : `${noTranslator.status}. ${engine ? `${engine.message} ` : ''}Write translations by hand, then have a reader check their meaning, names, numbers and fit.`}{' '}
          Only checked words can show.
        </Notice>
        {readOnly && (
          <p role="status">
            Simple Mode shows saved checked translations. Use Pro Mode to change or check them.
          </p>
        )}
        {problem && <Notice tone="danger">{problem}</Notice>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Source language">
            <Select
              value={from}
              disabled={readOnly}
              onChange={(event) => setFrom(language(event.target.value))}
            >
              {languages.map((lang) => (
                <option key={lang} value={lang}>
                  {LANG_NAMES[lang]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Target language">
            <Select value={to} disabled={readOnly} onChange={(event) => setTo(language(event.target.value))}>
              {languages.map((lang) => (
                <option key={lang} value={lang}>
                  {LANG_NAMES[lang]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reader name">
            <Input
              value={reader}
              maxLength={120}
              disabled={readOnly}
              onChange={(event) => setReader(event.target.value)}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={readOnly || !engine?.available || preparing !== null || drafts === 0}
            title={engine?.available ? undefined : (engine?.message ?? noTranslator.status)}
            onClick={() => void prepare()}
          >
            Prepare translations
          </Button>
          {preparing && (
            <>
              <p role="status">
                Preparing drafts: {preparing.done} of {preparing.total} text boxes
              </p>
              <Button onClick={stopPreparing}>Stop</Button>
            </>
          )}
        </div>
        <p role="status">
          {checked} of {rows.length} text boxes checked for {LANG_NAMES[to]}. Changes stay in Edit slides
          until you save.
        </p>
        <details>
          <summary className="cursor-pointer py-2 text-sm font-medium">
            Where checked translations show
          </summary>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted">
              Original words stay in place. A screen may show another saved checked language even when the
              presentation choice is Off. A missing checked language leaves only the original.
            </p>
            <Field label="Presentation translation">
              <Select
                value={route?.choice ?? 'off'}
                disabled={readOnly}
                onChange={(event) =>
                  routeChange(choice(event.target.value), route?.groups ?? {}, route?.outputs ?? {})
                }
              >
                <Choices />
              </Select>
            </Field>
            {groups.map((group) => (
              <div key={group.id} className="space-y-2 rounded border border-line p-2">
                <Field label={`${group.name} translation`}>
                  <Select
                    value={route?.groups[group.id] ?? ''}
                    disabled={readOnly}
                    onChange={(event) => {
                      const next = Object.fromEntries(
                        Object.entries(route?.groups ?? {}).filter(([id]) => id !== group.id),
                      );
                      if (event.target.value !== '') next[group.id] = choice(event.target.value);
                      routeChange(route?.choice ?? 'off', next, route?.outputs ?? {});
                    }}
                  >
                    <Choices inherit />
                  </Select>
                </Field>
                {group.screens.map((screen) => (
                  <Field key={screen.id} label={`${screen.name} translation`}>
                    <Select
                      value={route?.outputs[screen.id] ?? ''}
                      disabled={readOnly}
                      onChange={(event) => {
                        const next = Object.fromEntries(
                          Object.entries(route?.outputs ?? {}).filter(([id]) => id !== screen.id),
                        );
                        if (event.target.value !== '') next[screen.id] = choice(event.target.value);
                        routeChange(route?.choice ?? 'off', route?.groups ?? {}, next);
                      }}
                    >
                      <Choices inherit />
                    </Select>
                  </Field>
                ))}
              </div>
            ))}
          </div>
        </details>
        {rows.length === 0 && (
          <p>
            No editable slide text boxes. Imported pages, pictures, movies and mixed-language text need
            separately authored text boxes.
          </p>
        )}
        {rows.map(({ slide, element }, index) => {
          const source = translationSource(element);
          const value = element.translations?.find((item) => item.targetLanguage === to);
          const current = value ? translationForSource(value, source) : null;
          const supported = from !== to && translationSourceSupported(element, from);
          const display =
            element.translationDisplay ?? defaultTranslationDisplay(element, rendered?.height ?? doc.height);
          const slideView = renderEditedSlide(doc, slide);
          const warning = current?.text ? translationLayoutProblem(slideView, element, current.text) : null;
          return (
            <section
              key={`${slide.id}:${element.id}`}
              className="space-y-2 rounded-lg border border-line p-3"
            >
              <h3 className="text-sm font-medium">{slide.label || `Slide ${index + 1}`}</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs text-muted">Source words</p>
                  <p lang={from} className="whitespace-pre-wrap break-words" style={{ lineHeight: 1.45 }}>
                    {source}
                  </p>
                </div>
                <Field label="Translation words">
                  <Textarea
                    lang={to}
                    value={value?.text ?? ''}
                    maxLength={20_000}
                    rows={3}
                    disabled={readOnly || !supported}
                    style={{ lineHeight: 1.45 }}
                    onChange={(event) =>
                      change(() =>
                        commit(editPreparedWords(doc, slide.id, element.id, from, to, event.target.value), {
                          coalesce: `translation:${slide.id}:${element.id}:${to}`,
                        }),
                      )
                    }
                  />
                </Field>
              </div>
              {!supported && (
                <p className="text-sm text-muted">
                  Choose this box’s source language and another target. Split mixed-language words into
                  separate boxes first.
                </p>
              )}
              <p role="status" data-testid="translation-review-state" className="text-sm">
                {current?.state === 'checked'
                  ? `Checked by ${current.reader ?? ''}`
                  : current?.state === 'needs-recheck'
                    ? 'Needs re-check: source words changed'
                    : 'Unchecked'}
              </p>
              {warning && (
                <p role="status" className="text-sm text-muted">
                  {warning} This translation will stay hidden until its area fits.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={readOnly || !supported || !reader.trim() || !value?.text.trim() || !!warning}
                  onClick={() =>
                    change(() => commit(approvePreparedWords(doc, slide.id, element.id, from, to, reader)))
                  }
                >
                  Mark checked
                </Button>
                <Button onClick={() => setPreview(slide.id)}>Preview this slide</Button>
              </div>
              <details>
                <summary className="cursor-pointer py-2 text-xs">Reserved translation area</summary>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {(['x', 'y', 'width', 'height'] as const).map((key) => (
                    <Field key={key} label={`Translation ${key}`}>
                      <Input
                        type="number"
                        value={display.area[key]}
                        disabled={readOnly}
                        onChange={(event) => {
                          const number = Number(event.target.value);
                          if (Number.isFinite(number))
                            layout(element, { ...display, area: { ...display.area, [key]: number } });
                        }}
                      />
                    </Field>
                  ))}
                  <Field label="Translation size">
                    <Input
                      type="number"
                      value={display.fontSize}
                      min={1}
                      max={1000}
                      disabled={readOnly}
                      onChange={(event) => {
                        const number = Number(event.target.value);
                        if (number > 0 && number <= 1000) layout(element, { ...display, fontSize: number });
                      }}
                    />
                  </Field>
                </div>
              </details>
            </section>
          );
        })}
        {shown && <TranslationPreview doc={doc} slide={shown} groups={groups} />}
      </div>
    </Dialog>
  );
}
