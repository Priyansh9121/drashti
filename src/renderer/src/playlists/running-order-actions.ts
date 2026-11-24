import { savedWhere } from '../../../shared/manual';
import { useNotice } from '../operator/actions';
import { plural } from '../ui/text';

/*
 * The open playlist's running order (alpha.22), from its ⋯ (Pro Mode's): Copy running order, Print running order…
 * and Save running order as PDF…. The main process makes it from the playlist's rows, writes the clipboard, and prints
 * it from a hidden window as the manual is, never while the show is live (main/running-order.ts); what happened shows
 * as a notice.
 */

/** Its plain lines on the clipboard, for the sabha team's group chat. */
export async function copyRunningOrder(playlistId: string): Promise<void> {
  try {
    const result = await window.drashti.playlists.copyRunningOrder(playlistId);
    useNotice.setState({
      text: result.ok
        ? `Copied the running order (${plural(result.rows, 'row')}): paste it where you need it.`
        : result.message,
    });
  } catch {
    useNotice.setState({ text: 'The running order could not be copied: try again.' });
  }
}

/** Printed through the system's print dialog, or saved as a PDF where the person chooses. */
export async function printRunningOrder(playlistId: string, kind: 'print' | 'pdf'): Promise<void> {
  try {
    const result =
      kind === 'pdf'
        ? await window.drashti.playlists.saveRunningOrderPdf(playlistId)
        : await window.drashti.playlists.printRunningOrder(playlistId);
    if (result.ok)
      useNotice.setState({
        text: result.file
          ? `Saved the running order as a PDF: ${savedWhere(result.file)}.`
          : 'The running order went to the printer.',
      });
    else if (!result.cancelled) useNotice.setState({ text: result.message });
  } catch {
    useNotice.setState({
      text:
        kind === 'pdf'
          ? 'The running order was not made into a PDF: choose Save running order as PDF… again.'
          : 'The running order was not printed: choose Print running order… again.',
    });
  }
}
