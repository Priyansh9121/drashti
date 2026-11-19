import { create } from 'zustand';
import type { YouTubeBroadcast, YouTubeStatus } from '../../../shared/youtube';

/*
 * YouTube as the operator window sees it (x31): whether a sign-in client is kept and who is signed in (never a token
 * or a key: the main process keeps those), each profile's broadcast, the channel's coming broadcasts when asked, and
 * what YouTube last said of the broadcast while on air.
 */

interface YouTubeStore {
  status: YouTubeStatus | null;
  /** The channel's coming broadcasts, as last asked (null: not asked yet). */
  broadcasts: YouTubeBroadcast[] | null;
  /** A request is out (each button waits for it). */
  busy: boolean;
}

export const useYouTube = create<YouTubeStore>(() => ({ status: null, broadcasts: null, busy: false }));

let connected = false;

/** Follow YouTube's state from the main process (once per window). */
export function connectYouTube(): void {
  if (connected) return;
  connected = true;
  window.drashti.youtube.onChanged((status) => {
    useYouTube.setState({ status });
  });
  void window.drashti.youtube.status().then((status) => {
    useYouTube.setState({ status });
  });
}

/** Run a YouTube request: its status kept, and its refusal (in plain words) handed back. */
export async function youtubeAction<
  T extends { ok: true; status: YouTubeStatus } | { ok: false; message: string },
>(run: () => Promise<T>): Promise<T> {
  useYouTube.setState({ busy: true });
  try {
    const result = await run();
    if (result.ok) useYouTube.setState({ status: result.status });
    return result;
  } finally {
    useYouTube.setState({ busy: false });
  }
}

/** Ask for the channel's coming broadcasts again. */
export async function loadUpcoming(): Promise<void> {
  const result = await youtubeAction(() => window.drashti.youtube.upcoming());
  if (result.ok) useYouTube.setState({ broadcasts: result.broadcasts });
}
