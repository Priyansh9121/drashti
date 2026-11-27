import { Fragment, useEffect, useId } from 'react';
import type { KeyBinding } from '../../../shared/keymap';
import {
  fKeyHint,
  keyGroups,
  keyLabel,
  KEYMAP,
  keyText,
  SIMPLE_KEYMAP,
  SINGLE_KEYS_TEXT,
} from '../../../shared/keymap';
import { HOLD_FOR_KEYS, keysOn } from '../../../shared/window-keys';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Kbd } from '../ui/Kbd';
import { Toggle } from '../ui/Toggle';
import { useKeymapNow, useSingleKeys } from './single-keys-store';
import { useKeysSheet } from './keys-sheet-store';

export { showKeysSheet, useKeysSheet } from './keys-sheet-store';

/*
 * The keys sheet (Session 25): Help > Keyboard Shortcuts…, or ? when no field has the focus. Built from KEYMAP and
 * grouped by what the operator is doing (KEY_GROUPS), each key as this computer writes it, so it never drifts from the
 * keys. Pro Mode's holds the switch for the single-letter keys (Session 37, WCAG 2.1.4): on to begin with; off, the
 * sheet says Off beside each key it took away. The keys are the ones the operators already press, and it says so
 * (Session 50). Simple Mode has its own since alpha.24 (a25 item 3, the owner's 48-item list: with Help off a volunteer
 * saw no keys at all): only the keys that act there (keyGroups), and no switch, Pro Mode's setting. Both name the key
 * held to see the buttons' keys (a25 item 24: Alt, Option ⌥ on a Mac), from WINDOW_KEYS' own entry.
 */

/** The hold's row, short enough for one line beside its key at 1280 × 720 (keys-sheet.spec's names on one line). */
const HOLD_LABEL = 'See the buttons’ keys while you hold it';

const close = () => {
  useKeysSheet.setState({ open: false });
};

