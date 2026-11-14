import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { animationById } from '../../../../shared/lower-third-animations';
import { fontChoice, LOWER_THIRD_FONT_CHOICES, nearestWeight } from '../../../../shared/lower-third-fonts';
import { ANIMATION_QUICK_WORDS, findAnimations } from '../../../../shared/lower-third-search';
import { OFFERED_MOTIONS, OFFERED_STYLES, outName } from '../../../../shared/lower-third-studio';
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
import { FindBox } from './FindBox';
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

const rowButton = 'block w-full rounded-sm px-2 py-1.5 text-left text-sm';

/**
 * A list of animations, by their headings: the one chosen pressed. One Tab stop (the one chosen, or the first); the
 * arrows move along it, and up from its first goes back to the search box.
 */
function AnimationList({
  items,
  chosen,
  label,
  testId,
  itemTestId,
  nameOf,
  onChoose,
  onUp,
  listRef,
  first,
}: {
  items: ReturnType<typeof findAnimations>;
  chosen: string;
  label: string;
  testId: string;
  itemTestId: string;
  nameOf: (id: string) => string;
  onChoose: (id: string) => void;
  /** Up from its first: back to the search box. */
  onUp: () => void;
  listRef: RefObject<HTMLUListElement | null>;
  /** An entry above the rest (the out's "As it came in"). */
  first?: { name: string };
}) {
  const [focused, setFocused] = useState<string | null>(null);
  const above = first !== undefined;
  const ids = useMemo(() => [...(above ? [''] : []), ...items.map((o) => o.animation.id)], [above, items]);
  const stop = focused !== null && ids.includes(focused) ? focused : ids.includes(chosen) ? chosen : ids[0];
  // Each heading over its first.
  const rows = items.map((item, i) => ({ ...item, head: i === 0 || items[i - 1]?.group !== item.group }));
  const row = (id: string, name: string) => (
    <button
      type="button"
      aria-pressed={id === chosen}
      tabIndex={id === stop ? 0 : -1}
      data-testid={itemTestId}
      data-id={id}
      className={cx(
        rowButton,
        id === chosen ? 'bg-panel-3 text-fg' : 'text-muted hover:bg-panel-2 hover:text-fg',
      )}
      onFocus={() => {
        setFocused(id);
      }}
      onClick={() => {
        onChoose(id);
      }}
    >
      {name}
    </button>
  );
  return (
    <ul
      ref={listRef}
      aria-label={label}
      data-testid={testId}
      className="max-h-44 min-h-0 space-y-0.5 overflow-y-auto rounded-md border border-line p-1"
      onKeyDown={(e) => {
        const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-id]')];
        const i = buttons.findIndex((b) => b === document.activeElement);
        if (i < 0) return;
        let next: number;
        if (e.key === 'ArrowDown') next = Math.min(i + 1, buttons.length - 1);
        else if (e.key === 'ArrowUp') next = i - 1;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = buttons.length - 1;
        else return;
        e.preventDefault();
        if (next < 0) onUp();
        else buttons[next]?.focus();
      }}
    >
      {first && <li>{row('', first.name)}</li>}
      {rows.map(({ group, animation: a, head }) => [
        head && (
          <li
            key={`h-${group}`}
            aria-hidden="true"
            className="px-2 pt-2 pb-0.5 text-xs font-semibold text-faint"
          >
            {group}
          </li>
        ),
        <li key={a.id}>{row(a.id, nameOf(a.id))}</li>,
      ])}
      {items.length === 0 && <li className="px-2 py-1.5 text-sm text-muted">Nothing matches.</li>}
    </ul>
  );
}

const ways = (n: number, way: 'in' | 'out') => `${String(n)} way${n === 1 ? '' : 's'} ${way}`;

/**
 * How it comes in and goes out (Session 58, the owner's simpler search): one box at the top finds the ways in and the
 * ways out together, by their names and plain words ("slide up slow", "soft", "from below"), with quick words under
 * it; each list stays where it was, showing what the box found, to pick from.
 */
export function AnimationTab() {
  const draft = useStudio((s) => s.draft);
  const [query, setQuery] = useState('');
  const ins = useMemo(() => findAnimations(query, 'in'), [query]);
  const outs = useMemo(() => findAnimations(query, 'out'), [query]);
  const box = useRef<HTMLDivElement>(null);
  const inList = useRef<HTMLUListElement>(null);
  const outList = useRef<HTMLUListElement>(null);
  // What the box found starts at the top of each list.
  useEffect(() => {
    inList.current?.scrollTo({ top: 0 });
    outList.current?.scrollTo({ top: 0 });
  }, [query]);
  const toBox = () => {
    box.current?.querySelector('input')?.focus();
  };
  const asCameIn = 'As it came in, backwards';
  return (
    <div className="space-y-3">
      <div ref={box}>
        <FindBox
          label="Find an animation"
          query={query}
          onQuery={setQuery}
          placeholder="slide up slow, soft, letters…"
          testId="lower-third-search"
          statusTestId="lower-third-search-status"
          words={ANIMATION_QUICK_WORDS}
          found={`${ways(ins.length, 'in')}, ${ways(outs.length, 'out')}`}
          nothing={ins.length === 0 && outs.length === 0}
          onDown={() => {
            inList.current?.querySelector<HTMLElement>('button[tabindex="0"]')?.focus();
          }}
        />
      </div>
      <section aria-label="Comes in" className="space-y-1.5">
        <p className="text-xs font-medium text-muted">
          Comes in:{' '}
          <span data-testid="lower-third-animation-chosen" className="text-fg">
            {animationById(draft.animation).name}
          </span>
        </p>
        <AnimationList
          items={ins}
          chosen={draft.animation}
          label="Animations in"
          testId="lower-third-animations"
          itemTestId="lower-third-animation"
          nameOf={(id) => animationById(id).name}
          onUp={toBox}
          listRef={inList}
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
        <AnimationList
          items={outs}
          chosen={draft.outAnimation ?? ''}
          label="Animations out"
          testId="lower-third-out-animations"
          itemTestId="lower-third-out-animation"
          nameOf={outName}
          first={{ name: asCameIn }}
          onUp={toBox}
          listRef={outList}
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
      <p className="text-xs text-muted">
        It moves while the lower third is up, in the band’s colour and the second colour (Style).
      </p>
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
