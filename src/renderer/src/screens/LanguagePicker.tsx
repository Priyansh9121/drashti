import { useId } from 'react';
import type { Lang } from '../../../shared/model';
import { LANG_NAMES } from '../../../shared/themes';
import { IconButton } from '../ui/Button';
import { ArrowDown, ArrowUp } from '../ui/icons';
import { Checkbox } from '../ui/Toggle';

/** The order a group starts from when it chooses its own languages: the usual order on a kirtan's slide. */
export const USUAL_ORDER: readonly Lang[] = ['gu', 'hi', 'translit', 'en'];

/**
 * Which languages a screen group shows of a kirtan's slides, and in what
 * order: all of them as each slide has them, or the ones ticked, top to
 * bottom (the arrows move one up or down). One at least stays ticked.
 */
export function LanguagePicker({
  value,
  onChange,
  disabled = false,
  label = 'Languages of kirtans',
}: {
  value: Lang[] | null;
  onChange: (next: Lang[] | null) => void;
  disabled?: boolean;
  label?: string;
}) {
  const name = useId();
  const chosen = value ?? [];
  const rest = USUAL_ORDER.filter((l) => !chosen.includes(l));
  const move = (lang: Lang, by: -1 | 1) => {
    const at = chosen.indexOf(lang);
    const to = at + by;
    if (at < 0 || to < 0 || to >= chosen.length) return;
    const next = [...chosen];
    next.splice(at, 1);
    next.splice(to, 0, lang);
    onChange(next);
  };
  return (
    <fieldset className="space-y-1.5" disabled={disabled} data-testid="language-picker">
      <legend className="mb-1 text-xs font-medium text-muted">{label}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <label className="inline-flex items-center gap-2">
          <input
            type="radio"
            name={name}
            className="h-4 w-4 accent-accent-strong"
            checked={value === null}
            data-testid="languages-all"
            onChange={() => {
              onChange(null);
            }}
          />
          All, in each slide’s order
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="radio"
            name={name}
            className="h-4 w-4 accent-accent-strong"
            checked={value !== null}
            data-testid="languages-some"
            onChange={() => {
              onChange([...USUAL_ORDER]);
            }}
          />
          Only these, in this order
        </label>
      </div>
      {value !== null && (
        <ol className="space-y-1" aria-label="Languages shown, in order">
          {[...chosen, ...rest].map((lang) => {
            const on = chosen.includes(lang);
            const at = chosen.indexOf(lang);
            return (
              <li
                key={lang}
                className="flex items-center gap-1.5"
                data-testid="language-row"
                data-lang={lang}
              >
                <Checkbox
                  label={LANG_NAMES[lang]}
                  checked={on}
                  className="w-36"
                  // The last one ticked stays: a group shows at least one language.
                  disabled={on && chosen.length === 1}
                  onChange={(e) => {
                    onChange(e.target.checked ? [...chosen, lang] : chosen.filter((l) => l !== lang));
                  }}
                />
                {on && (
                  <>
                    <IconButton
                      icon={ArrowUp}
                      size="sm"
                      label={`${LANG_NAMES[lang]} earlier`}
                      disabled={at === 0}
                      onClick={() => {
                        move(lang, -1);
                      }}
                    />
                    <IconButton
                      icon={ArrowDown}
                      size="sm"
                      label={`${LANG_NAMES[lang]} later`}
                      disabled={at === chosen.length - 1}
                      onClick={() => {
                        move(lang, 1);
                      }}
                    />
                  </>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </fieldset>
  );
}
