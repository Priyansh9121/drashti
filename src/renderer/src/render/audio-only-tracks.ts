/** An audio element must not spend decoder time on pictures its sound player never displays. */
export function audioOnlyTracks(audio: HTMLMediaElement): boolean {
  // Existing behaviour, extracted for its decoder-selection red.
  return audio.tagName !== 'AUDIO';
}
