import { useRef, useState } from 'react';
import type { Glow, ListMark, Outline, Shadow, TextElement, TextShadow } from '../../../shared/model';
import { BULLET_MARKS, isIndic, isNumberMark, NUMBER_MARKS } from '../../../shared/model';
import { LOWER_THIRD_FONTS } from '../../../shared/lower-third-fonts';
import { legacyFontOf } from '../../../shared/slide-edit';
import { boxLines } from '../../../shared/tracks';
import { lineListOf, shiftListLevel, withLinesListed } from '../../../shared/text-lists';
import { IconButton } from '../ui/Button';
import { cx } from '../ui/cx';
import { useFocusTrap } from '../ui/Dialog';
import { ColorInput, Field, NumberInput, Select } from '../ui/Field';
import {
  AArrowDown,
  AArrowUp,
  AlignCenter,
  AlignCenterHorizontal,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  Bold,
  ChevronDown,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListOrdered,
  Sparkles,
  Strikethrough,
  TextSearch,
  Underline,
} from '../ui/icons';
import type { Icon } from '../ui/icons';
import type { MenuPlace } from '../ui/Menu';
import { Menu, menuBelow } from '../ui/Menu';
import { Toggle } from '../ui/Toggle';
import { Cluster, Divider } from './RibbonParts';
import { commit, useEditor } from './editor-store';
import type { BoxPatch, TextPatch } from './ops';
import { findSlide, mapElements, styleBox } from './ops';
import { indentLine, listLines, outdentLine, restyle, restyleAll, selectedList, selectedLook } from './runs-doc';
import { activeText } from './TextBoxEditor';

/*
 * The Words group along the slide editor's top (Session 55, Part 17a): how words look, for the text boxes selected, or
 * while typing in one, for the words selected in it (with none selected, the whole box). One of Drashti's own fonts
 * (the bundled ones: the Noto fonts and the Lower Thirds studio's, never one of this computer's), its size (bigger and
 * smaller by a step), its colour; bold, italic, underline and strike through; left, centre or right, and where in the
 * box; the space between lines; bullets and numbering (Gujarati and Devanagari digits too), a line further in and back
 * out; effects (a shadow, an outline round the letters, a glow, space between letters), and find and replace across
 * the presentation. Every change is one step for Undo; a number typed or a colour dragged is one step however long.
 * Gujarati and Devanagari words are drawn upright (Sessions 31–36): no italic and no letter spacing for them.
 */

/** The sizes Bigger and Smaller step through (slide pixels: a slide is 1080 lines tall). */
const SIZES = [12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96, 108, 120, 132, 144, 160, 180, 200, 240, 280, 320, 400];

/** A bullet's and a number's name, as offered. */
export const LIST_NAMES: Record<ListMark, string> = {
  disc: 'Dot',
  circle: 'Ring',
  square: 'Square',
  dash: 'Dash',
  arrow: 'Arrow',
  '1': '1. 2. 3.',
  gu: '૧. ૨. ૩.',
  hi: '१. २. ३.',
  a: 'a. b. c.',
  A: 'A. B. C.',
  i: 'i. ii. iii.',
};

/** A colour that may see through (#rrggbbaa): the picker changes the colour, and keeps how much it sees through. */
function withSameAlpha(next: string, was: string | null | undefined): string {
  const alpha = was?.length === 9 ? was.slice(7) : '';
  return `${next}${alpha}`;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** A tool that is on or off (bold, a list...). */
function Press({
  icon,
  label,
  on,
  onPress,
  disabled,
  testId,
  kbd,
}: {
  icon: Icon;
  label: string;
  on: boolean;
  onPress: () => void;
  disabled?: boolean;
  testId: string;
  kbd?: string;
}) {
  return (
    <IconButton
      icon={icon}
      label={label}
      kbd={kbd}
      size="sm"
      variant={on ? 'secondary' : 'ghost'}
      aria-pressed={on}
      disabled={disabled}
      data-testid={testId}
      onClick={onPress}
    />
  );
}

/** A number that changes as it is typed or stepped; each change joins one step for Undo. */
function NumberTool({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  testId,
  disabled,
  className = 'w-16',
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  testId: string;
  disabled?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <NumberInput
      aria-label={label}
      title={label}
      value={draft ?? String(value)}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      data-testid={testId}
      className={cx(className, 'h-7')}
      onFocus={() => {
        setDraft(String(value));
      }}
      onBlur={() => {
        setDraft(null);
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() === '' || !Number.isFinite(n)) return;
        onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
      }}
    />
  );
}

