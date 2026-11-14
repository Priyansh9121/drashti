import { useMemo, useState } from 'react';
import { animationById } from '../../../../shared/lower-third-animations';
import { fontChoice, LOWER_THIRD_FONT_CHOICES, nearestWeight } from '../../../../shared/lower-third-fonts';
import {
  OFFERED_LIST,
  OFFERED_MOTIONS,
  OFFERED_STYLES,
  outName,
} from '../../../../shared/lower-third-studio';
import { DEFAULT_ACCENT, MOTION_NAMES, STYLE_NAMES } from '../../../../shared/lower-third-styles';
import type { LowerThirdAlign, LowerThirdFont, LowerThirdWeight } from '../../../../shared/lower-thirds';
import {
  LOWER_THIRD_ALIGNS,
  LOWER_THIRD_BOTTOM,
  LOWER_THIRD_LINE_MAX,
  LOWER_THIRD_SECONDS,
  LOWER_THIRD_SIZE,
  LOWER_THIRD_WHERE,
  WHERE_NAMES,
} from '../../../../shared/lower-thirds';
import { cx } from '../../ui/cx';
import { ColorInput, Field, NumberInput, Select, Slider, TextInput } from '../../ui/Field';
import { Choices } from './Choices';
import { change, changeLook, leaveOut, playAgain, useStudio } from './studio-store';

/*
 * The studio's tabs (Session 55, Part 16): the words and where they show; the style they sit in, their colours, font,
 * size and place; how it comes in and goes out, each found by its plain words; the moving background behind them;
 * and whether it stays up until hidden or goes by itself after the seconds chosen (Part 8's R). Every change shows
 * at once in the preview; Save keeps it.
 */

const LINE_LABELS = ['First line (a name, say)', 'Second line (a title)', 'Third line (a place)'];
const ALIGN_NAMES: Record<LowerThirdAlign, string> = { left: 'Left', centre: 'Centre', right: 'Right' };
const WEIGHT_NAMES: Record<LowerThirdWeight, string> = { 400: 'Regular', 500: 'Medium', 700: 'Bold' };
const SCRIPT_NAMES = { latin: 'English', gujarati: 'ગુજરાતી', devanagari: 'हिन्दी' } as const;

export function WordsTab() {
  const draft = useStudio((s) => s.draft);
  return (
    <div className="space-y-3">
      {LINE_LABELS.map((label, i) => (
        <Field key={label} label={label}>
          <TextInput
            value={draft.lines[i] ?? ''}
            maxLength={LOWER_THIRD_LINE_MAX}
            data-testid="lower-third-line"
            placeholder={i === 0 ? 'Placeholder name' : ''}
            onChange={(e) => {
              const lines = [...draft.lines];
              lines[i] = e.target.value;
              change({ lines });
            }}
          />
        </Field>
      ))}
      <Choices
        label="Where it shows"
        choices={LOWER_THIRD_WHERE}
        value={draft.where}
        names={WHERE_NAMES}
        testId="lower-third-where"
        onChoose={(where) => {
          change({ where });
        }}
      />
    </div>
  );
}

