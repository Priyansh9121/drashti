import { useState } from 'react';
import type { DeckDrashtiTransition, DeckSlide } from '../../../shared/deck';
import {
  BOLD_ONLY_KINDS,
  CUT,
  TRANSITION_KINDS,
  TRANSITION_NAMES,
  type Transition,
  type TransitionKind,
} from '../../../shared/model';
import { Field, NumberInput, Select } from '../ui/Field';

/*
 * A deck's slide's transitions in the slide editor (Session 54, C2): more than PowerPoint, Drashti's own transition,
 * any of its kinds, on the slide and on each click, over the deck's own or instead of it. Left as the deck's own, the
 * slide comes in with the deck's own transition when it comes in order, and each click plays as the deck made it.
 * Each is the deck's (`drashti`, `stepTransitions`), saved with the presentation as any change in the editor is.
 */

/** How Drashti's own transition goes with the deck's: in its place, or around it. */
const MODES: { mode: DeckDrashtiTransition['mode']; label: string }[] = [
  { mode: 'instead', label: 'Instead of the deck’s own' },
  { mode: 'over', label: 'Over the deck’s own' },
];

/** A new transition's length, as the slide editor's other transitions start (0.8 s). */
const NEW_MS = 800;

/** The deck's own transition in words: "Push, 0.5 s, with its sound". */
export function deckOwnWords(deck: DeckSlide): string {
  const t = deck.transition;
  if (!t || t.durationMs <= 0) return 'None';
  const name = (t.name.split(':').at(-1) ?? t.name).replace(/^./u, (c) => c.toUpperCase());
  return `${name}, ${String(Math.round(t.durationMs / 100) / 10)} s${t.soundId ? ', with its sound' : ''}`;
}

/** A deck's slide with Drashti's own transition into it, or none (the deck's own). */
export function withSlideTransition(deck: DeckSlide, own: DeckDrashtiTransition | null): DeckSlide {
  const { drashti: _was, ...rest } = deck;
  return own ? { ...rest, drashti: own } : rest;
}

/** A deck's slide with Drashti's own transition for click `index` (from 1), or none (the deck's own). */
export function withStepTransition(
  deck: DeckSlide,
  index: number,
  own: DeckDrashtiTransition | null,
): DeckSlide {
  const steps = Object.fromEntries(
    Object.entries({ ...deck.stepTransitions, [index]: own }).filter(
      (e): e is [string, DeckDrashtiTransition] => e[1] !== null,
    ),
  );
  const { stepTransitions: _was, ...rest } = deck;
  return Object.keys(steps).length > 0 ? { ...rest, stepTransitions: steps } : rest;
}

/** Seconds as typed, kept as milliseconds (0.1 s to 10 s), as the slide editor's other transitions are. */
function Taking({ ms, onChange, testId }: { ms: number; onChange: (ms: number) => void; testId: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Field label="Taking" layout="inline">
      <NumberInput
        unit="s"
        min={0.1}
        max={10}
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
            onChange(Math.round(Math.min(10, Math.max(0.1, n)) * 1000));
        }}
      />
    </Field>
  );
}

/** One of Drashti's own transitions on a deck: none (the deck's own), or a kind, how it goes with the deck's, its length. */
function OwnTransition({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: DeckDrashtiTransition | null;
  onChange: (own: DeckDrashtiTransition | null) => void;
  testId: string;
}) {
  const t = value?.transition ?? null;
  return (
    <div className="space-y-2">
      <Field label={label}>
        <Select
          className="w-full"
          data-testid={testId}
          value={t === null ? 'deck' : t.kind}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'deck') onChange(null);
            else {
              const transition: Transition =
                v === 'cut'
                  ? CUT
                  : {
                      kind: v as TransitionKind,
                      durationMs: t && t.kind !== 'cut' ? t.durationMs : NEW_MS,
                    };
              onChange({ transition, mode: value?.mode ?? 'instead' });
            }
          }}
        >
          <option value="deck">The deck’s own</option>
          <option value="cut">Cut (at once)</option>
          {TRANSITION_KINDS.filter((k) => k !== 'cut').map((k) => (
            <option key={k} value={k}>
              {TRANSITION_NAMES[k]}
            </option>
          ))}
        </Select>
      </Field>
      {value && t && t.kind !== 'cut' && (
        <div className="space-y-2 pl-2">
          <Field label="How" layout="inline">
            <Select
              className="flex-1"
              data-testid={`${testId}-mode`}
              value={value.mode}
              onChange={(e) => {
                onChange({ ...value, mode: e.target.value as DeckDrashtiTransition['mode'] });
              }}
            >
              {MODES.map((m) => (
                <option key={m.mode} value={m.mode}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          <Taking
            ms={t.durationMs}
            testId={`${testId}-seconds`}
            onChange={(durationMs) => {
              onChange({ ...value, transition: { kind: t.kind, durationMs } });
            }}
          />
          {(BOLD_ONLY_KINDS.includes(t.kind) || t.kind === 'lines' || t.kind === 'words') && (
            <p className="text-xs text-muted" data-testid={`${testId}-picture-note`}>
              A deck’s slide is a picture: it fades on every screen.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * What the slide panel shows of a deck's slide's transitions (in place of "Comes on with"): the deck's own, Drashti's
 * own over or instead of it, and each click's.
 */
export function DeckTransitions({
  deck,
  onChange,
}: {
  deck: DeckSlide;
  /** The deck's slide with the transitions as now chosen (coalesced as one change while typing). */
  onChange: (deck: DeckSlide, coalesce: string) => void;
}) {
  const clicks = Math.max(0, deck.steps.length - 1);
  return (
    <div className="space-y-3" data-testid="deck-transitions">
      <p className="text-xs text-muted" data-testid="deck-own-transition">
        From the deck: {deckOwnWords(deck)}. {clicks === 1 ? '1 click' : `${String(clicks)} clicks`}.
      </p>
      <OwnTransition
        label="Comes on with"
        testId="deck-transition"
        value={deck.drashti ?? null}
        onChange={(own) => {
          onChange(withSlideTransition(deck, own), 'deck-transition');
        }}
      />
      {!deck.drashti && (
        <p className="text-xs text-faint">
          From the slide before it, the deck’s own plays; put up any other way, it comes on with the
          presentation’s transition.
        </p>
      )}
      {Array.from({ length: clicks }, (_, i) => i + 1).map((index) => (
        <OwnTransition
          key={index}
          label={`Click ${String(index)} comes on with`}
          testId={`deck-step-transition-${String(index)}`}
          value={deck.stepTransitions?.[index] ?? null}
          onChange={(own) => {
            onChange(withStepTransition(deck, index, own), `deck-step-${String(index)}`);
          }}
        />
      ))}
    </div>
  );
}
