import { useEffect, useId, useState } from 'react';
import type { EngineState } from '../../../shared/engine/state';
import type { StageLayout } from '../../../shared/stage-layouts';
import type { StageTemplate, TemplateTimerKind } from '../../../shared/stage-templates';
import {
  freshName,
  STAGE_TEMPLATE_NAMES,
  STAGE_TEMPLATE_NOTES,
  STAGE_TEMPLATES,
  TEMPLATE_LENGTH_MS,
  TEMPLATE_TIME,
  TEMPLATE_TIMER_NAMES,
  templateBoxes,
  templateTimer,
  templateTimerKinds,
} from '../../../shared/stage-templates';
import { TIMER_WORDS } from '../../../shared/timer-slides';
import type { TimerState } from '../../../shared/timers';
import { parseDuration, TIMER_KIND_NAMES, timerDuration } from '../../../shared/timers';
import { useEngine } from '../engine/engine-store';
import { lookAction, useLooks } from '../looks/looks-store';
import { PlacedInParent } from '../render/Placed';
import { StageLayoutView } from '../render/StageLayoutView';
import { connectScreens, useScreens } from '../screens/screens-store';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { Dialog } from '../ui/Dialog';
import { Field, Select, TextInput } from '../ui/Field';
import { LayoutTemplate } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { radioKeys, radioTabIndex } from '../ui/radio';
import { useHallPicture } from './hall-picture';
import { save, startLayout, useStageLayouts } from './stage-layouts-store';

/*
 * New from a Template… (Session 54), in the stage layout editor: the five ready-made stage layouts
 * (shared/stage-templates.ts) as a list of choices, beside a live picture of what the stage would show with the
 * one chosen; and the timer it shows: a new one, with the length or the time of day asked (5:00 and 7:30 pm until
 * another is typed; placeholder names), or one already in Timers. Make the layout makes the timer, then the
 * layout, shows it in the editor, and chooses it at once for the stage screens: every stage group's layout in the
 * live Look.
 */

const NO_TIMERS: TimerState[] = [];

/** The picture's own timer, while the new one is not made yet. */
const PREVIEW_TIMER = 'template-preview-timer';

/** A time of day as the time field gives it ("19:30"). */
const TIME_OF_DAY = /^([01]?\d|2[0-3]):[0-5]\d$/u;

/** The longest a countdown may be: a day, as Timers allows. */
const LONGEST_MS = 24 * 3600 * 1000;

/**
 * The layout chosen for every stage group in the live Look, as Screens' Stage layout does it: null, or why it
 * could not be.
 */
async function chooseForStage(layoutId: string): Promise<string | null> {
  const [looks, screens] = await Promise.all([window.drashti.looks.list(), window.drashti.screens.get()]);
  for (const group of screens.groups.filter((g) => g.role === 'stage')) {
    const set = () => window.drashti.looks.setGroup(looks.liveId, group.id, { stageLayoutId: layoutId });
    if (!(await lookAction(set)))
      return `The layout is made, but the stage screens could not be given it: ${useLooks.getState().error ?? 'choose it in Screens.'}`;
  }
  return null;
}

