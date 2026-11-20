import { create } from 'zustand';
import type { M3uNotTaken } from '../../../shared/m3u';
import { useNotice } from '../operator/actions';
import { Dialog } from '../ui/Dialog';
import { loadTree, openPlaylist } from './playlist-store';
import { useMusic } from '../music/music-store';

const useM3uReport = create<{ audio: boolean; entries: M3uNotTaken[] | null }>(() => ({
  audio: false,
  entries: null,
}));

export async function importPlaylistFile(audio = false, targetId: string | null = null): Promise<void> {
  try {
    const result = await window.drashti.playlists.importM3u(audio, targetId);
    if (!result.ok) {
      useNotice.setState({ text: result.message });
      return;
    }
    if (result.id) {
      if (audio) useMusic.setState({ view: await window.drashti.music.view(), shownId: result.id });
      else {
        await loadTree();
        await openPlaylist(result.id);
      }
    }
    if (result.notTaken.length) useM3uReport.setState({ audio, entries: result.notTaken });
    else if (result.id) useNotice.setState({ text: 'Playlist file imported.' });
  } catch {
    useNotice.setState({ text: 'The playlist file could not be imported. Try it again.' });
  }
}

export async function exportPlaylistFile(playlistId: string, audio = false): Promise<void> {
  try {
    const result = await window.drashti.playlists.exportM3u(playlistId, audio);
    if (!result.ok) useNotice.setState({ text: result.message });
  } catch {
    useNotice.setState({ text: 'The playlist file could not be exported. Try it again.' });
  }
}

export function M3uReport({ audio = false }: { audio?: boolean }) {
  const report = useM3uReport();
  if (!report.entries || report.audio !== audio) return null;
  return (
    <Dialog
      title="Playlist file: entries not taken"
      closeLabel="Close playlist file report"
      onClose={() => {
        useM3uReport.setState({ entries: null });
      }}
      bodyFocusable
    >
      <p className="mb-3 text-sm text-muted">
        Local files were imported in their file order. Web addresses were not fetched.
      </p>
      <ul className="space-y-3 text-sm" data-testid="m3u-not-taken">
        {report.entries.map((entry, index) => (
          <li key={index} className="break-words">
            <p className="font-medium">{entry.entry}</p>
            <p className="text-muted">{entry.reason}</p>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
