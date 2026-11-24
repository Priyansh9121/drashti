import { useNotice } from '../operator/actions';
import { plural } from '../ui/text';

/*
 * The open playlist's running order (alpha.22), from its ⋯ (Pro Mode's): Copy running order. The main process makes
 * it from the playlist's rows and writes the clipboard (main/running-order.ts); what happened shows as a notice.
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
