import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Transition } from '../../../shared/model';
import { CUT } from '../../../shared/model';
import type { EditDoc, EditSlide } from '../../../shared/slide-edit';
import { slidesOf } from '../../../shared/slide-edit';
import { useMedia } from '../library/library-store';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { radioKeys, radioTabIndex } from '../ui/radio';
import { ColorInput, Field, NumberInput, Select, Slider, Textarea, TextInput } from '../ui/Field';
import { Check, Music, Palette, Trash2, X } from '../ui/icons';
import { Toggle } from '../ui/Toggle';
import { ConfirmDialog } from '../ui/Dialog';
import { commit, select, tell, useEditor } from './editor-store';
import { MediaPicker } from './MediaPicker';
import { connectMacros, useMacros } from '../macros/macros-store';
import type { EditCue } from '../../../shared/slide-edit';
import {
  addGroup,
  applyLookToAll,
  changeGroup,
  changeSlide,
  cueSettings,
  findSlide,
  GROUP_COLORS,
  mapSlide,
  placeSlide,
  removeGroup,
  setBackgroundCue,
  setSoundCue,
} from './ops';

/*
 * The slide panel: what the inspector shows when nothing on the slide is
 * selected. The slide itself (label, group, colour, hidden, notes), its
 * background picture or video and its sound, how it comes on and moves on,
 * its group, and the presentation's transition and loop.
 */

function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section className="space-y-2 border-b border-line px-3 py-3" aria-label={title} data-testid={testId}>
      <h3 className="text-2xs font-bold tracking-wider text-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

/** Seconds as typed, kept as milliseconds. */
function Seconds({
  label,
  ms,
  onChange,
  min,
  max,
  testId,
}: {
  label: string;
  ms: number;
  onChange: (ms: number) => void;
  min: number;
  max: number;
  testId?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Field label={label} layout="inline">
      <NumberInput
        unit="s"
        min={min}
        max={max}
        step={0.1}
        data-testid={testId}
        value={draft ?? String(Math.round(ms / 100) / 10)}
        onFocus={() => {
          setDraft(String(Math.round(ms / 100) / 10));
        }}
        onBlur={() => {
          setDraft(null);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isFinite(n))
            onChange(Math.round(Math.min(max, Math.max(min, n)) * 1000));
        }}
      />
    </Field>
  );
}

const DISSOLVE: Transition = { kind: 'dissolve', durationMs: 800 };

/** A transition: one of the choices, with a length for a dissolve. `none` is "as the default". */
function TransitionField({
  label,
  value,
  noneLabel,
  onChange,
  testId,
}: {
  label: string;
  value: Transition | null;
  noneLabel: string | null;
  onChange: (t: Transition | null) => void;
  testId: string;
}) {
  const choice = value === null ? 'none' : value.kind;
  return (
    <div className="space-y-2">
      <Field label={label}>
        <Select
          className="w-full"
          data-testid={testId}
          value={choice}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === 'none' ? null : v === 'cut' ? CUT : value?.kind === 'dissolve' ? value : DISSOLVE);
          }}
        >
          {noneLabel !== null && <option value="none">{noneLabel}</option>}
          <option value="cut">Cut (at once)</option>
          <option value="dissolve">Dissolve</option>
        </Select>
      </Field>
      {value?.kind === 'dissolve' && (
        <div className="pl-2">
          <Seconds
            label="Taking"
            ms={value.durationMs}
            min={0.1}
            max={10}
            testId={`${testId}-seconds`}
            onChange={(durationMs) => {
              onChange({ kind: 'dissolve', durationMs });
            }}
          />
        </div>
      )}
    </div>
  );
}

const describe = (t: Transition) => (t.kind === 'cut' ? 'a cut' : `a dissolve of ${t.durationMs / 1000} s`);

