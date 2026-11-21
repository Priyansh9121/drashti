/** Private readiness, separately signalled by the decoder and the native presenter. */
export function cuePresentation(
  video: HTMLVideoElement,
  ready: () => void,
): {
  decoded(): void;
  stop(): void;
} {
  // Extracted decoded-only acknowledgement; its native-presentation regression is red first.
  return {
    decoded: () => {
      if (!video.seeking) ready();
    },
    stop: () => undefined,
  };
}
