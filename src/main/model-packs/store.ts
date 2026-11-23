import type {
  ModelPacksStatus,
  ModelPurpose,
  PackImportResult,
  PackLicenceResult,
  PackRemoveResult,
} from '../../shared/model-packs';

/* The caption and translation models on this computer (alpha.22, cap-pack). Red: not built yet. */

export interface PackedModel {
  id: string;
  packId: string;
  packName: string;
  packRelease: string;
  purposes: readonly ModelPurpose[];
  format: string;
  folder: string;
  files: readonly { name: string; path: string; bytes: number; sha256: string; licence: string }[];
  licences: readonly string[];
}

export interface ModelHold {
  model: PackedModel;
  release(): void;
}

export interface ModelPackDeps {
  root: string;
  log: { info(line: string): void; warn(line: string): void };
  freeBytes?: (folder: string) => Promise<number | null>;
  now?: () => number;
}

const NONE: ModelPacksStatus = { packs: [], importing: { phase: 'idle' }, problem: null };

export class ModelPackStore {
  constructor(private readonly deps: ModelPackDeps) {}
  start(): void {
    this.deps.log.info('Model packs: not built yet');
  }
  close(): void {
    return undefined;
  }
  onChanged(listener: (s: ModelPacksStatus) => void): () => void {
    return () => listener;
  }
  status(): ModelPacksStatus {
    return NONE;
  }
  model(id: string): PackedModel | null {
    return id ? null : null;
  }
  forPurpose(purpose: ModelPurpose): PackedModel[] {
    return purpose ? [] : [];
  }
  acquire(id: string): Promise<ModelHold | null> {
    return Promise.resolve(id ? null : null);
  }
  cancelImport(): void {
    return undefined;
  }
  importPack(source: string, kind: 'folder' | 'zip'): Promise<PackImportResult> {
    return Promise.resolve({ ok: false, message: `${source}${kind}`.slice(0, 0), status: NONE });
  }
  remove(packId: string): Promise<PackRemoveResult> {
    return Promise.resolve({ ok: false, message: packId.slice(0, 0) });
  }
  licenceText(packId: string, file: string): PackLicenceResult {
    return { ok: false, message: `${packId}${file}`.slice(0, 0) };
  }
}
