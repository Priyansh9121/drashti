import { useEffect, useState } from 'react';
import type { DropFolderResult, DropFolderView } from '../../../shared/drop-folder';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { FolderOpen } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { Toggle } from '../ui/Toggle';
import { Truncate } from '../ui/Truncate';
import { closeDrop, connectDrop, useDrop } from './drop-store';

/*
 * File › Drop Folder… (Session 28, decision 21): the folder whose pictures, videos and (Session 51) sounds come
 * into the library by themselves, whether it is on, how it stands, and what was not taken and why (a file over
 * 2 GB can be imported anyway). An admin's, in Pro Mode only.
 */

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (at: number) => {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const files = (n: number) => `${String(n)} ${n === 1 ? 'file' : 'files'}`;

function stateText(view: DropFolderView): string {
  switch (view.state) {
    case 'off':
      return view.folder ? 'Off: nothing is taken from the folder.' : 'Choose a folder to start.';
    case 'folder-gone':
      return 'The folder is not there (a USB stick taken out?). It carries on when the folder is back.';
    case 'waiting':
      return `Waiting while the stream is on air or recording: ${files(view.waiting)} will come in afterwards.`;
    case 'watching':
      return view.waiting > 0
        ? `Watching: ${files(view.waiting)} waiting to hold still for 5 seconds.`
        : 'Watching: what goes in the folder comes into Media by itself.';
  }
}

export function DropFolderDialog() {
  const open = useDrop((s) => s.open);
  const view = useDrop((s) => s.view);
  useEffect(() => {
    connectDrop();
  }, []);
  if (!open || !view) return null;
  return <DropFolderForm view={view} />;
}

function DropFolderForm({ view }: { view: DropFolderView }) {
  const [problem, setProblem] = useState<string | null>(null);
  const take = (pending: Promise<DropFolderResult | null>) => {
    void pending.then((r) => {
      if (r === null) return;
      if (!r.ok) {
        setProblem(r.message);
        return;
      }
      setProblem(null);
      useDrop.setState({ view: r.view });
    });
  };
  return (
    <Dialog
      title="Drop folder"
      size="md"
      onClose={closeDrop}
      closeLabel="Close the drop folder"
      testId="drop-dialog"
      footer={<Button onClick={closeDrop}>Close</Button>}
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Pictures, videos and sounds put in this folder come into Media by themselves, once each has held
          still for 5 seconds. Drashti only reads the folder, and nothing leaves the library when a file
          leaves it. While the stream is on air or recording, they wait.
        </p>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">Folder</span>
          <Truncate
            text={view.folder ?? 'None chosen'}
            className="min-w-0 flex-1 text-sm font-medium"
            data-testid="drop-folder-path"
          />
          <Button
            size="sm"
            icon={FolderOpen}
            data-testid="drop-choose"
            onClick={() => {
              take(window.drashti.drop.pickFolder());
            }}
          >
            Choose…
          </Button>
        </div>
        <Toggle
          checked={view.on}
          label="Take what goes in it"
          disabled={view.folder === null}
          data-testid="drop-on"
          onChange={(on) => {
            take(window.drashti.drop.setOn(on));
          }}
        />
        {view.cloud && (
          <Notice tone="warning" data-testid="drop-cloud">
            This folder is kept in step by {view.cloud}: a file can show there before all of it has arrived,
            or only as a placeholder. Drashti waits for each to hold still, but a folder on this computer
            alone is safer.
          </Notice>
        )}
        <p className="text-sm" role="status" data-testid="drop-state" data-state={view.state}>
          {stateText(view)}
          {view.last && view.last.taken > 0 && (
            <span className="text-muted">
              {' '}
              Last: {clock(view.last.at)}, {files(view.last.taken)} taken.
            </span>
          )}
        </p>
        {problem && (
          <Notice tone="danger" data-testid="drop-problem">
            {problem}
          </Notice>
        )}
        {view.notTaken.length > 0 && (
          <section aria-labelledby="drop-not-taken-title" className="space-y-2">
            <h3 id="drop-not-taken-title" className="text-sm font-medium">
              Not taken
            </h3>
            <ul className="space-y-1" data-testid="drop-not-taken">
              {view.notTaken.map((n, i) => (
                <li key={n.name} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{n.name}</span>
                    <span className="text-muted"> · {n.reason}</span>
                  </span>
                  {n.tooLarge && (
                    <Button
                      size="sm"
                      data-testid={`drop-import-anyway-${String(i)}`}
                      onClick={() => {
                        take(window.drashti.drop.importAnyway(n.name));
                      }}
                    >
                      Import anyway
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Dialog>
  );
}