/** What Drashti does for presentations without a transition of their own (a setting, saved at once). */
function useDefaultTransition(): [Transition | null, (t: Transition) => void] {
  const [value, setValue] = useState<Transition | null>(null);
  useEffect(() => {
    void window.drashti.library.getDefaultTransition().then(setValue);
  }, []);
  const set = (t: Transition) => {
    void window.drashti.library.setDefaultTransition(t).then((r) => {
      if (r.ok) setValue(r.transition);
      else tell(r.message);
    });
  };
  return [value, set];
}

/** A macro the slide runs when it goes up (in the same change; not in Simple Mode). */
function MacroCue({ value, onChange }: { value: string | null; onChange: (macroId: string | null) => void }) {
  const macros = useMacros((s) => s.macros);
  useEffect(() => {
    connectMacros();
  }, []);
  return (
    <Field
      label="When it goes up, run"
      hint="A macro runs with the slide, as one change (never in Simple Mode)."
    >
      <Select
        data-testid="slide-macro"
        value={value ?? ''}
        onChange={(e) => {
          onChange(e.target.value === '' ? null : e.target.value);
        }}
      >
        <option value="">No macro</option>
        {value !== null && !(macros ?? []).some((m) => m.id === value) && (
          <option value={value}>A macro that is gone</option>
        )}
        {(macros ?? []).map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function SlidePanel({ doc, slide }: { doc: EditDoc; slide: EditSlide }) {
  const group = doc.groups.find((g) => g.slides.some((s) => s.id === slide.id));
  const media = useMedia((s) => s.media);
  const [picking, setPicking] = useState<'background' | 'sound' | null>(null);
  const [askLook, setAskLook] = useState(false);
  const [appDefault, setAppDefault] = useDefaultTransition();
  const number = slidesOf(doc).findIndex((s) => s.id === slide.id) + 1;
  const background = slide.cues.find((c) => c.kind === 'background' && c.mediaId);
  const sound = slide.cues.find((c) => c.kind === 'audio' && c.mediaId);
  const others = slide.cues.filter((c) => c !== background && c !== sound);
  const nameOf = (cue: EditCue | undefined) => {
    const label = cue?.label ?? '';
    return (
      media.find((m) => m.id === cue?.mediaId)?.name ?? (label !== '' ? label : 'A file from the library')
    );
  };

  const change = (fn: (d: EditDoc) => EditDoc, coalesce?: string) => {
    const now = useEditor.getState().doc;
    if (now) commit(fn(now), coalesce ? { coalesce } : {});
  };
  const setSlide = (patch: Parameters<typeof changeSlide>[2], coalesce?: string) => {
    change((d) => changeSlide(d, slide.id, patch), coalesce);
  };

  return (
    <div data-testid="slide-panel">
      <Section title={`Slide ${number}`} testId="slide-section">
        <Field label="Label" layout="inline">
          <TextInput
            className="flex-1"
            data-testid="slide-label"
            placeholder="For example Opening"
            maxLength={200}
            value={slide.label}
            onChange={(e) => {
              setSlide({ label: e.target.value }, `label:${slide.id}`);
            }}
          />
        </Field>
        <Field label="Group" layout="inline">
          <Select
            className="flex-1"
            data-testid="slide-group-choice"
            value={group?.id ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              change((d) => {
                const s = findSlide(d, slide.id);
                if (!s) return d;
                if (v !== 'new') return placeSlide(d, s, v, Number.MAX_SAFE_INTEGER);
                // A new group with this slide in it (the blank slide it comes with is not wanted).
                const made = addGroup(d, 'New group', null);
                const last = made.doc.groups.at(-1);
                if (!last) return d;
                const emptied = {
                  ...made.doc,
                  groups: made.doc.groups.map((g) => (g.id === last.id ? { ...g, slides: [] } : g)),
                };
                return placeSlide(emptied, s, last.id, 0);
              });
            }}
          >
            {doc.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name || 'No name'}
              </option>
            ))}
            <option value="new">A new group…</option>
          </Select>
        </Field>
        <Toggle
          label="Hidden in the show"
          checked={!slide.enabled}
          data-testid="slide-hidden"
          onChange={(hidden) => {
            setSlide({ enabled: !hidden });
          }}
        />
        <Toggle
          label="A colour behind it"
          checked={slide.background !== null}
          data-testid="slide-color-on"
          onChange={(on) => {
            setSlide({ background: on ? '#000000' : null });
          }}
        />
        {slide.background !== null && (
          <Field label="Colour" layout="inline" className="pl-2">
            <ColorInput
              data-testid="slide-color"
              value={slide.background.slice(0, 7)}
              onChange={(e) => {
                setSlide({ background: e.target.value }, `background:${slide.id}`);
              }}
            />
          </Field>
        )}
      </Section>

      {group && (
        <Section title="Group" testId="group-section">
          <Field label="Name" layout="inline">
            <TextInput
              className="flex-1"
              data-testid="group-name"
              maxLength={200}
              value={group.name}
              onChange={(e) => {
                change((d) => changeGroup(d, group.id, { name: e.target.value }), `group:${group.id}`);
              }}
            />
          </Field>
          <div
            role="radiogroup"
            aria-label="Group colour"
            className="flex flex-wrap items-center gap-1.5"
            onKeyDown={radioKeys<string | null>([null, ...GROUP_COLORS], group.color, (c) => {
              change((d) => changeGroup(d, group.id, { color: c }));
            })}
          >
            {[null, ...GROUP_COLORS].map((c, i) => (
              <button
                key={c ?? 'none'}
                type="button"
                role="radio"
                aria-checked={group.color === c}
                tabIndex={radioTabIndex(
                  group.color === c,
                  i,
                  [null, ...GROUP_COLORS].some((x) => x === group.color),
                )}
                aria-label={c ? `Colour ${c}` : 'No colour'}
                data-testid="group-color-choice"
                onClick={() => {
                  change((d) => changeGroup(d, group.id, { color: c }));
                }}
                className={cx(
                  'flex h-7 w-7 items-center justify-center rounded-md border-2',
                  group.color === c ? 'border-fg' : 'border-line-strong',
                )}
                style={{ background: c ?? 'transparent' }}
              >
                {group.color === c && (
                  <Check size={14} aria-hidden="true" className={c ? 'text-white' : 'text-fg'} />
                )}
                {c === null && group.color !== c && <X size={14} aria-hidden="true" className="text-muted" />}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            variant="danger"
            icon={Trash2}
            disabled={doc.groups.length < 2}
            onClick={() => {
              change((d) => removeGroup(d, group.id));
              const left = doc.groups.find((g) => g.id !== group.id)?.slides[0];
              if (left) useEditor.setState({ slideId: left.id, selection: [] });
            }}
          >
            Delete this group and its slides
          </Button>
        </Section>
      )}

      <Section title="Behind it and with it" testId="cues-section">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-sm">
            {background ? (
              <span data-testid="background-cue">Background: {nameOf(background)}</span>
            ) : (
              <span className="text-muted">No background picture or video</span>
            )}
          </span>
          <Button size="sm" onClick={() => setPicking('background')} data-testid="choose-background">
            {background ? 'Change' : 'Choose'}
          </Button>
          {background && (
            <Button
              size="sm"
              variant="ghost"
              aria-label="Remove the background"
              onClick={() => {
                change((d) => mapSlide(d, slide.id, (s) => setBackgroundCue(s, null)));
              }}
            >
              Remove
            </Button>
          )}
        </div>
        {background && (
          <BackgroundSettings
            cue={background}
            kind={media.find((m) => m.id === background.mediaId)?.kind}
            onChange={(fit, loop) => {
              const settings = cueSettings(background);
              const kind = settings.media ?? 'image';
              change((d) =>
                mapSlide(d, slide.id, (s) =>
                  setBackgroundCue(s, { id: background.mediaId ?? '', kind, fit, loop }),
                ),
              );
            }}
          />
        )}
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-sm">
            {sound ? (
              <span data-testid="sound-cue">
                <Music size={14} aria-hidden="true" className="mr-1 inline" />
                {nameOf(sound)}
              </span>
            ) : (
              <span className="text-muted">No sound</span>
            )}
          </span>
          <Button size="sm" onClick={() => setPicking('sound')} data-testid="choose-sound">
            {sound ? 'Change' : 'Choose'}
          </Button>
          {sound && (
            <Button
              size="sm"
              variant="ghost"
              aria-label="Remove the sound"
              onClick={() => {
                change((d) => mapSlide(d, slide.id, (s) => setSoundCue(s, null)));
              }}
            >
              Remove
            </Button>
          )}
        </div>
        {sound && (
          <SoundSettings
            cue={sound}
            onChange={(volume, loop, coalesce) => {
              change(
                (d) =>
                  mapSlide(d, slide.id, (s) => setSoundCue(s, { id: sound.mediaId ?? '', volume, loop })),
                coalesce,
              );
            }}
          />
        )}
        {others.length > 0 && (
          <p className="text-xs text-faint">
            Also on this slide, kept as they are: {others.map((c) => c.label || c.kind).join(', ')}.
          </p>
        )}
      </Section>

      <Section title="Notes" testId="notes-section">
        <Textarea
          aria-label="Notes, shown on the stage screens"
          data-testid="slide-notes"
          className="min-h-20 w-full text-sm"
          placeholder="Shown on the stage screens while this slide is up"
          maxLength={20_000}
          value={slide.notes}
          onChange={(e) => {
            setSlide({ notes: e.target.value }, `notes:${slide.id}`);
          }}
        />
      </Section>

      <Section title="Coming on and moving on" testId="timing-section">
        <TransitionField
          label="Comes on with"
          testId="slide-transition"
          value={slide.transition}
          noneLabel={`The presentation’s (${describe(doc.transition ?? appDefault ?? CUT)})`}
          onChange={(transition) => {
            setSlide({ transition }, `transition:${slide.id}`);
          }}
        />
        <Toggle
          label="Moves on by itself"
          checked={slide.autoAdvanceMs !== null}
          data-testid="slide-auto"
          onChange={(on) => {
            setSlide({ autoAdvanceMs: on ? 5000 : null });
          }}
        />
        {slide.autoAdvanceMs !== null && (
          <div className="pl-2">
            <Seconds
              label="After"
              ms={slide.autoAdvanceMs}
              min={0.5}
              max={3600}
              testId="slide-auto-seconds"
              onChange={(autoAdvanceMs) => {
                setSlide({ autoAdvanceMs }, `auto:${slide.id}`);
              }}
            />
          </div>
        )}
        <MacroCue
          value={slide.macroId}
          onChange={(macroId) => {
            setSlide({ macroId });
          }}
        />
      </Section>

      <Section title="The presentation" testId="presentation-section">
        <TransitionField
          label="Slides come on with"
          testId="presentation-transition"
          value={doc.transition}
          noneLabel={`Drashti’s default (${describe(appDefault ?? CUT)})`}
          onChange={(transition) => {
            change((d) => ({ ...d, transition }), 'presentation-transition');
          }}
        />
        <Toggle
          label="Loop back to the first slide"
          checked={doc.loop}
          data-testid="presentation-loop"
          onChange={(loop) => {
            change((d) => ({ ...d, loop }));
          }}
        />
        <p className="text-xs text-faint">
          When slides move on by themselves, the first comes again after the last (otherwise the last stays
          up).
        </p>
        <div className="flex flex-col items-start gap-2 pt-1">
          <Button size="sm" onClick={() => setAskLook(true)} data-testid="apply-look">
            Give every slide this slide’s look
          </Button>
          <Button
            size="sm"
            icon={Palette}
            data-testid="theme-from-slide"
            onClick={() => {
              const name = `${doc.name.slice(0, 60)}: ${slide.label || `slide ${number}`}`.slice(0, 80);
              void window.drashti.themes
                .fromSlide(name, {
                  width: doc.width,
                  height: doc.height,
                  background: slide.background,
                  elements: slide.elements,
                  cues: slide.cues,
                })
                .then((r) => {
                  tell(r.ok ? `Made the theme “${name}”. It is in Themes.` : r.message);
                });
            }}
          >
            Make a theme from this slide
          </Button>
        </div>
      </Section>

      <Section title="For every presentation" testId="app-section">
        {appDefault && (
          <TransitionField
            label="Drashti’s default"
            testId="app-transition"
            value={appDefault}
            noneLabel={null}
            onChange={(t) => {
              if (t) setAppDefault(t);
            }}
          />
        )}
        <p className="text-xs text-faint">
          For presentations without a transition of their own. It changes at once, without saving.
        </p>
      </Section>

      {picking && (
        <MediaPicker
          title={
            picking === 'sound' ? 'A sound for this slide' : 'A background picture or video for this slide'
          }
          sounds={picking === 'sound'}
          onClose={() => {
            setPicking(null);
          }}
          onChoose={(m) => {
            const which = picking;
            setPicking(null);
            change((d) =>
              mapSlide(d, slide.id, (s) =>
                which === 'sound'
                  ? setSoundCue(s, { id: m.id, volume: 1, loop: false })
                  : m.kind === 'audio'
                    ? s
                    : setBackgroundCue(s, { id: m.id, kind: m.kind, fit: 'fill', loop: m.kind === 'video' }),
              ),
            );
          }}
        />
      )}
      {askLook && (
        <ConfirmDialog
          title="Give every slide this look?"
          confirmLabel="Give them this look"
          confirmVariant="primary"
          testId="apply-look-confirm"
          onCancel={() => {
            setAskLook(false);
          }}
          onConfirm={() => {
            setAskLook(false);
            change((d) => applyLookToAll(d, slide.id));
            select([]);
            tell(
              'Every slide has this slide’s look now. Undo takes it back; nothing is saved until you save.',
            );
          }}
        >
          <p>
            Every other slide takes this slide’s colour, its shapes, and the place and style of its words
            (each language in its look here). Their words stay as they are.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function BackgroundSettings({
  cue,
  kind,
  onChange,
}: {
  cue: EditCue;
  kind: string | undefined;
  onChange: (fit: 'fit' | 'fill' | 'stretch', loop: boolean) => void;
}) {
  const s = cueSettings(cue);
  const fit = s.fit ?? 'fit';
  const loop = s.loop === true;
  return (
    <div className="space-y-2 pl-2">
      <Field label="Fit" layout="inline">
        <Select
          className="flex-1"
          data-testid="background-fit"
          value={fit}
          onChange={(e) => {
            onChange(e.target.value as 'fit' | 'fill' | 'stretch', loop);
          }}
        >
          <option value="fit">Fit inside</option>
          <option value="fill">Fill the screen</option>
          <option value="stretch">Stretch</option>
        </Select>
      </Field>
      {(kind === 'video' || s.media === 'video') && (
        <Toggle
          label="Loop the video"
          checked={loop}
          onChange={(on) => {
            onChange(fit, on);
          }}
        />
      )}
    </div>
  );
}

function SoundSettings({
  cue,
  onChange,
}: {
  cue: EditCue;
  onChange: (volume: number, loop: boolean, coalesce?: string) => void;
}) {
  const s = cueSettings(cue);
  const volume = typeof s.volume === 'number' ? s.volume : 1;
  const loop = s.loop === true;
  return (
    <div className="space-y-2 pl-2">
      <Field label="Volume" layout="inline">
        <Slider
          value={Math.round(volume * 100)}
          min={0}
          max={100}
          format={(v) => `${v}%`}
          data-testid="sound-volume"
          onChange={(e) => {
            onChange(Number(e.target.value) / 100, loop, `volume:${cue.id}`);
          }}
        />
      </Field>
      <Toggle
        label="Play it again at the end"
        checked={loop}
        onChange={(on) => {
          onChange(volume, on);
        }}
      />
    </div>
  );
}
