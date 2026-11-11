import { MusicStepsAside } from '../sound/MusicStepsAside';
import { PanelGroup } from '../ui/Panel';
import { Music } from '../ui/icons';
import { AudioAddMenu, MusicPanel } from './MusicPanel';

/*
 * Audio in the live column (Session 26a's group: the audio playlists, Session 55's Part 13; Music steps aside, Part
 * 7), one part for both modes: Pro Mode's under LIVE, and Simple Mode's in the same place since Session 56 (the owner:
 * "The Audio panel on the right, under LIVE and above Black-out… build nothing new for it, just make it reachable").
 * Its changes go through Simple Mode's guards on Main (main/simple-mode.ts), within their bounds.
 */
export function AudioGroup({ platform }: { platform: string }) {
  return (
    <PanelGroup
      title="Audio"
      icon={Music}
      remember="audio"
      help="audio"
      actions={<AudioAddMenu />}
      data-testid="audio-group"
    >
      <MusicPanel platform={platform} />
      {/* Music steps aside under a video with sound (Session 55, Part 7). */}
      <MusicStepsAside />
    </PanelGroup>
  );
}
