import { exportedNotice } from '../../../shared/export-file';
import { useNotice } from '../operator/actions';

/**
 * Export… (alpha.22, the owner's "export button as well to download"): a finished video in Media copied where the
 * operator chooses, a save dialog beginning in Downloads (main/convert/export-file.ts); never encoded again. Where it
 * went, or why not, is told as a notice; nothing is said when the dialog is closed.
 */
export async function exportMedia(mediaId: string): Promise<void> {
  try {
    const result = await window.drashti.media.exportFile(mediaId);
    if (!result.ok) useNotice.setState({ text: result.message, media: null });
    else if (result.path !== null) useNotice.setState({ text: exportedNotice(result.path), media: null });
  } catch {
    useNotice.setState({ text: 'Drashti could not export it. Try Export… again.', media: null });
  }
}
