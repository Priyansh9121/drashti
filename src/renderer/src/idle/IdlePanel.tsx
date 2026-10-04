import { useEffect, useMemo, useState } from 'react';
import type { IdleSettings, Quote, QuoteFields, QuoteLang } from '../../../shared/idle';
import {
  IDLE_SECONDS_MAX,
  IDLE_SECONDS_MIN,
  IDLE_WHEN_NAMES,
  QUOTE_LANG_NAMES,
  QUOTE_LANGS,
} from '../../../shared/idle';
import { useEngine } from '../engine/engine-store';
import { loadMedia, useMedia } from '../library/library-store';
import { dispatch } from '../operator/actions';
import { MediaStill } from '../render/MediaStill';
import { useScreens } from '../screens/screens-store';
import { Badge } from '../ui/Badge';
import { Button, IconButton } from '../ui/Button';
import { ConfirmDialog, Dialog } from '../ui/Dialog';
import { Field, NumberInput, Textarea, TextInput } from '../ui/Field';
import { ArrowDown, ArrowUp, GalleryHorizontalEnd, Pencil, Play, Plus, Square, Trash2 } from '../ui/icons';
import { Panel, SectionTitle } from '../ui/Panel';
import { Checkbox } from '../ui/Toggle';
import { Truncate } from '../ui/Truncate';
import { connectIdle, openIdle, useIdle } from './idle-store';

/*
 * The idle rotation in the live column: Start and Stop, where it shows (from
 * the live Look), and Set up… for its pictures, timing and quotes (Pro
 * Mode). Once started it stops by itself when a slide or a picture goes up.
 */

export function IdlePanel() {
  const running = useEngine((s) => s.state?.idle.startedAt != null);
  const items = useEngine((s) => s.state?.idle.items.length ?? 0);
  const look = useEngine((s) => s.state?.look ?? null);
  const groups = useScreens((s) => s.snapshot?.groups ?? []);
  const view = useIdle((s) => s.view);
  useEffect(() => {
    connectIdle();
  }, []);
  const where = groups.flatMap((g) => {
    const when = look?.groups[g.id]?.idle ?? 'off';
    return when === 'off' ? [] : [`${g.name} (${when === 'always' ? 'always' : 'once started'})`];
  });
  const settings = view?.settings;
  return (
    <Panel
      title="Idle rotation"
      icon={GalleryHorizontalEnd}
      collapsible
      remember="idle"
      bodyClassName="space-y-2 px-3 pb-3"
      data-testid="idle-panel"
      actions={
        <Button variant="ghost" size="sm" icon={Pencil} data-testid="open-idle" onClick={() => openIdle()}>
          Set up
        </Button>
      }
    >
      <div className="flex items-center gap-2">
        {running ? (
          <Button
            variant="live"
            size="sm"
            icon={Square}
            data-testid="idle-stop"
            onClick={() => void dispatch({ type: 'stopIdle' })}
          >
            Stop
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            icon={Play}
            data-testid="idle-start"
            disabled={items === 0}
            onClick={() => void dispatch({ type: 'startIdle' })}
          >
            Start
          </Button>
        )}
        <p className="min-w-0 flex-1 text-xs text-muted" data-testid="idle-state">
          {running
            ? 'Running: it stops by itself when a slide or picture goes up.'
            : items === 0
              ? 'Nothing to show yet: Set up chooses pictures and quotes.'
              : 'Stopped.'}
        </p>
      </div>
      {settings && (
        <p className="text-xs text-muted">
          {`${String(settings.pictures.length)} picture${settings.pictures.length === 1 ? '' : 's'}`}
          {settings.quoteOfTheDay ? ', then the quote of the day' : ''}
          {` · ${String(settings.secondsEach)} s each`}
        </p>
      )}
      <p className="text-xs text-muted" data-testid="idle-where">
        {where.length > 0
          ? `Shows when nothing is up on: ${where.join(', ')}.`
          : 'No screens show it: choose “When nothing is up” in a group’s Look (Screens).'}
      </p>
      <IdleDialog />
    </Panel>
  );
}

const NO_WORDS: Record<QuoteLang, string> = { gu: '', hi: '', en: '' };