export function StyleTab() {
  const look = useStudio((s) => s.draft.look);
  const font = fontChoice(look.font);
  return (
    <div className="space-y-4">
      <Choices
        label="The words sit in"
        choices={OFFERED_STYLES}
        value={look.style ?? 'box'}
        names={STYLE_NAMES}
        testId="lower-third-style"
        className="grid grid-cols-2"
        onChoose={(style) => {
          changeLook({ style });
        }}
      />
      <div className="flex flex-wrap gap-3">
        <Field label="Words">
          <ColorInput
            value={look.text}
            data-testid="lower-third-text-colour"
            onChange={(e) => {
              changeLook({ text: e.target.value });
            }}
          />
        </Field>
        <Field label="Band">
          <ColorInput
            value={look.band}
            data-testid="lower-third-band-colour"
            onChange={(e) => {
              changeLook({ band: e.target.value });
            }}
          />
        </Field>
        <Field label="Second colour">
          <ColorInput
            value={look.accent ?? DEFAULT_ACCENT}
            data-testid="lower-third-accent-colour"
            onChange={(e) => {
              changeLook({ accent: e.target.value });
            }}
          />
        </Field>
      </div>
      <Field label="How solid the band is">
        <Slider
          min={0}
          max={100}
          step={5}
          value={Math.round(look.bandOpacity * 100)}
          format={(v) => `${String(v)}%`}
          onChange={(e) => {
            changeLook({ bandOpacity: Number(e.target.value) / 100 });
          }}
        />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Field label="Font" className="min-w-0 flex-1">
          <Select
            value={look.font}
            data-testid="lower-third-font"
            onChange={(e) => {
              const next = fontChoice(e.target.value);
              changeLook({
                font: next.name as LowerThirdFont,
                weight: nearestWeight(next, look.weight),
              });
            }}
          >
            {LOWER_THIRD_FONT_CHOICES.map((f) => (
              <option key={f.name} value={f.name}>
                {`${f.name} (${f.scripts.map((s) => SCRIPT_NAMES[s]).join(', ')})`}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Weight">
          <Select
            value={String(nearestWeight(font, look.weight))}
            onChange={(e) => {
              changeLook({ weight: Number(e.target.value) as LowerThirdWeight });
            }}
          >
            {font.weights.map((w) => (
              <option key={w} value={w}>
                {WEIGHT_NAMES[w]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Size">
        <Slider
          min={LOWER_THIRD_SIZE.min}
          max={LOWER_THIRD_SIZE.max}
          step={0.5}
          value={look.size}
          format={(v) => `${String(v)}% of the height`}
          data-testid="lower-third-size"
          onChange={(e) => {
            changeLook({ size: Number(e.target.value) });
          }}
        />
      </Field>
      <Choices<LowerThirdAlign>
        label="Across the picture"
        choices={LOWER_THIRD_ALIGNS}
        value={look.align}
        names={ALIGN_NAMES}
        testId="lower-third-align"
        onChoose={(align) => {
          changeLook({ align });
        }}
      />
      <Field label="From the bottom">
        <Slider
          min={LOWER_THIRD_BOTTOM.min}
          max={LOWER_THIRD_BOTTOM.max}
          step={1}
          value={look.bottom}
          format={(v) => `${String(v)}% of the height`}
          data-testid="lower-third-bottom"
          onChange={(e) => {
            changeLook({ bottom: Number(e.target.value) });
          }}
        />
      </Field>
    </div>
  );
}

/** Words for searching, lower case, without marks or little words (as the library's own search has them). */
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/gu, ' ')
    .split(/\s+/u)
    .filter((w) => w !== '' && !['in', 'from', 'the', 'by', 'and', 'a', 'to', 'out'].includes(w));

/** The offered animations whose name (as it comes in, or goes out) or other names hold each word asked for. */
function found(query: string, out: boolean): typeof OFFERED_LIST {
  const asked = words(query);
  if (asked.length === 0) return OFFERED_LIST;
  return OFFERED_LIST.filter(({ animation: a }) => {
    const has = [...words(a.name), ...(out ? words(outName(a.id)) : []), ...a.keywords];
    return asked.every((w) => has.some((h) => h.startsWith(w)));
  });
}

const rowButton = 'block w-full rounded-sm px-2 py-1.5 text-left text-sm';

/** A list of animations, by their headings: the one chosen pressed. */
function AnimationList({
  items,
  chosen,
  label,
  testId,
  itemTestId,
  nameOf,
  onChoose,
  first,
}: {
  items: typeof OFFERED_LIST;
  chosen: string;
  label: string;
  testId: string;
  itemTestId: string;
  nameOf: (id: string) => string;
  onChoose: (id: string) => void;
  /** An entry above the rest (the out's "As it came in"). */
  first?: { name: string };
}) {
  // Each heading over its first.
  const rows = items.map((item, i) => ({ ...item, head: i === 0 || items[i - 1]?.group !== item.group }));
  return (
    <ul
      aria-label={label}
      data-testid={testId}
      className="max-h-44 min-h-0 space-y-0.5 overflow-y-auto rounded-md border border-line p-1"
    >
      {first && (
        <li>
          <button
            type="button"
            aria-pressed={chosen === ''}
            data-testid={itemTestId}
            data-id=""
            className={cx(
              rowButton,
              chosen === '' ? 'bg-panel-3 text-fg' : 'text-muted hover:bg-panel-2 hover:text-fg',
            )}
            onClick={() => {
              onChoose('');
            }}
          >
            {first.name}
          </button>
        </li>
      )}
      {rows.map(({ group, animation: a, head }) => {
        return [
          head && (
            <li
              key={`h-${group}`}
              aria-hidden="true"
              className="px-2 pt-2 pb-0.5 text-xs font-semibold text-faint"
            >
              {group}
            </li>
          ),
          <li key={a.id}>
            <button
              type="button"
              aria-pressed={a.id === chosen}
              data-testid={itemTestId}
              data-id={a.id}
              className={cx(
                rowButton,
                a.id === chosen ? 'bg-panel-3 text-fg' : 'text-muted hover:bg-panel-2 hover:text-fg',
              )}
              onClick={() => {
                onChoose(a.id);
              }}
            >
              {nameOf(a.id)}
            </button>
          </li>,
        ];
      })}
      {items.length === 0 && <li className="px-2 py-1.5 text-sm text-muted">No animation is called that.</li>}
    </ul>
  );
}

export function AnimationTab() {
  const draft = useStudio((s) => s.draft);
  const [inQuery, setInQuery] = useState('');
  const [outQuery, setOutQuery] = useState('');
  const ins = useMemo(() => found(inQuery, false), [inQuery]);
  const outs = useMemo(() => found(outQuery, true), [outQuery]);
  const asCameIn = 'As it came in, backwards';
  return (
    <div className="space-y-4">
      <section aria-label="Comes in" className="space-y-1.5">
        <p className="text-xs font-medium text-muted">
          Comes in:{' '}
          <span data-testid="lower-third-animation-chosen" className="text-fg">
            {animationById(draft.animation).name}
          </span>
        </p>
        <Field label="Find how it comes in" hint={`${String(ins.length)} of ${String(OFFERED_LIST.length)}`}>
          <TextInput
            type="search"
            value={inQuery}
            placeholder="fade, slide left, bounce…"
            data-testid="lower-third-search"
            onChange={(e) => {
              setInQuery(e.target.value);
            }}
          />
        </Field>
        <AnimationList
          items={ins}
          chosen={draft.animation}
          label="Animations in"
          testId="lower-third-animations"
          itemTestId="lower-third-animation"
          nameOf={(id) => animationById(id).name}
          onChoose={(id) => {
            change({ animation: id });
            playAgain();
          }}
        />
      </section>
      <section aria-label="Goes out" className="space-y-1.5">
        <p className="text-xs font-medium text-muted">
          Goes out:{' '}
          <span data-testid="lower-third-out-chosen" className="text-fg">
            {draft.outAnimation ? outName(draft.outAnimation) : asCameIn}
          </span>
        </p>
        <Field label="Find how it goes out" hint={`${String(outs.length)} of ${String(OFFERED_LIST.length)}`}>
          <TextInput
            type="search"
            value={outQuery}
            placeholder="fade, wipe, blur…"
            data-testid="lower-third-out-search"
            onChange={(e) => {
              setOutQuery(e.target.value);
            }}
          />
        </Field>
        <AnimationList
          items={outs}
          chosen={draft.outAnimation ?? ''}
          label="Animations out"
          testId="lower-third-out-animations"
          itemTestId="lower-third-out-animation"
          nameOf={outName}
          first={{ name: asCameIn }}
          onChoose={(id) => {
            if (id === '') leaveOut('outAnimation');
            else change({ outAnimation: id });
            playAgain();
          }}
        />
      </section>
    </div>
  );
}

export function BackgroundTab() {
  const look = useStudio((s) => s.draft.look);
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Calm ones first, then livelier ones. Each moves while the lower third is up, in the band’s colour, the
        second colour (Style) and white.
      </p>
      <Choices
        label="Moving behind the words"
        choices={OFFERED_MOTIONS}
        value={look.motion ?? 'none'}
        names={MOTION_NAMES}
        testId="lower-third-motion"
        className="grid grid-cols-2"
        onChoose={(motion) => {
          changeLook(motion === 'none' ? { motion: undefined } : { motion });
          playAgain();
        }}
      />
    </div>
  );
}

export function TimingTab() {
  const seconds = useStudio((s) => s.draft.seconds);
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? (seconds === undefined ? '' : String(seconds));
  const commit = (text: string) => {
    const n = Math.round(Number(text));
    if (Number.isFinite(n) && text.trim() !== '')
      change({ seconds: Math.min(LOWER_THIRD_SECONDS.max, Math.max(LOWER_THIRD_SECONDS.min, n)) });
    setTyped(null);
  };
  return (
    <div className="space-y-3">
      <Choices
        label="Stays up"
        choices={['until', 'seconds'] as const}
        value={seconds === undefined ? 'until' : 'seconds'}
        names={{ until: 'Until it is hidden', seconds: 'For a set time' }}
        testId="lower-third-stays"
        onChoose={(choice) => {
          if (choice === 'until') leaveOut('seconds');
          else if (seconds === undefined) change({ seconds: 10 });
        }}
      />
      {seconds !== undefined && (
        <Field
          label="Seconds"
          hint={`It goes by itself, playing its out, this long after it went up: ${String(LOWER_THIRD_SECONDS.min)} to ${String(LOWER_THIRD_SECONDS.max)} seconds.`}
        >
          <NumberInput
            min={LOWER_THIRD_SECONDS.min}
            max={LOWER_THIRD_SECONDS.max}
            step={1}
            unit="s"
            value={shown}
            data-testid="lower-third-seconds"
            onChange={(e) => {
              setTyped(e.target.value);
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= LOWER_THIRD_SECONDS.min && n <= LOWER_THIRD_SECONDS.max)
                change({ seconds: n });
            }}
            onBlur={(e) => {
              commit(e.target.value);
            }}
          />
        </Field>
      )}
    </div>
  );
}
