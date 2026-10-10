import { useEffect } from 'react';
import { create } from 'zustand';
import type { UpdateView } from '../../../shared/updates';
import { formatBytes } from '../../../shared/format';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Download, FolderOpen, RefreshCw } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { Progress } from '../ui/Progress';
import { Toggle } from '../ui/Toggle';
import { useMode } from '../operator/mode-store';

/*
 * Help > Check for Updates… (Session 14, Pro Mode): which version this is,
 * Check now, and for a newer release Download (an admin's), then Install
 * when Drashti quits (an admin's). Drashti never installs by itself and
 * never restarts itself; Simple Mode never sees this. The status bar says
 * when one is available or waiting to install.
 */

const useUpdates = create<{ view: UpdateView | null; open: boolean }>(() => ({ view: null, open: false }));

let connected = false;

export function connectUpdates(): void {
  if (connected) return;
  connected = true;
  window.drashti.updates.onChanged((view) => {
    useUpdates.setState({ view });
  });
  window.drashti.updates.onOpen(() => {
    useUpdates.setState({ open: true });
  });
  void window.drashti.updates.view().then((view) => {
    useUpdates.setState({ view });
  });
}

const close = () => {
  useUpdates.setState({ open: false });
};

export function UpdatesDialog() {
  const open = useUpdates((s) => s.open);
  const view = useUpdates((s) => s.view);
  useEffect(() => {
    connectUpdates();
  }, []);
  if (!open || !view) return null;
  const offer = view.offer;
  return (
    <Dialog
      title="Updates"
      size="md"
      onClose={close}
      closeLabel="Close updates"
      testId="updates-dialog"
      footer={
        <>
          <Button
            className="mr-auto"
            icon={RefreshCw}
            data-testid="updates-check"
            disabled={view.phase === 'checking' || view.phase === 'downloading' || view.phase === 'waiting'}
            onClick={() => void window.drashti.updates.check()}
          >
            Check now
          </Button>
          <Button onClick={close}>Close</Button>
        </>
      }
    >
      <div className="space-y-4 text-sm" data-testid="updates-body" data-phase={view.phase}>
        <p>
          This is Drashti <strong data-testid="updates-current">{view.current}</strong>.{' '}
          {view.phase === 'checking' && 'Looking for a newer one…'}
          {view.phase === 'up-to-date' && 'It is the newest.'}
        </p>
        {offer && view.phase !== 'up-to-date' && (
          <div className="space-y-2 rounded-lg border border-line p-3" data-testid="updates-offer">
            <p className="flex items-center gap-2">
              <Badge tone="info">New</Badge>
              <span>
                Drashti <strong>{offer.version}</strong>
                {offer.size > 0 ? ` (${formatBytes(offer.size)})` : ''}
              </span>
            </p>
            {offer.notes && (
              <p className="whitespace-pre-line text-muted" data-testid="updates-notes">
                {offer.notes}
              </p>
            )}
            {view.phase === 'available' && (
              <Button
                variant="primary"
                icon={Download}
                data-testid="updates-download"
                onClick={() => void window.drashti.updates.download()}
              >
                Download
              </Button>
            )}
            {(view.phase === 'downloading' || view.phase === 'waiting') && view.progress && (
              <div className="space-y-1" role="status">
                <Progress
                  value={view.progress.total > 0 ? view.progress.done / view.progress.total : 0}
                  label="Downloading the update"
                />
                <p className="text-muted">
                  {view.phase === 'waiting'
                    ? `Waiting: ${view.waitingFor ?? ''}. It goes on by itself afterwards.`
                    : `Downloading in the background: ${formatBytes(view.progress.done)} of ${formatBytes(view.progress.total)}.`}
                </p>
                <Button size="sm" onClick={() => void window.drashti.updates.cancel()}>
                  Stop
                </Button>
              </div>
            )}
            {view.phase === 'ready' && (
              <div className="space-y-2" data-testid="updates-ready">
                <p>Downloaded and checked.</p>
                {view.install === 'at-quit' ? (
                  <Toggle
                    checked={view.installOnQuit}
                    label="Install it when Drashti quits (Drashti does not start again by itself)"
                    data-testid="updates-install-on-quit"
                    onChange={(on) => void window.drashti.updates.setInstallOnQuit(on)}
                  />
                ) : (
                  <Notice tone="info">
                    This copy of Drashti is not signed, so the Mac cannot install the update by itself. After
                    the sabha, quit Drashti, open the downloaded file and drag Drashti into Applications.
                    <Button
                      size="sm"
                      icon={FolderOpen}
                      className="mt-2"
                      onClick={() => void window.drashti.updates.showFile()}
                    >
                      Show the file
                    </Button>
                  </Notice>
                )}
              </div>
            )}
          </div>
        )}
        {view.message && (
          <p role="alert" className="text-warning-fg" data-testid="updates-message">
            {view.message}
          </p>
        )}
        <Toggle
          checked={view.autoCheck}
          label="Look for a newer version once a day (it never downloads or installs by itself)"
          data-testid="updates-auto-check"
          onChange={(on) => void window.drashti.updates.setAutoCheck(on)}
        />
        <p className="text-xs text-muted">
          Downloads go at a gentle speed and wait while the stream is on air or recording. Nothing installs
          until Drashti quits, and then only if an admin said so. Output nodes must run the same version as
          this computer: update them too (each node offers to, when it sees this one changed).
        </p>
      </div>
    </Dialog>
  );
}

/** The status bar's word about an update (Pro Mode): one available, or waiting to install at quit. */
export function UpdateStatus() {
  const view = useUpdates((s) => s.view);
  const simple = useMode((s) => s.mode === 'simple');
  useEffect(() => {
    connectUpdates();
  }, []);
  // Simple Mode never sees updates.
  if (simple || !view?.offer) return null;
  const text =
    view.phase === 'ready' && view.installOnQuit
      ? `Drashti ${view.offer.version} installs when Drashti quits`
      : view.phase === 'ready'
        ? `Drashti ${view.offer.version} is downloaded`
        : view.phase === 'available'
          ? `Drashti ${view.offer.version} is available`
          : null;
  if (!text) return null;
  return (
    <button
      type="button"
      data-testid="update-status"
      onClick={() => {
        useUpdates.setState({ open: true });
      }}
      className="flex min-w-0 items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-accent hover:text-fg"
    >
      <Download size={13} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{text}</span>
    </button>
  );
}
