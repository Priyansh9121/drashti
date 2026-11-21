interface VideoTracks {
  readonly length: number;
  readonly [index: number]: { selected: boolean };
}

/** An audio element must not spend decoder time on pictures its sound player never displays. */
export function audioOnlyTracks(audio: HTMLMediaElement): boolean {
  if (audio.tagName !== 'AUDIO') return true;
  const tracks = (audio as HTMLMediaElement & { videoTracks?: VideoTracks }).videoTracks;
  if (!tracks) return false;
  for (const track of Array.from(tracks)) {
    if (track.selected) track.selected = false;
  }
  return true;
}
