import { create } from 'zustand';
import { STREAM_LINK_OFF, type StreamLinkStatus } from '../../../shared/live-link';

/*
 * Show a Stream Link… (alpha.20, the playback set's slice 8) in the operator window: its window (from its section under
 * LIVE and Tools, Pro Mode), and how the stream link stands, for the notice under the header (connecting, up, reconnecting, the
 * Wallpaper while it is gone, ended).
 */

interface StreamLinkUi {
  open: boolean;
  status: StreamLinkStatus;
}

export const useStreamLinkUi = create<StreamLinkUi>(() => ({ open: false, status: STREAM_LINK_OFF }));

let connected = false;

/** Follow how the stream link stands (once, as the operator window opens). */
export function connectStreamLink(): void {
  if (connected) return;
  connected = true;
  window.drashti.liveLink.onChanged((status) => {
    useStreamLinkUi.setState({ status });
  });
  void window.drashti.liveLink.status().then((status) => {
    useStreamLinkUi.setState({ status });
  });
}

export function openStreamLink(): void {
  useStreamLinkUi.setState({ open: true });
}

export function closeStreamLink(): void {
  useStreamLinkUi.setState({ open: false });
}