/** The shadow choice: none, Drashti's soft one, or one of its own. */
type ShadowChoice = 'none' | 'soft' | 'own';
const shadowChoice = (s: TextShadow | undefined): ShadowChoice =>
  s === false || s === undefined ? 'none' : s === true ? 'soft' : 'own';

export function WordsGroup({ onFind, findKbd }: { onFind: () => void; findKbd: string }) {
  const doc = useEditor((s) => s.doc);
  const slideId = useEditor((s) => s.slideId);
  const selection = useEditor((s) => s.selection);
  const editing = useEditor((s) => s.editing);
  const theme = useEditor((s) => s.look);
  // The look at the caret changes as words are typed and selected.
  useEditor((s) => s.textTick);
  const [listMenu, setListMenu] = useState<{ at: MenuPlace; kind: 'bullets' | 'numbers' } | null>(null);
  const [effects, setEffects] = useState(false);
  const effectsButton = useRef<HTMLButtonElement>(null);
  // The bullet and the numbering chosen last, for the buttons' next press.
  const [lastBullet, setLastBullet] = useState<ListMark>('disc');
  const [lastNumber, setLastNumber] = useState<ListMark>('1');

  const slide = doc ? findSlide(doc, slideId) : undefined;
  const boxes =
    slide?.elements.filter(
      (e): e is TextElement => e.kind === 'text' && selection.includes(e.id) && legacyFontOf(e) === null,
    ) ?? [];
  const first = boxes[0];
  const active = editing !== null && first?.id === editing ? activeText() : null;
  const words = active !== null && !active.view.state.selection.empty;
  const look = active ? selectedLook(active.view.state) : {};
  const s = first?.style;
  const none = first === undefined || s === undefined;

  // What the tools show: the selected words' look over the box's.
  const shown = {
    font: look.font !== undefined ? look.font : (s?.fontFamily ?? null),
    size: look.size ?? s?.fontSize ?? 72,
    weight: look.weight ?? s?.fontWeight ?? 400,
    italic: look.italic ?? allRuns(first, (r) => r.italic === true),
    underline: look.underline ?? allRuns(first, (r) => r.underline === true),
    strike: look.strike ?? allRuns(first, (r) => r.strike === true),
    color: look.color ?? s?.color ?? '#ffffff',
    shadow: look.shadow ?? s?.shadow ?? false,
    outline: look.outline !== undefined ? look.outline : (s?.outline ?? null),
    glow: look.glow !== undefined ? look.glow : (s?.glow ?? null),
    letterSpacing: look.letterSpacing ?? firstRun(first)?.letterSpacing ?? 0,
  };
  // Every line (or the selected words) in Gujarati, Hindi or Sanskrit: drawn upright, so no italic or letter spacing.
  const langsHere = words
    ? [look.lang !== undefined ? look.lang : (first?.lang ?? null)]
    : boxes.flatMap((b) => boxLines(b).map((l) => l.lang ?? b.lang));
  const allIndic = langsHere.length > 0 && langsHere.every((l) => isIndic(l));
  const list = active
    ? selectedList(active.view.state)
    : first
      ? lineListOf(boxLines(first).find((l) => l.runs.length > 0)?.runs ?? [])
      : { mark: null, level: 0 };
  const bullets = list.mark !== null && !isNumberMark(list.mark);
  const numbers = list.mark !== null && isNumberMark(list.mark);

  /** A change to how words look: the selected words, or the whole of each box selected. */
  const apply = (patch: TextPatch, coalesce?: string) => {
    const now = useEditor.getState().doc;
    if (!now || !slide || none) return;
    if (active && words) {
      active.view.dispatch(restyle(active.view.state, patch));
      return;
    }
    commit(
      mapElements(
        now,
        slide.id,
        boxes.map((b) => b.id),
        (e) => (e.kind === 'text' && legacyFontOf(e) === null ? styleBox(e, patch) : e),
      ),
      coalesce ? { coalesce } : {},
    );
    // The words being typed follow the box too.
    if (active) {
      const clear: TextPatch = {};
      for (const k of Object.keys(patch) as (keyof TextPatch)[]) clear[k] = undefined;
      if ('italic' in patch) clear.italic = patch.italic ? true : undefined;
      if ('underline' in patch) clear.underline = patch.underline ? true : undefined;
      if ('strike' in patch) clear.strike = patch.strike ? true : undefined;
      if ('letterSpacing' in patch) clear.letterSpacing = patch.letterSpacing || undefined;
      active.view.dispatch(restyleAll(active.view.state, clear));
    }
  };
  /** A change to each box selected as a whole: alignment, place, line spacing. */
  const applyBox = (box: BoxPatch, coalesce?: string) => {
    const now = useEditor.getState().doc;
    if (!now || !slide || none) return;
    commit(
      mapElements(
        now,
        slide.id,
        boxes.map((b) => b.id),
        (e) => (e.kind === 'text' ? { ...e, style: { ...e.style, ...box } } : e),
      ),
      coalesce ? { coalesce } : {},
    );
  };
  /** Bullets or numbering: the lines typed in (the selection's), or every line of each box selected. */
  const setList = (next: { mark: ListMark } | null) => {
    const now = useEditor.getState().doc;
    if (!now || !slide || none) return;
    if (active) {
      active.view.dispatch(listLines(active.view.state, next));
      active.view.focus();
      return;
    }
    commit(
      mapElements(
        now,
        slide.id,
        boxes.map((b) => b.id),
        (e) => (e.kind === 'text' && legacyFontOf(e) === null ? withLinesListed(e, 'all', next) : e),
      ),
    );
  };
  const shiftLevel = (by: 1 | -1) => {
    const now = useEditor.getState().doc;
    if (!now || !slide || none) return;
    if (active) {
      (by > 0 ? indentLine : outdentLine)(active.view.state, active.view.dispatch);
      active.view.focus();
      return;
    }
    commit(
      mapElements(
        now,
        slide.id,
        boxes.map((b) => b.id),
        (e) => (e.kind === 'text' ? shiftListLevel(e, by) : e),
      ),
    );
  };
  const bold = shown.weight >= 650;
  /** Bold off: the box's own weight when that is not bold, else regular (or the theme's, when it is not bold). */
  const plainWeight = () => {
    const boxWeight = s?.fontWeight ?? 400;
    if (words && boxWeight < 650) return undefined;
    const themeWeight = theme?.style.fontWeight ?? 400;
    return boxWeight < 650 ? boxWeight : themeWeight < 650 ? themeWeight : 400;
  };
  const step = (by: 1 | -1) => {
    const now = shown.size;
    const next = by > 0 ? SIZES.find((x) => x > now + 0.01) : [...SIZES].reverse().find((x) => x < now - 0.01);
    if (next !== undefined) apply({ size: next });
  };
  const fontKnown = shown.font === null || (LOWER_THIRD_FONTS as readonly string[]).includes(shown.font);
  return (
    <div className="flex min-w-0 items-start" data-testid="words-group">
      <Cluster name="Font">
        <Select
          aria-label="Font"
          title="Font"
          className="w-36"
          data-testid="field-font"
          disabled={none}
          value={shown.font ?? ''}
          onChange={(e) => {
            apply({ font: e.target.value === '' ? null : e.target.value });
          }}
        >
          <option value="">The language’s own</option>
          {!fontKnown && shown.font !== null && (
            <option value={shown.font} disabled>
              {shown.font} (not one of Drashti’s)
            </option>
          )}
          {LOWER_THIRD_FONTS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </Select>
        <NumberTool
          label="Size"
          value={round(shown.size)}
          min={4}
          max={2000}
          disabled={none}
          testId="field-size"
          onChange={(v) => {
            apply({ size: v }, `size:${first?.id ?? ''}`);
          }}
        />
        <IconButton
          icon={AArrowUp}
          size="sm"
          label="Bigger"
          disabled={none}
          data-testid="words-grow"
          onClick={() => {
            step(1);
          }}
        />
        <IconButton
          icon={AArrowDown}
          size="sm"
          label="Smaller"
          disabled={none}
          data-testid="words-shrink"
          onClick={() => {
            step(-1);
          }}
        />
        <span title="Colour of the words" className="inline-flex">
          <input
            type="color"
            aria-label="Colour of the words"
            data-testid="field-color"
            disabled={none}
            value={shown.color.slice(0, 7)}
            onChange={(e) => {
              apply({ color: withSameAlpha(e.target.value, shown.color) }, `color:${first?.id ?? ''}`);
            }}
            className="h-7 w-9 cursor-pointer rounded-md border border-field bg-panel-2 p-0.5 hover:border-muted disabled:cursor-not-allowed disabled:opacity-40"
          />
        </span>
      </Cluster>
      <Divider />
      <Cluster name="Style">
        <Press
          icon={Bold}
          label="Bold"
          on={bold}
          disabled={none}
          testId="words-bold"
          onPress={() => {
            apply({ weight: bold ? plainWeight() : 700 });
          }}
        />
        {/* Gujarati, Hindi and Sanskrit are always drawn upright (Sessions 31–36, I18N-2): no Italic for them. */}
        <Press
          icon={Italic}
          label="Italic"
          on={shown.italic && !allIndic}
          disabled={none || allIndic}
          testId="words-italic"
          onPress={() => {
            apply({ italic: !shown.italic });
          }}
        />
        <Press
          icon={Underline}
          label="Underline"
          on={shown.underline}
          disabled={none}
          testId="words-underline"
          onPress={() => {
            apply({ underline: !shown.underline });
          }}
        />
        <Press
          icon={Strikethrough}
          label="Strike through"
          on={shown.strike}
          disabled={none}
          testId="words-strike"
          onPress={() => {
            apply({ strike: !shown.strike });
          }}
        />
      </Cluster>
      <Divider />
      <Cluster name="Lines">
        {(
          [
            ['left', 'Left', AlignLeft],
            ['center', 'Centre', AlignCenter],
            ['right', 'Right', AlignRight],
          ] as const
        ).map(([align, label, icon]) => (
          <Press
            key={align}
            icon={icon}
            label={label}
            on={!none && s.align === align}
            disabled={none}
            testId={`words-align-${align}`}
            onPress={() => {
              applyBox({ align });
            }}
          />
        ))}
        {(
          [
            ['top', 'At the top', ArrowUpToLine],
            ['middle', 'In the middle', AlignCenterHorizontal],
            ['bottom', 'At the bottom', ArrowDownToLine],
          ] as const
        ).map(([place, label, icon]) => (
          <Press
            key={place}
            icon={icon}
            label={label}
            on={!none && s.verticalAlign === place}
            disabled={none}
            testId={`words-place-${place}`}
            onPress={() => {
              applyBox({ verticalAlign: place });
            }}
          />
        ))}
        <NumberTool
          label="Line spacing"
          value={s?.lineHeight ?? 1.35}
          min={0.6}
          max={3}
          step={0.05}
          disabled={none}
          testId="field-line-height"
          className="w-16"
          onChange={(v) => {
            applyBox({ lineHeight: v }, `lineHeight:${first?.id ?? ''}`);
          }}
        />
      </Cluster>
      <Divider />
      <Cluster name="Lists">
        <span className="inline-flex">
          <Press
            icon={List}
            label="Bullets"
            on={bullets}
            disabled={none}
            testId="words-bullets"
            onPress={() => {
              setList(bullets ? null : { mark: lastBullet });
            }}
          />
          <IconButton
            icon={ChevronDown}
            size="sm"
            label="Kinds of bullet"
            aria-haspopup="menu"
            disabled={none}
            data-testid="words-bullets-menu"
            className="w-4!"
            onClick={(e) => {
              setListMenu({ at: menuBelow(e.currentTarget), kind: 'bullets' });
            }}
          />
        </span>
        <span className="inline-flex">
          <Press
            icon={ListOrdered}
            label="Numbering"
            on={numbers}
            disabled={none}
            testId="words-numbers"
            onPress={() => {
              setList(numbers ? null : { mark: lastNumber });
            }}
          />
          <IconButton
            icon={ChevronDown}
            size="sm"
            label="Kinds of numbering"
            aria-haspopup="menu"
            disabled={none}
            data-testid="words-numbers-menu"
            className="w-4!"
            onClick={(e) => {
              setListMenu({ at: menuBelow(e.currentTarget), kind: 'numbers' });
            }}
          />
        </span>
        <IconButton
          icon={IndentDecrease}
          size="sm"
          label="Back out"
          kbd="⇧Tab"
          disabled={none || list.mark === null || list.level === 0}
          data-testid="words-outdent"
          onClick={() => {
            shiftLevel(-1);
          }}
        />
        <IconButton
          icon={IndentIncrease}
          size="sm"
          label="Further in"
          kbd="Tab"
          disabled={none || list.mark === null}
          data-testid="words-indent"
          onClick={() => {
            shiftLevel(1);
          }}
        />
      </Cluster>
      <Divider />
      <Cluster name="Effects">
        <IconButton
          ref={effectsButton}
          icon={Sparkles}
          size="sm"
          label="Effects: shadow, outline, glow, letter spacing"
          aria-haspopup="dialog"
          aria-expanded={effects}
          variant={effects ? 'secondary' : 'ghost'}
          disabled={none}
          data-testid="words-effects"
          onClick={() => {
            setEffects((on) => !on);
          }}
        />
      </Cluster>
      <Divider />
      <Cluster name="Find">
        <IconButton
          icon={TextSearch}
          size="sm"
          label="Find and replace"
          kbd={findKbd}
          data-testid="words-find"
          onClick={onFind}
        />
      </Cluster>
      {listMenu && (
        <Menu
          at={listMenu.at}
          label={listMenu.kind === 'bullets' ? 'Kinds of bullet' : 'Kinds of numbering'}
          onClose={() => {
            setListMenu(null);
          }}
          entries={(listMenu.kind === 'bullets' ? BULLET_MARKS : NUMBER_MARKS).map((mark) => ({
            label: LIST_NAMES[mark],
            checked: list.mark === mark,
            radio: true as const,
            onSelect: () => {
              if (listMenu.kind === 'bullets') setLastBullet(mark);
              else setLastNumber(mark);
              setList({ mark });
            },
          }))}
        />
      )}
      {effects && !none && (
        <EffectsPanel
          anchor={effectsButton.current}
          shown={shown}
          allIndic={allIndic}
          apply={apply}
          coalesceKey={first.id}
          onClose={() => {
            setEffects(false);
          }}
        />
      )}
    </div>
  );
}

/** Whether every run of a box with words has a setting (false for a box without runs). */
function allRuns(el: TextElement | undefined, has: (r: NonNullable<TextElement['runs']>[number]) => boolean): boolean {
  const runs = el?.runs?.filter((r) => r.text.trim() !== '') ?? [];
  return runs.length > 0 && runs.every(has);
}

/** A box's first run with words. */
const firstRun = (el: TextElement | undefined) => el?.runs?.find((r) => r.text.trim() !== '');

/**
 * Effects (Session 55, Part 17a): a shadow (none, Drashti's soft one, or one of its own), an outline round the
 * letters, a glow, and space between the letters: what every screen draws alike. Under its button; Esc closes it.
 */
function EffectsPanel({
  anchor,
  shown,
  allIndic,
  apply,
  coalesceKey,
  onClose,
}: {
  anchor: HTMLElement | null;
  shown: {
    size: number;
    shadow: TextShadow;
    outline: Outline | null;
    glow: Glow | null;
    letterSpacing: number;
  };
  allIndic: boolean;
  apply: (patch: TextPatch, coalesce?: string) => void;
  coalesceKey: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, onClose);
  const box = anchor?.getBoundingClientRect();
  const own: Shadow | null = typeof shown.shadow === 'object' ? shown.shadow : null;
  const outline = shown.outline;
  const glow = shown.glow;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Effects"
      data-testid="words-effects-panel"
      className="fixed z-50 w-72 space-y-3 rounded-lg border border-line-strong bg-panel-2 p-3 shadow-overlay"
      style={{ left: Math.max(8, Math.min((box?.left ?? 8) - 120, window.innerWidth - 296)), top: (box?.bottom ?? 0) + 6 }}
    >
      <Field label="Shadow" layout="inline">
        <Select
          className="flex-1"
          data-testid="field-shadow"
          value={shadowChoice(shown.shadow)}
          onChange={(e) => {
            const v = e.target.value as ShadowChoice;
            apply({
              shadow:
                v === 'none'
                  ? false
                  : v === 'soft'
                    ? true
                    : { color: '#000000d9', blur: Math.round(shown.size * 0.18), x: 0, y: Math.round(shown.size * 0.06) },
            });
          }}
        >
          <option value="none">None</option>
          <option value="soft">Soft (Drashti’s)</option>
          <option value="own">Its own</option>
        </Select>
      </Field>
      {own && (
        <div className="grid grid-cols-3 gap-2 pl-2" data-testid="shadow-own">
          <ColorInput
            aria-label="Shadow colour"
            className="col-span-3"
            value={own.color.slice(0, 7)}
            onChange={(e) => {
              apply({ shadow: { ...own, color: withSameAlpha(e.target.value, own.color) } }, `shadow:${coalesceKey}`);
            }}
          />
          <NumberTool
            label="Shadow blur"
            value={own.blur}
            min={0}
            max={200}
            testId="field-shadow-blur"
            className="w-full"
            onChange={(v) => {
              apply({ shadow: { ...own, blur: v } }, `shadow:${coalesceKey}`);
            }}
          />
          <NumberTool
            label="Shadow across"
            value={own.x}
            min={-500}
            max={500}
            testId="field-shadow-x"
            className="w-full"
            onChange={(v) => {
              apply({ shadow: { ...own, x: v } }, `shadow:${coalesceKey}`);
            }}
          />
          <NumberTool
            label="Shadow down"
            value={own.y}
            min={-500}
            max={500}
            testId="field-shadow-y"
            className="w-full"
            onChange={(v) => {
              apply({ shadow: { ...own, y: v } }, `shadow:${coalesceKey}`);
            }}
          />
        </div>
      )}
      <Toggle
        label="Outline round the letters"
        checked={outline !== null}
        data-testid="field-outline"
        onChange={(on) => {
          apply({ outline: on ? { color: '#000000', width: Math.max(1, Math.round(shown.size / 30)) } : null });
        }}
      />
      {outline && (
        <div className="flex items-center gap-2 pl-2">
          <ColorInput
            aria-label="Outline colour"
            value={outline.color.slice(0, 7)}
            onChange={(e) => {
              apply(
                { outline: { ...outline, color: withSameAlpha(e.target.value, outline.color) } },
                `outline:${coalesceKey}`,
              );
            }}
          />
          <NumberTool
            label="Outline width"
            value={outline.width}
            min={0.5}
            max={100}
            step={0.5}
            testId="field-outline-width"
            onChange={(v) => {
              apply({ outline: { ...outline, width: v } }, `outline:${coalesceKey}`);
            }}
          />
        </div>
      )}
      <Toggle
        label="Glow round the letters"
        checked={glow !== null}
        data-testid="field-glow"
        onChange={(on) => {
          apply({ glow: on ? { color: '#ffd166', size: Math.max(4, Math.round(shown.size * 0.25)) } : null });
        }}
      />
      {glow && (
        <div className="flex items-center gap-2 pl-2">
          <ColorInput
            aria-label="Glow colour"
            data-testid="field-glow-color"
            value={glow.color.slice(0, 7)}
            onChange={(e) => {
              apply({ glow: { ...glow, color: withSameAlpha(e.target.value, glow.color) } }, `glow:${coalesceKey}`);
            }}
          />
          <NumberTool
            label="How far the glow spreads"
            value={glow.size}
            min={1}
            max={200}
            testId="field-glow-size"
            onChange={(v) => {
              apply({ glow: { ...glow, size: v } }, `glow:${coalesceKey}`);
            }}
          />
        </div>
      )}
      <Field label="Space between letters" layout="inline">
        <NumberTool
          label="Space between letters"
          value={allIndic ? 0 : shown.letterSpacing}
          min={-50}
          max={200}
          disabled={allIndic}
          testId="field-letter-spacing"
          onChange={(v) => {
            apply({ letterSpacing: v === 0 ? undefined : v }, `spacing:${coalesceKey}`);
          }}
        />
      </Field>
      {allIndic && (
        <p className="text-xs text-faint">Gujarati and Hindi letters join up: they are never spaced out.</p>
      )}
    </div>
  );
}
