import { useDeferredValue, useId, useMemo, useState } from 'react';
import type { AppearanceBase } from '../../../shared/appearance/appearances';
import { checkAccent, madeAppearance, OWN_NAME_MAX } from '../../../shared/appearance/derive';
import { cutText } from '../../../shared/text';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { ColorInput, Field, TextInput } from '../ui/Field';
import { Toggle } from '../ui/Toggle';
import { Notice } from '../ui/Notice';
import { radioKeys, radioTabIndex } from '../ui/radio';
import { AppearancePreview } from './AppearancePreview';
import { makeAppearance } from './appearance-store';

/*
 * Making one's own appearance (Session 40), in the Appearance window: a copy of any appearance, given a name, a
 * base (dark or light) and an accent, the next thing to do's colour. Drashti works out the rest and measures every
 * rule as the accent is chosen (src/shared/appearance/derive.ts): one that fails is refused in plain words, with
 * the nearest accent that works offered, and Save waits until every rule is met. Saved, it is chosen at once.
 * Session 42: a second colour (for headings and what is chosen) is worked out from the accent, or chosen too, and
 * checked the same way.
 */

export interface OwnStart {
  /** The appearance copied, by name, for the new one's first name. */
  from: string;
  base: AppearanceBase;
  accent: string;
  /** Its second colour: one chosen (copying one's own that has one), or what the window shows now. */
  second: string;
  /** Whether that second colour was chosen, not worked out. */
  ownSecond: boolean;
}

const BASES: readonly AppearanceBase[] = ['dark', 'light'];

export function OwnAppearanceForm({ start, onDone }: { start: OwnStart; onDone: () => void }) {
  const [name, setName] = useState(cutText(`${start.from} (mine)`, OWN_NAME_MAX));
  const [base, setBase] = useState<AppearanceBase>(start.base);
  const [accent, setAccent] = useState(start.accent);
  const [ownSecond, setOwnSecond] = useState(start.ownSecond);
  const [second, setSecond] = useState(start.second);
  const [saving, setSaving] = useState(false);
  const titleId = useId();
  const baseId = useId();
  // Measured as the colours are chosen; a colour picker sends many while it is dragged, so the check follows.
  const asked = `${base} ${accent} ${ownSecond ? second : '-'}`;
  const checking = useDeferredValue(asked);
  const [checkBase, checkColour, checkSecond] = checking.split(' ') as [AppearanceBase, string, string];
  const chosenSecond = checkSecond === '-' ? undefined : checkSecond;
  const check = useMemo(
    () => checkAccent(checkBase, checkColour, chosenSecond),
    [checkBase, checkColour, chosenSecond],
  );
  const preview = useMemo(
    () => madeAppearance('own-preview', name, checkBase, checkColour, chosenSecond),
    [name, checkBase, checkColour, chosenSecond],
  );
  const named = name.trim() !== '';
  const save = async () => {
    setSaving(true);
    const id = await makeAppearance({ name: name.trim(), base, accent, ...(ownSecond ? { second } : {}) });
    setSaving(false);
    if (id) onDone();
  };
  return (
    <section
      aria-labelledby={titleId}
      className="space-y-3 rounded-lg border border-line-strong bg-panel-2 p-3"
      data-testid="appearance-make"
    >
      <h3 id={titleId} className="text-sm font-bold text-fg">
        Make your own
      </h3>
      <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
        <div className="space-y-3">
          <Field label="Name" error={named ? null : 'Give it a name.'}>
            <TextInput
              value={name}
              maxLength={OWN_NAME_MAX}
              data-testid="appearance-make-name"
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          </Field>
          <div className="space-y-1">
            <span id={baseId} className="block text-sm font-medium text-fg">
              Base
            </span>
            <div
              role="radiogroup"
              aria-labelledby={baseId}
              className="flex gap-2"
              onKeyDown={radioKeys(BASES, base, setBase)}
            >
              {BASES.map((b, i) => (
                <button
                  key={b}
                  type="button"
                  role="radio"
                  aria-checked={b === base}
                  tabIndex={radioTabIndex(b === base, i, true)}
                  data-testid={`appearance-make-${b}`}
                  onClick={() => {
                    setBase(b);
                  }}
                  className={cx(
                    'h-8 rounded-md border px-3 text-sm',
                    b === base ? 'border-accent bg-panel-3 font-bold text-fg' : 'border-field text-muted',
                  )}
                >
                  {b === 'dark' ? 'Dark' : 'Light'}
                </button>
              ))}
            </div>
          </div>
          <Field label="The next thing to do’s colour" hint="Drashti works out every other colour from it.">
            <ColorInput
              value={accent}
              data-testid="appearance-make-accent"
              onChange={(e) => {
                setAccent(e.target.value.toLowerCase());
              }}
            />
          </Field>
          <div className="space-y-1">
            <Toggle
              checked={ownSecond}
              label="Choose the second colour myself"
              data-testid="appearance-make-own-second"
              onChange={(on) => {
                // Starting from the colour shown now, worked out from the accent.
                if (on && !ownSecond) setSecond(preview.decoration.second);
                setOwnSecond(on);
              }}
            />
            {ownSecond ? (
              <Field label="The second colour" hint="For headings, the chosen tab and the chosen row.">
                <ColorInput
                  value={second}
                  data-testid="appearance-make-second"
                  onChange={(e) => {
                    setSecond(e.target.value.toLowerCase());
                  }}
                />
              </Field>
            ) : (
              <p
                className="flex items-center gap-2 text-xs text-muted"
                data-testid="appearance-make-second-worked"
              >
                <span
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 rounded-sm border border-field"
                  style={{ background: preview.decoration.second }}
                />
                Headings, the chosen tab and the chosen row: worked out from the next thing to do’s colour.
              </p>
            )}
          </div>
        </div>
        <AppearancePreview appearance={preview} />
      </div>
      {check.ok ? (
        <Notice tone="success" data-testid="appearance-make-ok">
          Every rule is met: words read on every surface, and the next thing to do and what the second colour
          marks stand apart from LIVE, ON AIR and warnings, for everyone.
        </Notice>
      ) : (
        <Notice
          tone="warning"
          data-testid="appearance-make-refused"
          actions={
            check.nearest && (
              <Button
                size="sm"
                data-testid="appearance-make-nearest"
                onClick={() => {
                  if (!check.nearest) return;
                  if (check.which === 'second') setSecond(check.nearest);
                  else setAccent(check.nearest);
                }}
              >
                Use the nearest colour that works
              </Button>
            )
          }
        >
          {check.why}
        </Notice>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!check.ok || !named || saving || checking !== asked}
          data-testid="appearance-make-save"
          onClick={() => void save()}
        >
          Save and use it
        </Button>
      </div>
    </section>
  );
}