export function StageTemplateDialog({ onClose }: { onClose: () => void }) {
  const state = useEngine((s) => s.state);
  const timers = state?.timers ?? NO_TIMERS;
  const lookName = state?.look.name ?? '';
  const snapshot = useScreens((s) => s.snapshot);
  const hall = useHallPicture();
  const stages = snapshot?.groups.filter((g) => g.role === 'stage').length ?? 0;
  const [template, setTemplate] = useState<StageTemplate>('timer');
  const [use, setUse] = useState<'new' | 'own'>('new');
  const [kind, setKind] = useState<TemplateTimerKind>('countdown');
  const [length, setLength] = useState(timerDuration(TEMPLATE_LENGTH_MS, false));
  const [at, setAt] = useState(TEMPLATE_TIME);
  const [name, setName] = useState<string | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [words, setWords] = useState(TIMER_WORDS);
  const [problem, setProblem] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const id = useId();
  // The stage groups the layout is chosen for, read if the window has not yet.
  useEffect(() => {
    connectScreens();
  }, []);

  const kinds = templateTimerKinds(template);
  // The new timer's kind: the template's own, or the one chosen (Timer only, and over the audience).
  const newKind = kinds.includes(kind) ? kind : (kinds[0] ?? 'countdown');
  // Timers already in Timers that the template can count with, running ones first, as Timers lists them.
  const fitting = [
    ...timers.filter((t) => t.startedAt !== null),
    ...timers.filter((t) => t.startedAt === null),
  ].filter((t) => t.kind !== 'clock' && kinds.includes(t.kind));
  const own = fitting.find((t) => t.id === chosenId) ?? fitting[0] ?? null;
  const ownChosen = use === 'own' ? own : null;
  const timerName = (
    name ??
    freshName(
      timers.map((t) => t.name),
      TEMPLATE_TIMER_NAMES[newKind],
    )
  ).trim();
  const parsed = parseDuration(length);

  // The picture: the chosen template around the timer it would show (the chosen one, live, or the new one as it
  // would start), with what the stage shows now.
  const picture = (() => {
    const timer: TimerState = ownChosen ?? {
      id: PREVIEW_TIMER,
      name: '',
      kind: newKind,
      durationMs: parsed ?? TEMPLATE_LENGTH_MS,
      targetTime: TIME_OF_DAY.test(at) ? at : TEMPLATE_TIME,
      allowsOverrun: false,
      startedAt: null,
      elapsedMs: 0,
    };
    let n = 0;
    const layout: StageLayout = {
      id: `template-${template}`,
      name: STAGE_TEMPLATE_NAMES[template],
      background: '#000000',
      boxes: templateBoxes(template, timer.id, () => `${template}-${String(++n)}`, words),
    };
    const shown: EngineState | null = state
      ? { ...state, timers: [...state.timers.filter((x) => x.id !== timer.id), timer] }
      : null;
    return { layout, state: shown };
  })();

  const make = async () => {
    if (making) return;
    setProblem(null);
    let timerId: string;
    if (ownChosen) timerId = ownChosen.id;
    else {
      const durationMs = newKind === 'countdown' ? parsed : 0;
      if (durationMs === null || (newKind === 'countdown' && (durationMs <= 0 || durationMs > LONGEST_MS))) {
        setProblem('Write the length as minutes and seconds, for example 5:00.');
        return;
      }
      if (newKind === 'countdown_to_time' && !TIME_OF_DAY.test(at)) {
        setProblem('Choose the time of day it counts down to, for example 7:30 pm.');
        return;
      }
      setMaking(true);
      const made = await window.drashti.timers.create(
        templateTimer(template, newKind, {
          name: timerName === '' ? TEMPLATE_TIMER_NAMES[newKind] : timerName,
          durationMs,
          targetTime: at,
        }),
      );
      if (!made.ok) {
        setMaking(false);
        setProblem(made.message);
        return;
      }
      timerId = made.id;
    }
    setMaking(true);
    const taken = (useStageLayouts.getState().layouts ?? []).map((l) => l.name);
    startLayout(
      freshName(taken, STAGE_TEMPLATE_NAMES[template]),
      templateBoxes(template, timerId, () => crypto.randomUUID(), words),
    );
    // The editor shows the new layout from here: saved, or not saved yet and why (the store's problem).
    const saved = await save();
    onClose();
    if (!saved) return;
    const wrong = await chooseForStage(useStageLayouts.getState().shownId);
    if (wrong !== null) useStageLayouts.setState({ problem: wrong });
  };

  return (
    <Dialog
      title="New from a Template"
      subtitle="A stage layout ready made, with the timer it shows. Everything in it can be changed after."
      onClose={onClose}
      closeLabel="Close New from a Template"
      size="lg"
      testId="stage-template-dialog"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon={LayoutTemplate}
            disabled={making}
            data-testid="stage-template-make"
            onClick={() => void make()}
          >
            Make the layout
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {problem && (
          <Notice tone="danger" compact>
            {problem}
          </Notice>
        )}
        <div className="grid grid-cols-[15rem_minmax(0,1fr)] gap-4">
          <div
            role="radiogroup"
            aria-label="Template"
            className="flex flex-col gap-1.5"
            onKeyDown={radioKeys(STAGE_TEMPLATES, template, setTemplate)}
          >
            {STAGE_TEMPLATES.map((t, i) => {
              const chosen = t === template;
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  // Named by its name alone; what it shows, said after it.
                  aria-labelledby={`${id}-${t}-name`}
                  aria-describedby={`${id}-${t}`}
                  tabIndex={radioTabIndex(chosen, i, true)}
                  data-testid="stage-template"
                  data-template={t}
                  onClick={() => {
                    setTemplate(t);
                  }}
                  className={cx(
                    'flex flex-col gap-0.5 rounded-lg border px-3 py-1.5 text-left',
                    chosen ? 'border-accent bg-panel-3' : 'border-line bg-panel-2 hover:bg-panel-3',
                  )}
                >
                  <span
                    id={`${id}-${t}-name`}
                    className={cx('text-sm text-fg', chosen ? 'font-bold' : 'font-medium')}
                  >
                    {STAGE_TEMPLATE_NAMES[t]}
                  </span>
                  <span id={`${id}-${t}`} className="text-xs leading-snug text-muted">
                    {STAGE_TEMPLATE_NOTES[t]}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="min-w-0 space-y-3">
            <div
              className="relative aspect-video w-full overflow-hidden rounded-md border border-line-strong bg-black"
              data-testid="stage-template-picture"
              data-template={template}
              data-a11y-picture
              aria-hidden="true"
            >
              {picture.state && (
                <PlacedInParent
                  content={{ width: 1920, height: 1080 }}
                  mode="fit"
                  className="absolute inset-0"
                >
                  <div className="relative h-[1080px] w-[1920px]">
                    <StageLayoutView layout={picture.layout} state={picture.state} hall={hall} />
                  </div>
                </PlacedInParent>
              )}
            </div>
            <fieldset className="space-y-2" data-testid="stage-template-timer">
              <legend className="mb-1 text-sm font-medium">The timer it shows</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name={`${id}-use`}
                    className="h-4 w-4 accent-primary"
                    checked={ownChosen === null}
                    data-testid="stage-template-new-timer"
                    onChange={() => {
                      setUse('new');
                    }}
                  />
                  A new timer
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name={`${id}-use`}
                    className="h-4 w-4 accent-primary"
                    checked={ownChosen !== null}
                    disabled={own === null}
                    data-testid="stage-template-own-timer"
                    onChange={() => {
                      setUse('own');
                    }}
                  />
                  One in Timers
                  {own === null && <span className="text-xs text-muted">(none of this kind yet)</span>}
                </label>
              </div>
              {ownChosen ? (
                <Field label="Timer">
                  <Select
                    data-testid="stage-template-timer-choice"
                    value={ownChosen.id}
                    onChange={(e) => {
                      setChosenId(e.target.value);
                    }}
                  >
                    {fitting.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({TIMER_KIND_NAMES[t.kind]})
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <div className="flex flex-wrap items-end gap-3">
                  {kinds.length > 1 && (
                    <Field label="Kind">
                      <Select
                        data-testid="stage-template-kind"
                        value={newKind}
                        onChange={(e) => {
                          const v = kinds.find((k) => k === e.target.value);
                          if (v) setKind(v);
                        }}
                      >
                        {kinds.map((k) => (
                          <option key={k} value={k}>
                            {TIMER_KIND_NAMES[k]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                  {newKind === 'countdown' && (
                    <Field label="Length">
                      <TextInput
                        className="w-24"
                        data-testid="stage-template-length"
                        value={length}
                        placeholder="5:00"
                        onChange={(e) => {
                          setLength(e.target.value);
                        }}
                      />
                    </Field>
                  )}
                  {newKind === 'countdown_to_time' && (
                    <Field label="Counts down to">
                      <TextInput
                        type="time"
                        data-testid="stage-template-time"
                        value={at}
                        onChange={(e) => {
                          setAt(e.target.value);
                        }}
                      />
                    </Field>
                  )}
                  <Field label="Its name in Timers" className="min-w-40 flex-1">
                    <TextInput
                      data-testid="stage-template-name"
                      value={name ?? timerName}
                      maxLength={80}
                      onChange={(e) => {
                        setName(e.target.value);
                      }}
                    />
                  </Field>
                </div>
              )}
            </fieldset>
            {template === 'countdownTo' && (
              <Field label="Words above the timer">
                <TextInput
                  data-testid="stage-template-words"
                  value={words}
                  maxLength={200}
                  onChange={(e) => {
                    setWords(e.target.value);
                  }}
                />
              </Field>
            )}
          </div>
        </div>
        <Notice tone="info" compact data-testid="stage-template-where">
          {stages > 0
            ? `Made, it is chosen at once for the stage screens in the live Look, “${lookName}”.`
            : 'No screens are set up for the stage yet: the layout is made, and is chosen for them in Screens once they are.'}
        </Notice>
      </div>
    </Dialog>
  );
}
