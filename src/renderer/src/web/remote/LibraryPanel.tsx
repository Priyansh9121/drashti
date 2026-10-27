import type { ReactNode } from 'react';
import { cx } from '../../ui/cx';
import { BookOpen, Image } from '../../ui/icons';
import { Media } from './Media';
import { type LibraryKind, useMirror } from './mirror-store';

/*
 * The library on the phone (Session 54, D5) as the operator window's library sheet has it: Presentations and
 * Media, a two-way switch above them, remembered while the page is open. The presentations are the remote's own
 * (RemoteApp.tsx's Library, Session 18); Media is Media.tsx. D3's Shared from Drashti is a third choice here.
 */

const KINDS: { id: LibraryKind; label: string; icon: typeof BookOpen }[] = [
  { id: 'presentations', label: 'Presentations', icon: BookOpen },
  { id: 'media', label: 'Media', icon: Image },
];

export function LibraryPanel({ presentations }: { presentations: ReactNode }) {
  const kind = useMirror((s) => s.libraryKind);
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="In the library" className="grid grid-cols-2 gap-2">
        {KINDS.map((k) => {
          const KindIcon = k.icon;
          const on = kind === k.id;
          return (
            <button
              key={k.id}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls="remote-library-panel"
              id={`remote-library-${k.id}-tab`}
              data-testid={`remote-library-${k.id}`}
              onClick={() => useMirror.setState({ libraryKind: k.id })}
              className={cx(
                'flex min-h-11 items-center justify-center gap-2 rounded-lg border text-base',
                on ? 'border-line-strong bg-panel-3 text-fg' : 'border-line text-muted',
              )}
            >
              <KindIcon size={18} aria-hidden="true" />
              {k.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id="remote-library-panel" aria-labelledby={`remote-library-${kind}-tab`}>
        {kind === 'presentations' ? presentations : <Media />}
      </div>
    </div>
  );
}
