import type { ReactNode } from 'react';
import { cx } from '../../ui/cx';
import { BookOpen, Image, Share2 } from '../../ui/icons';
import { libraryKinds, shownKind } from './library-kinds';
import { Media } from './Media';
import { type LibraryKind, useMirror } from './mirror-store';
import { AddToDrashti, SharedFromDrashti } from './PhoneFiles';
import { usePhoneFiles } from './phone-files-store';

/*
 * The library on the phone (Session 54, D5) as the operator window's library sheet has it: Presentations and
 * Media, a switch above them, remembered while the page is open. The presentations are the remote's own
 * (RemoteApp.tsx's Library, Session 18); Media is Media.tsx, D4's Add from this Phone… at its top (PhoneFiles.tsx)
 * while Drashti takes files from phones, as what it adds comes into Media. D3's Shared from Drashti is a third
 * choice, on a row of its own (three words never fit a phone's third), shown only while a playlist is shared with
 * phones: once nothing is, the switch goes back to Presentations (phone-files-store.ts).
 */

const KINDS: Record<LibraryKind, { label: string; icon: typeof BookOpen }> = {
  presentations: { label: 'Presentations', icon: BookOpen },
  media: { label: 'Media', icon: Image },
  shared: { label: 'Shared from Drashti', icon: Share2 },
};

export function LibraryPanel({ presentations }: { presentations: ReactNode }) {
  const chosen = useMirror((s) => s.libraryKind);
  const anyShared = usePhoneFiles((s) => (s.shared?.length ?? 0) > 0);
  const kind = shownKind(chosen, anyShared);
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="In the library" className="grid grid-cols-2 gap-2">
        {libraryKinds(anyShared).map((id) => {
          const { label, icon: KindIcon } = KINDS[id];
          const on = kind === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls="remote-library-panel"
              id={`remote-library-${id}-tab`}
              data-testid={`remote-library-${id}`}
              onClick={() => useMirror.setState({ libraryKind: id })}
              className={cx(
                'flex min-h-11 items-center justify-center gap-2 rounded-lg border text-base',
                id === 'shared' && 'col-span-2',
                on ? 'border-line-strong bg-panel-3 text-fg' : 'border-line text-muted',
              )}
            >
              <KindIcon size={18} aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id="remote-library-panel" aria-labelledby={`remote-library-${kind}-tab`}>
        {kind === 'presentations' ? (
          presentations
        ) : kind === 'media' ? (
          <div className="space-y-5">
            <AddToDrashti />
            <Media />
          </div>
        ) : (
          <SharedFromDrashti />
        )}
      </div>
    </div>
  );
}
