import type { NetworkStatus } from '../../../shared/network';
import { SectionTitle } from '../ui/Panel';
import { Toggle } from '../ui/Toggle';
import { networkAction } from './network-store';

/*
 * Files from phones (Session 54, D4), in the Phones and tablets panel: the switch, off until someone turns it on
 * (every person's). Since alpha.23 (QA23-PHONE-1, shared/phone-rule.ts) no phone sends a file, whether it is on or
 * off: the network refuses every upload from a Remote before reading it. The switch stays for now and its words say
 * so (the owner's Q11, "Words now, hide later"); it goes in a later release.
 */

export function AddFilesSection({ status }: { status: NetworkStatus }) {
  const files = status.addFiles;
  if (!files) return null;
  return (
    <section className="space-y-2" data-testid="network-add-files-section">
      <SectionTitle>Files from phones</SectionTitle>
      <Toggle
        checked={files.on}
        label="Phones and tablets may add files"
        onChange={(on) => void networkAction(() => window.drashti.network.setAddFiles(on))}
        data-testid="network-add-files"
      />
      <p className="text-sm text-muted">
        Phones no longer send files to Drashti: on or off, Drashti refuses every file a phone sends. Bring
        files in on this computer with Add files… or by dropping them on a playlist. This switch stays here
        for now.
      </p>
    </section>
  );
}
