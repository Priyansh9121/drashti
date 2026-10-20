import { useId, useState } from 'react';
import type { AppearanceView, InterfaceMotion, OwnAppearance } from '../../../shared/appearance/appearances';
import { BLACK, FOLLOW, WHITE, type Appearance } from '../../../shared/appearance/appearances';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { ConfirmDialog, Dialog } from '../ui/Dialog';
import { Copy, Trash2 } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { radioKeys, radioTabIndex } from '../ui/radio';
import { AppearancePreview } from './AppearancePreview';
import {
  chooseAppearance,
  chooseMotion,
  closeAppearance,
  removeAppearance,
  useAppearance,
} from './appearance-store';
import { motionOff } from '../ui/motion';
import { OwnAppearanceForm, type OwnStart } from './OwnAppearanceForm';

/*
 * The Appearance window (Sessions 39–40; View › Appearance…, Pro Mode): every appearance drawn as a small
 * picture of the operator window, with Follow the computer first (Black and White side by side). Choosing one
 * changes every one of Drashti's own windows at once and lasts over a restart; it is this computer's, never the
 * library's. The screens in the hall, the stream and the phones never change with it. Session 40: a copy of
 * any appearance can be made one's own (a name, a base and an accent, every rule checked as it is made), and
 * one's own deleted (asked first); a built-in one can't be.
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

const MOTIONS: readonly { id: InterfaceMotion; name: string; words: string }[] = [
  {
    id: 'calm',
    name: 'Calm',
    words: 'Dialogs, sheets, menus and notices arrive and leave gently.',
  },
  {
    id: 'lively',
    name: 'Lively',
    words:
      'More: tabs and the chosen playlist glide, cards arrive one after another, buttons answer a press, panels open smoothly, and one appearance fades into the next.',
  },
  { id: 'off', name: 'Off', words: 'Nothing in Drashti’s windows moves.' },
];

/**
 * Interface motion (Session 40): how Drashti's own windows move. In every one, the show's controls, the slides'
 * thumbnails and the live picture never move, and the screens in the hall keep their own transitions.
 */
function MotionChoice({ motion }: { motion: InterfaceMotion }) {
  const titleId = useId();
  const ids = MOTIONS.map((m) => m.id);
  const reduced = motionOff() && motion !== 'off';
  const choose = (id: InterfaceMotion) => {
    if (id !== motion) void chooseMotion(id);
  };
  return (
    <section aria-labelledby={titleId} className="space-y-2" data-testid="appearance-motion">
      <h3 id={titleId} className="text-2xs font-bold tracking-wider text-heading uppercase">
        Interface motion
      </h3>
      <div
        role="radiogroup"
        aria-labelledby={titleId}
        className="grid gap-2 sm:grid-cols-3"
        onKeyDown={radioKeys(ids, motion, choose)}
      >
        {MOTIONS.map((m, i) => {
          const checked = m.id === motion;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={radioTabIndex(checked, i, true)}
              data-testid="appearance-motion-choice"
              data-motion-choice={m.id}
              onClick={() => {
                choose(m.id);
              }}
              className={cx(
                'flex flex-col gap-1 rounded-lg border-2 bg-panel-2 p-2 text-left transition-colors',
                checked ? 'border-accent' : 'border-line hover:border-field',
              )}
            >
              <span className="flex items-center gap-2">
                <span className="font-bold text-fg">{m.name}</span>
                {checked && <Badge tone="info">Chosen</Badge>}
              </span>
              <span className="text-xs text-muted">{m.words}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted">
        Whichever is chosen, the show’s controls, the slides and the live picture never move, and the screens
        in the hall keep their own transitions.
        {reduced && ' This computer is set to reduce motion, so nothing moves now.'}
      </p>
    </section>
  );
}

export function AppearanceDialog() {
  const open = useAppearance((s) => s.open);
  const view = useAppearance((s) => s.view);
  if (!open) return null;
  return <AppearanceSheet view={view} />;
}

function AppearanceSheet({ view }: { view: AppearanceView | null }) {
  const problem = useAppearance((s) => s.problem);
  const [making, setMaking] = useState<OwnStart | null>(null);
  const [deleting, setDeleting] = useState<OwnAppearance | null>(null);
  // What Follow the computer shows now, said only while it is chosen: while another appearance is, the
  // computer's own setting is not Drashti's to read (the native parts follow the appearance then).
  const following = view?.choice === FOLLOW;
  const shown = view?.list.find((a) => a.id === view.shown) ?? null;
  const ownIds = new Set(view?.own.map((o) => o.id) ?? []);
  const choices: Choice[] = view
    ? [
        {
          id: FOLLOW,
          name: 'Follow the computer',
          note: `Black or White, as this computer is set${following && shown ? ` (now ${shown.name})` : ''}`,
          appearance: null,
        },
        ...view.list.map((a) => ({
          id: a.id,
          name: a.name,
          note: `${a.base === 'dark' ? 'Dark' : 'Light'}${ownIds.has(a.id) ? ', your own' : ''}`,
          appearance: a,
        })),
      ]
    : [];
  const ids = choices.map((c) => c.id);
  const chosen = view?.choice ?? FOLLOW;
  const choose = (id: string) => {
    if (id !== chosen) void chooseAppearance(id);
  };
  /** A copy of what is shown now: its base, and its primary (or its accent, for one's own) to start from. */
  const copyStart = (): OwnStart | null => {
    if (!view || !shown) return null;
    const own = view.own.find((o) => o.id === shown.id);
    return { from: shown.name, base: shown.base, accent: own?.accent ?? shown.colours.primary };
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
        <h3 id="appearance-choose" className="text-2xs font-bold tracking-wider text-heading uppercase">
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
        <MotionChoice motion={view?.motion ?? 'calm'} />
        {problem && (
          <Notice tone="danger" data-testid="appearance-problem">
            {problem}
          </Notice>
        )}
        {making ? (
          <OwnAppearanceForm
            start={making}
            onDone={() => {
              setMaking(null);
            }}
          />
        ) : (
          shown && (
            <Button
              icon={Copy}
              data-testid="appearance-copy"
              onClick={() => {
                setMaking(copyStart());
              }}
            >
              Make a copy of “{shown.name}”…
            </Button>
          )
        )}
        {view && view.own.length > 0 && (
          <section aria-labelledby="appearance-own" className="space-y-2" data-testid="appearance-own">
            <h3 id="appearance-own" className="text-2xs font-bold tracking-wider text-heading uppercase">
              Your own
            </h3>
            <ul className="space-y-1">
              {view.own.map((o) => (
                <li key={o.id} className="flex items-center gap-2 rounded-md bg-panel-2 px-2 py-1">
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 rounded-sm border border-field"
                    style={{ background: o.accent }}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">{o.name}</span>
                  <Button
                    size="sm"
                    variant="danger"
                    icon={Trash2}
                    data-testid="appearance-delete"
                    aria-label={`Delete “${o.name}”`}
                    onClick={() => {
                      setDeleting(o);
                    }}
                  >
                    Delete…
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {deleting && (
        <ConfirmDialog
          title={`Delete “${deleting.name}”?`}
          confirmLabel="Delete"
          testId="appearance-delete-confirm"
          onCancel={() => {
            setDeleting(null);
          }}
          onConfirm={() => {
            const id = deleting.id;
            setDeleting(null);
            void removeAppearance(id);
          }}
        >
          It goes from this computer. If it is the one in use, Drashti follows the computer again: Black or
          White, as the computer is set.
        </ConfirmDialog>
      )}
    </Dialog>
  );
}