export function KeysSheet({ platform, simple = false }: { platform: string; simple?: boolean }) {
  const open = useKeysSheet((s) => s.open);
  const singleOn = useSingleKeys((s) => s.on !== false);
  const keymap = useKeymapNow(simple ? SIMPLE_KEYMAP : KEYMAP);
  // ? closes it again (the show's keys are off while a dialog is open, so the sheet listens itself), while
  // the single-letter keys are on.
  useEffect(() => {
    if (!open || !singleOn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open, singleOn]);
  if (!open) return null;
  const mac = platform === 'darwin';
  return (
    <Dialog
      title="Keyboard shortcuts"
      subtitle={mac ? 'As a Mac writes them: ⌘ is Command, ⌥ Option, ⇧ Shift.' : 'As Windows writes them.'}
      size="lg"
      bodyFocusable
      onClose={close}
      closeLabel="Close the list of keys"
      testId="keys-sheet"
      footer={
        <>
          <span className="mr-auto text-xs text-muted">
            {singleOn ? 'Press ? or Esc to close.' : 'Press Esc to close.'}
          </span>
          <Button onClick={close}>Close</Button>
        </>
      }
    >
      <KeysList platform={platform} simple={simple} keymap={keymap} singleOn={singleOn} />
    </Dialog>
  );
}

/**
 * The sheet's list: Pro Mode's switch for the single-letter keys, or Simple Mode's line saying whose keys these are;
 * the keys by group, as they act now (`keymap`: none beside a key turned off); the hold; and the foot's two lines.
 */
export function KeysList({
  platform,
  simple,
  keymap,
  singleOn,
}: {
  platform: string;
  simple: boolean;
  keymap: readonly KeyBinding[];
  singleOn: boolean;
}) {
  const ids = useId();
  return (
    <>
      {simple ? (
        <p className="mb-4 text-sm text-muted" data-testid="keys-simple">
          The keys that work in Simple Mode. Pro Mode has more of them.
        </p>
      ) : (
        <div className="mb-4 flex flex-col gap-1 rounded-md border border-line bg-panel-2 px-3 py-2.5">
          <Toggle
            checked={singleOn}
            label={`Single-letter keys (${SINGLE_KEYS_TEXT})`}
            data-testid="keys-single"
            onChange={(on) => void window.drashti.app.setSingleKeys(on)}
          />
          {singleOn ? (
            <p className="text-xs text-muted">
              They act anywhere in this window while no field has the keyboard. Turn them off for someone who
              works the computer by speech or a switch, so that a word said never blacks out the hall.
            </p>
          ) : (
            <p className="text-xs text-muted" data-testid="keys-single-off">
              Off on this computer: {SINGLE_KEYS_TEXT} do nothing. Black-out still works from its button, a
              MIDI pad and the phone remote.
            </p>
          )}
        </div>
      )}
      <div className="gap-x-8 sm:columns-2">
        {keyGroups(simple).map((group, n) => (
          <section
            key={group.title}
            aria-labelledby={`${ids}-${String(n)}`}
            data-testid="keys-group"
            className="mb-4 break-inside-avoid"
          >
            <h3 id={`${ids}-${String(n)}`} className="mb-1.5 text-sm font-bold">
              {group.title}
            </h3>
            <dl className="space-y-1 text-sm">
              {group.actions.map((action) => {
                const binding = KEYMAP.find((b) => b.action === action);
                if (!binding) return null;
                // Its keys as they act now: none, while the single-letter keys are off.
                const keys = keymap.find((b) => b.action === action)?.keys ?? [];
                // The quick bar's eight, its first to its last ("⌥1 to ⌥8", as the guides write them).
                const range = action === 'quickBar' && keys.length > 2;
                const shown = range ? [keys[0] ?? '', keys.at(-1) ?? ''] : keys;
                // A row of its own: its name as wide as its own keys leave (Session 55: in one grid, the quick bar's
                // eight keys left every name in Running the show a word a line).
                return (
                  <div key={action} className="flex items-center justify-between gap-x-4">
                    <dt className="flex-1 text-muted">
                      {keyLabel(binding, simple)}
                      {binding.scope === 'library' && <span className="text-faint"> (in a list)</span>}
                    </dt>
                    <dd className="flex flex-wrap items-center justify-end gap-1" data-testid="keys-keys">
                      {keys.length === 0 && (
                        <span className="text-xs text-muted" data-testid="keys-off">
                          Off
                        </span>
                      )}
                      {shown.map((key, i) => (
                        <Fragment key={key}>
                          {i > 0 && <span className="text-xs text-muted">{range ? 'to' : 'or'}</span>}
                          <Kbd>{keyText(key, platform)}</Kbd>
                        </Fragment>
                      ))}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        ))}
        {/* The key held to see the buttons' keys (a25 item 24; alpha.24 uihelp's Alt hold, help/HelpSwitch.tsx). */}
        <section aria-labelledby={`${ids}-hold`} data-testid="keys-hold" className="mb-4 break-inside-avoid">
          <h3 id={`${ids}-hold`} className="mb-1.5 text-sm font-bold">
            Seeing the keys
          </h3>
          <dl className="space-y-1 text-sm">
            <div className="flex items-center justify-between gap-x-4">
              <dt className="flex-1 text-muted">{HOLD_LABEL}</dt>
              <dd className="flex flex-wrap items-center justify-end gap-1">
                {keysOn(HOLD_FOR_KEYS, platform).map((key) => (
                  <Kbd key={key}>{keyText(key, platform)}</Kbd>
                ))}
              </dd>
            </div>
          </dl>
          <p className="mt-1 text-xs text-muted">
            With Help off, they show while it is held: let go of it, then press the key.
          </p>
        </section>
        <p className="text-xs text-muted [column-span:all]" data-testid="keys-follow">
          These keys follow what the operators already press.
        </p>
        {/* What this computer's F-keys need (alpha.24, keyplat R4): a Mac's fn and Touch Bar, Windows' Fn Lock. */}
        <p className="mt-1 text-xs text-muted [column-span:all]" data-testid="keys-fkeys">
          {fKeyHint(platform)}
        </p>
      </div>
    </>
  );
}
