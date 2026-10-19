import { BLACK, FOLLOW, WHITE, type Appearance } from '../../../shared/appearance/appearances';
import { Badge } from '../ui/Badge';
import { cx } from '../ui/cx';
import { Dialog } from '../ui/Dialog';
import { Notice } from '../ui/Notice';
import { radioKeys, radioTabIndex } from '../ui/radio';
import { AppearancePreview } from './AppearancePreview';
import { chooseAppearance, closeAppearance, useAppearance } from './appearance-store';

/*
 * The Appearance window (Sessions 39–40; View › Appearance…, Pro Mode): every appearance drawn as a small
 * picture of the operator window, with Follow the computer first (Black and White side by side). Choosing one
 * changes every one of Drashti's own windows at once and lasts over a restart; it is this computer's, never the
 * library's. The screens in the hall, the stream and the phones never change with it.
 */

/** Follow the computer's picture: Black, and White beside it. */
function FollowPreview() {
  return (
    <div className="grid grid-cols-2 gap-1.5" aria-hidden="true">
      <AppearancePreview appearance={BLACK} />
      <AppearancePreview appearance={WHITE} />
    </div>
  );
}

interface Choice {
  id: string;
  name: string;
  note: string;
  appearance: Appearance | null;
}

export function AppearanceDialog() {
  const open = useAppearance((s) => s.open);
  const view = useAppearance((s) => s.view);
  const problem = useAppearance((s) => s.problem);
  if (!open) return null;
  // What Follow the computer shows now, said only while it is chosen: while another appearance is, the
  // computer's own setting is not Drashti's to read (the native parts follow the appearance then).
  const following = view?.choice === FOLLOW;
  const shownName = following ? (view.list.find((a) => a.id === view.shown)?.name ?? '') : '';
  const choices: Choice[] = view
    ? [
        {
          id: FOLLOW,
          name: 'Follow the computer',
          note: `Black or White, as this computer is set${shownName ? ` (now ${shownName})` : ''}`,
          appearance: null,
        },
        ...view.list.map((a) => ({
          id: a.id,
          name: a.name,
          note: a.base === 'dark' ? 'Dark' : 'Light',
          appearance: a,
        })),
      ]
    : [];
  const ids = choices.map((c) => c.id);
  const chosen = view?.choice ?? FOLLOW;
  const choose = (id: string) => {
    if (id !== chosen) void chooseAppearance(id);
  };
  return (
    <Dialog
      title="Appearance"
      subtitle="How Drashti’s own windows look on this computer. The screens in the hall, the stream and the phones never change with it."
      placement="right"
      size="lg"
      onClose={closeAppearance}
      testId="appearance-dialog"
    >
      <div className="space-y-4">
        <h3 id="appearance-choose" className="text-2xs font-bold tracking-wider text-muted uppercase">
          Choose one
        </h3>
        <div
          role="radiogroup"
          aria-labelledby="appearance-choose"
          className="grid grid-cols-2 gap-3 lg:grid-cols-3"
          onKeyDown={radioKeys(ids, chosen, choose)}
          data-testid="appearance-choices"
        >
          {choices.map((c, i) => {
            const checked = c.id === chosen;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={radioTabIndex(checked, i, ids.includes(chosen))}
                data-testid="appearance-choice"
                data-choice={c.id}
                onClick={() => {
                  choose(c.id);
                }}
                className={cx(
                  'flex flex-col gap-2 rounded-lg border-2 bg-panel-2 p-2 text-left transition-colors',
                  checked ? 'border-accent' : 'border-line hover:border-field',
                )}
              >
                {c.appearance ? <AppearancePreview appearance={c.appearance} /> : <FollowPreview />}
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-bold text-fg">{c.name}</span>
                  {checked && <Badge tone="info">Chosen</Badge>}
                </span>
                <span className="text-xs text-muted">{c.note}</span>
              </button>
            );
          })}
        </div>
        {problem && (
          <Notice tone="danger" data-testid="appearance-problem">
            {problem}
          </Notice>
        )}
      </div>
    </Dialog>
  );
}
