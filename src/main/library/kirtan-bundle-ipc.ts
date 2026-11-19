import type { IpcMainInvokeEvent } from 'electron';
import { isAbsolute } from 'node:path';
import { IPC } from '../../shared/ipc';
import { kirtanBundleExportSchema, type KirtanBundleExportResult } from '../../shared/kirtan-bundles';
import type { KirtanBundleExporter } from '../import/kirtan-bundle-export-service';
import { handle } from '../ipc/handle';

interface BundleIpcDeps {
  fromOperator(event: IpcMainInvokeEvent): boolean;
  canExport(): boolean;
  pickOutput(): Promise<string | null>;
  exporter: Pick<KirtanBundleExporter, 'export'>;
}

export function registerKirtanBundleIpc(deps: BundleIpcDeps): void {
  const refused: KirtanBundleExportResult = {
    ok: false,
    message: 'Kirtan bundles can be saved from the operator window in Pro Mode.',
  };
  handle(IPC.kirtans.exportBundle, async (event, request): Promise<KirtanBundleExportResult> => {
    if (!deps.fromOperator(event) || !deps.canExport()) return refused;
    const parsed = kirtanBundleExportSchema.safeParse(request);
    if (!parsed.success)
      return { ok: false, message: 'Choose between 1 and 1,000 kirtans and whether to include media files.' };
    try {
      const chosen = await deps.pickOutput();
      if (chosen === null) return { ok: false, message: 'Bundle export cancelled.', cancelled: true };
      if (!deps.canExport()) return refused;
      if (!isAbsolute(chosen) || chosen.includes('\0'))
        return { ok: false, message: 'Choose a full path for the saved bundle.' };
      const output = /\.drashti-kirtans$/iu.test(chosen) ? chosen : `${chosen}.drashti-kirtans`;
      return await deps.exporter.export({ ...parsed.data, output });
    } catch {
      return { ok: false, message: 'The bundle could not be saved. Choose another folder and try again.' };
    }
  });
}
