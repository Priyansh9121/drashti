import type { NetworkStatus } from '../../../shared/network';
import { ADDED_FROM_PHONES, sizeWords } from '../../../shared/phone-files';
import { SectionTitle } from '../ui/Panel';
import { Toggle } from '../ui/Toggle';
import { networkAction } from './network-store';

/*
 * Files from phones (Session 54, D4), in the Phones and tablets panel: the switch, off until someone turns it on
 * (every person's), and what it lets a paired remote do. Turned off, a file still coming stops.
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
        A paired remote can add a picture, video, sound, PDF, PowerPoint or Keynote file from the phone, up to{' '}
        {sizeWords(files.maxBytes)} each, with Add from this Phone… in its Library. It comes into Media and
        the playlist “{ADDED_FROM_PHONES}”, marked with the phone’s name, and never goes on the screens by
        itself.
      </p>
    </section>
  );
}
