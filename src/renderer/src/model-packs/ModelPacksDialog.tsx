import { useEffect, useState } from 'react';
import type { InstalledPackView, ModelPacksStatus } from '../../../shared/model-packs';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ConfirmDialog, Dialog } from '../ui/Dialog';
import { Notice } from '../ui/Notice';
import { Progress } from '../ui/Progress';
import { importingText, modelCredit, modelLine, modelPurposes, packLine } from './model-packs-words';
import { closeModelPacks, connectModelPacks, takeStatus, useModelPacks } from './model-packs-store';

/*
 * Help › Caption and Translation Models… (alpha.22, cap-pack; Pro Mode): the offline caption and translation models
 * on this computer. An admin imports a pack from a folder or a zip (main's own dialog chooses it); every file is
 * checked against the pack's list before it is kept, and one that does not match refuses the whole pack. What is
 * installed, its size and its licences (their own texts too); Remove takes a pack off this computer. Never fetched.
 */

export function ModelPacksDialog() {
  const open = useModelPacks((s) => s.open);
  const status = useModelPacks((s) => s.status);
  useEffect(() => {
    connectModelPacks();
  }, []);
  if (!open || !status) return null;
  return <PacksForm status={status} />;
}

function importPack(kind: 'folder' | 'zip') {
  useModelPacks.setState({ notice: null, licence: null });
  void window.drashti.modelPacks.import(kind).then((r) => {
    takeStatus(r.status);
    if (r.ok)
      useModelPacks.setState({
        notice: {
          tone: 'success',
          text: `${r.pack.name} is installed on this computer, every file checked.`,
        },
      });
    else if (!r.cancelled) useModelPacks.setState({ notice: { tone: 'danger', text: r.message } });
  });
}

function PacksForm({ status }: { status: ModelPacksStatus }) {
  const notice = useModelPacks((s) => s.notice);
  const [removing, setRemoving] = useState<InstalledPackView | null>(null);
  const busy = status.importing.phase !== 'idle';
  const progress = importingText(status);
  return (
    <Dialog
      title="Caption and translation models"
      size="md"
      onClose={closeModelPacks}
      closeLabel="Close caption and translation models"
      testId="model-packs-dialog"
      footer={<Button onClick={closeModelPacks}>Close</Button>}
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Live captions and translation can use models from an offline pack that an admin brings on a drive or
          as a zip. Drashti never downloads them. It checks every file against the pack’s list (its size and
          SHA-256) before keeping it on this computer, outside the library and its backups. Import the pack on
          each Main.
        </p>
        {status.problem && (
          <Notice tone="warning" data-testid="model-packs-problem">
            {status.problem}
          </Notice>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={busy}
            data-testid="model-packs-import-folder"
            onClick={() => {
              importPack('folder');
            }}
          >
            Import a Folder…
          </Button>
          <Button
            disabled={busy}
            data-testid="model-packs-import-zip"
            onClick={() => {
              importPack('zip');
            }}
          >
            Import a Zip…
          </Button>
        </div>
        {progress !== null && (
          <div className="space-y-2" data-testid="model-packs-importing">
            {status.importing.phase === 'importing' && status.importing.total > 0 && (
              <Progress
                value={status.importing.done / status.importing.total}
                label="Copying and checking the pack"
              />
            )}
            <div className="flex items-center gap-2">
              <p className="flex-1 text-sm" role="status">
                {progress}
              </p>
              <Button
                size="sm"
                data-testid="model-packs-stop"
                onClick={() => {
                  void window.drashti.modelPacks.cancel();
                }}
              >
                Stop
              </Button>
            </div>
          </div>
        )}
        {notice && (
          <Notice tone={notice.tone} data-testid="model-packs-notice">
            {notice.text}
          </Notice>
        )}
        {status.packs.length === 0 ? (
          <p className="text-sm text-muted" data-testid="model-packs-none">
            No pack is installed on this computer. Live captions keep the model chosen in File › Live
            Captions….
          </p>
        ) : (
          <ul className="space-y-3" aria-label="Installed packs" data-testid="model-packs-list">
            {status.packs.map((pack) => (
              <PackRow
                key={pack.id}
                pack={pack}
                onRemove={() => {
                  setRemoving(pack);
                }}
              />
            ))}
          </ul>
        )}
      </div>
      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.name}?`}
          confirmLabel="Remove"
          testId="model-packs-remove-confirm"
          onCancel={() => {
            setRemoving(null);
          }}
          onConfirm={() => {
            const id = removing.id;
            setRemoving(null);
            void window.drashti.modelPacks.remove(id).then((r) => {
              if (r.ok) {
                takeStatus(r.status);
                useModelPacks.setState({ notice: null, licence: null });
              } else useModelPacks.setState({ notice: { tone: 'danger', text: r.message } });
            });
          }}
        >
          <p>
            Its models and licences are removed from this computer. Live captions and translation can no
            longer use them until the pack is imported again.
          </p>
        </ConfirmDialog>
      )}
    </Dialog>
  );
}

function PackRow({ pack, onRemove }: { pack: InstalledPackView; onRemove: () => void }) {
  const licence = useModelPacks((s) => s.licence);
  return (
    <li className="space-y-2 rounded border border-line p-3" data-testid="model-pack" data-pack={pack.id}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium break-words">{pack.name}</p>
          <p className="text-sm text-muted" data-testid="model-pack-line">
            {packLine(pack)}
          </p>
        </div>
        {pack.inUse && <Badge tone="info">In use</Badge>}
        <Button size="sm" variant="danger" data-testid="model-pack-remove" onClick={onRemove}>
          Remove…
        </Button>
      </div>
      {pack.problem && <Notice tone="warning">{pack.problem}</Notice>}
      <ul className="space-y-1" aria-label={`Models in ${pack.name}`}>
        {pack.models.map((m) => (
          <li key={m.id} className="text-sm" data-testid="model-pack-model" data-model={m.id}>
            <span className="font-medium">{modelPurposes(m)}</span>
            <span className="text-muted">
              {' '}
              ({m.id}: {modelLine(m)})
            </span>
            <span className="block text-muted" data-testid="model-pack-credit">
              {modelCredit(m)}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {pack.licences.map((l) => (
          <Button
            key={l.file}
            size="sm"
            variant="ghost"
            data-testid="model-pack-licence"
            aria-expanded={licence?.packId === pack.id && licence.file === l.file}
            onClick={() => {
              if (licence?.packId === pack.id && licence.file === l.file) {
                useModelPacks.setState({ licence: null });
                return;
              }
              void window.drashti.modelPacks.licence(pack.id, l.file).then((r) => {
                if (r.ok)
                  useModelPacks.setState({ licence: { packId: pack.id, file: l.file, text: r.text } });
                else useModelPacks.setState({ notice: { tone: 'danger', text: r.message } });
              });
            }}
          >
            The {l.licence} licence
          </Button>
        ))}
      </div>
      {licence?.packId === pack.id && (
        <pre
          className="max-h-48 overflow-auto rounded bg-panel-2 p-2 text-xs whitespace-pre-wrap"
          data-testid="model-pack-licence-text"
          role="region"
          tabIndex={0}
          aria-label={`${licence.file} in ${pack.name}`}
        >
          {licence.text}
        </pre>
      )}
    </li>
  );
}
