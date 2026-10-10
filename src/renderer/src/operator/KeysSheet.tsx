import { Fragment, useEffect, useId } from 'react';
import { create } from 'zustand';
import { KEY_GROUPS, KEYMAP, keyText } from '../../../shared/keymap';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Kbd } from '../ui/Kbd';

/*
 * The keys sheet (Session 25): Help > Keyboard Shortcuts…, or ? when no field has the focus, in Pro
 * Mode (Simple Mode keeps its key line). Built from KEYMAP and grouped by what the operator is doing
 * (KEY_GROUPS), each key as this computer writes it, so it never drifts from the keys.
 */

export const useKeysSheet = create<{ open: boolean }>(() => ({ open: false }));

export function showKeysSheet(): void {
  useKeysSheet.setState({ open: true });
}

const close = () => {
  useKeysSheet.setState({ open: false });
};

export function KeysSheet({ platform }: { platform: string }) {
  const open = useKeysSheet((s) => s.open);
  const ids = useId();
  // ? closes it again (the show's keys are off while a dialog is open, so the sheet listens itself).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
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
          <span className="mr-auto text-xs text-muted">Press ? or Esc to close.</span>
          <Button onClick={close}>Close</Button>
        </>
      }
    >
      <div className="gap-x-8 sm:columns-2">
        {KEY_GROUPS.map((group, n) => (
          <section
            key={group.title}
            aria-labelledby={`${ids}-${String(n)}`}
            data-testid="keys-group"
            className="mb-4 break-inside-avoid"
          >
            <h3 id={`${ids}-${String(n)}`} className="mb-1.5 text-sm font-bold">
              {group.title}
            </h3>
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm">
              {group.actions.map((action) => {
                const binding = KEYMAP.find((b) => b.action === action);
                if (!binding) return null;
                return (
                  <Fragment key={action}>
                    <dt className="text-muted">
                      {binding.label}
                      {binding.scope === 'library' && <span className="text-faint"> (in a list)</span>}
                    </dt>
                    <dd className="flex flex-wrap items-center justify-end gap-1" data-testid="keys-keys">
                      {binding.keys.map((key, i) => (
                        <Fragment key={key}>
                          {i > 0 && <span className="text-xs text-muted">or</span>}
                          <Kbd>{keyText(key, platform)}</Kbd>
                        </Fragment>
                      ))}
                    </dd>
                  </Fragment>
                );
              })}
            </dl>
          </section>
        ))}
        <p className="text-xs text-muted [column-span:all]" data-testid="keys-provisional">
          These keys may change after the setup day, to the keys the operators already press.
        </p>
      </div>
    </Dialog>
  );
}