function QuoteForm({ quote, onDone }: { quote: Quote | null; onDone: () => void }) {
  const [words, setWords] = useState<Record<QuoteLang, string>>({ ...NO_WORDS, ...quote?.words });
  const [attribution, setAttribution] = useState(quote?.attribution ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    const given: QuoteFields['words'] = {};
    for (const l of QUOTE_LANGS) if (words[l].trim() !== '') given[l] = words[l];
    const result = await window.drashti.idle.saveQuote(quote?.id ?? null, { words: given, attribution });
    if (result.ok) onDone();
    else setProblem(result.message);
  };
  return (
    <form
      data-testid="quote-form"
      className="space-y-2 rounded-lg border border-accent/60 bg-panel-2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {QUOTE_LANGS.map((l) => (
        <Field key={l} label={QUOTE_LANG_NAMES[l]}>
          <Textarea
            lang={l}
            rows={2}
            maxLength={600}
            data-testid={`quote-${l}`}
            value={words[l]}
            onChange={(e) => {
              setWords((w) => ({ ...w, [l]: e.target.value }));
              setProblem(null);
            }}
          />
        </Field>
      ))}
      <Field label="Attribution (who said or wrote it)">
        <TextInput
          maxLength={120}
          data-testid="quote-attribution"
          value={attribution}
          onChange={(e) => setAttribution(e.target.value)}
        />
      </Field>
      {problem && (
        <p role="alert" className="text-xs text-danger-fg">
          {problem}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" data-testid="save-quote">
          Save the quote
        </Button>
        <Button size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

const firstWords = (q: Quote) => QUOTE_LANGS.map((l) => q.words[l]).find((w) => w !== undefined) ?? '';

/** The pictures, timing and quotes (Pro Mode). */
function IdleDialog() {
  const open = useIdle((s) => s.open);
  const loaded = useIdle((s) => s.view !== null);
  if (!open || !loaded) return null;
  return <IdleForm />;
}

function IdleForm() {
  const view = useIdle((s) => s.view);
  const media = useMedia((s) => s.media);
  // A copy to change, saved as one (the dialog opens once the settings are read).
  const [settings, setSettings] = useState<IdleSettings | null>(
    () => useIdle.getState().view?.settings ?? null,
  );
  const [editing, setEditing] = useState<Quote | 'new' | null>(null);
  const [removing, setRemoving] = useState<Quote | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    void loadMedia();
  }, []);
  const pictures = useMemo(
    () => media.filter((m) => m.kind === 'image' && !m.missing && m.unplayable === null),
    [media],
  );
  const close = () => {
    openIdle(false);
  };
  if (!settings || !view) return null;
  const chosen = settings.pictures;
  const set = (patch: Partial<IdleSettings>) => {
    setSettings({ ...settings, ...patch });
    setProblem(null);
  };
  const move = (id: string, by: -1 | 1) => {
    const at = chosen.indexOf(id);
    const to = at + by;
    if (at < 0 || to < 0 || to >= chosen.length) return;
    const next = [...chosen];
    [next[at], next[to]] = [next[to] ?? id, id];
    set({ pictures: next });
  };
  const save = async () => {
    const result = await window.drashti.idle.saveSettings(settings);
    if (result.ok) close();
    else setProblem(result.message);
  };
  const nameOf = (id: string) =>
    pictures.find((p) => p.id === id)?.name ?? view.pictures.find((p) => p.mediaId === id)?.name;
  return (
    <Dialog
      title="Idle rotation"
      subtitle="Darshan pictures from the media library and quotes, each up for a time, dissolving into the next. Use only pictures and quotes the mandir has authorised."
      onClose={close}
      closeLabel="Close the idle rotation"
      size="lg"
      testId="idle-dialog"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" data-testid="save-idle" onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <section className="space-y-2" aria-labelledby="idle-pictures-title">
          <SectionTitle>
            <span id="idle-pictures-title">Pictures, in order</span>
          </SectionTitle>
          {chosen.length > 0 ? (
            <ol className="space-y-1" data-testid="idle-chosen">
              {chosen.map((id, i) => (
                <li key={id} className="flex items-center gap-2 rounded-md bg-panel-2 px-2 py-1 text-sm">
                  <span className="w-5 text-right text-xs text-muted tabular-nums">{i + 1}</span>
                  <Truncate
                    text={nameOf(id) ?? 'A picture no longer in the library'}
                    className="min-w-0 flex-1"
                  />
                  <IconButton
                    icon={ArrowUp}
                    size="sm"
                    label={`Earlier: ${nameOf(id) ?? ''}`}
                    onClick={() => move(id, -1)}
                  />
                  <IconButton
                    icon={ArrowDown}
                    size="sm"
                    label={`Later: ${nameOf(id) ?? ''}`}
                    onClick={() => move(id, 1)}
                  />
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-xs text-muted">None chosen yet: tick pictures below.</p>
          )}
          <div
            role="group"
            aria-label="Pictures in the media library"
            className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto"
          >
            {pictures.map((p) => (
              <label
                key={p.id}
                data-testid="idle-picture"
                className="flex items-center gap-2 rounded-md border border-line bg-panel-2 p-1.5 text-xs"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-accent-strong"
                  checked={chosen.includes(p.id)}
                  onChange={(e) => {
                    set({
                      pictures: e.target.checked ? [...chosen, p.id] : chosen.filter((x) => x !== p.id),
                    });
                  }}
                />
                <span className="relative h-9 w-16 shrink-0 overflow-hidden rounded-sm bg-black">
                  <MediaStill mediaId={p.id} media="image" />
                </span>
                <Truncate text={p.name} className="min-w-0 flex-1" />
              </label>
            ))}
            {pictures.length === 0 && (
              <p className="col-span-3 text-xs text-muted">
                No pictures in the media library: import some first.
              </p>
            )}
          </div>
        </section>
        <section className="flex flex-wrap items-end gap-4">
          <Field label="Each up for">
            <NumberInput
              unit="seconds"
              min={IDLE_SECONDS_MIN}
              max={IDLE_SECONDS_MAX}
              data-testid="idle-seconds"
              value={settings.secondsEach}
              onChange={(e) => set({ secondsEach: Math.round(Number(e.target.value) || IDLE_SECONDS_MIN) })}
            />
          </Field>
          <Checkbox
            label="Then the quote of the day"
            data-testid="idle-quote-of-the-day"
            checked={settings.quoteOfTheDay}
            onChange={(e) => set({ quoteOfTheDay: e.target.checked })}
          />
        </section>
        {problem && (
          <p role="alert" className="text-sm text-danger-fg">
            {problem}
          </p>
        )}
        <section className="space-y-2" aria-labelledby="idle-quotes-title">
          <div className="flex items-center gap-2">
            <SectionTitle className="flex-1">
              <span id="idle-quotes-title">Quotes ({view.quotes.length})</span>
            </SectionTitle>
            <Button size="sm" icon={Plus} data-testid="add-quote" onClick={() => setEditing('new')}>
              Add a quote
            </Button>
          </div>
          <p className="text-xs text-muted" data-testid="quote-of-the-day">
            {view.quoteOfTheDay
              ? `Today’s: “${firstWords(view.quoteOfTheDay)}” (one each day, the same all day; a stage layout can show it too).`
              : 'No quotes yet: the quote of the day is one of them, a different one each day.'}
          </p>
          {editing === 'new' && <QuoteForm quote={null} onDone={() => setEditing(null)} />}
          <ul className="space-y-1" data-testid="quote-list">
            {view.quotes.map((q) =>
              editing !== 'new' && editing?.id === q.id ? (
                <li key={q.id}>
                  <QuoteForm quote={q} onDone={() => setEditing(null)} />
                </li>
              ) : (
                <li
                  key={q.id}
                  data-testid="quote-row"
                  className="flex items-center gap-2 rounded-md bg-panel-2 px-2 py-1 text-sm"
                >
                  <span className="min-w-0 flex-1">
                    <Truncate text={firstWords(q)} />
                    {q.attribution !== '' && (
                      <span className="block text-xs text-muted">— {q.attribution}</span>
                    )}
                  </span>
                  {QUOTE_LANGS.filter((l) => q.words[l] !== undefined).map((l) => (
                    <Badge key={l}>{l.toUpperCase()}</Badge>
                  ))}
                  <IconButton icon={Pencil} size="sm" label="Edit this quote" onClick={() => setEditing(q)} />
                  <IconButton
                    icon={Trash2}
                    size="sm"
                    label="Remove this quote"
                    onClick={() => setRemoving(q)}
                  />
                </li>
              ),
            )}
          </ul>
        </section>
        <p className="text-xs text-muted">
          Which screens show it is set in each group&apos;s Look (Screens): <em>{IDLE_WHEN_NAMES.started}</em>{' '}
          or <em>{IDLE_WHEN_NAMES.always}</em>.
        </p>
      </div>
      {removing && (
        <ConfirmDialog
          title="Remove this quote?"
          confirmLabel="Remove"
          testId="quote-remove-confirm"
          onConfirm={() => {
            void window.drashti.idle.removeQuote(removing.id).then((r) => {
              setRemoving(null);
              if (!r.ok) setProblem(r.message);
            });
          }}
          onCancel={() => setRemoving(null)}
        >
          “{firstWords(removing)}” leaves the list (and the quote of the day, if it is today’s).
        </ConfirmDialog>
      )}
    </Dialog>
  );
}
