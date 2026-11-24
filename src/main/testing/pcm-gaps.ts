/*
 * The stream's PCM through a long drawing frame (tests/e2e/video-cue-audio-queue.spec.ts): how long the encoder waited
 * for sound while that frame ran. Placeholder until its rule lands (the owner's call, alpha.22 gate 3).
 */

/** One PCM delivery as the encoder's stand-in saw it: the wall clock (to place it) and its own steady clock (to time). */
export interface PcmDelivery {
  wall: number;
  mono: number;
}

/** The longest wait between two deliveries (the last one the end of the watch). Nothing placed yet. */
export function longestPcmWait(deliveries: readonly PcmDelivery[], _from: number, _to: number): number {
  let longest = 0;
  for (let i = 1; i < deliveries.length; i++) {
    const a = deliveries[i - 1],
      b = deliveries[i];
    if (a && b) longest = Math.max(longest, b.mono - a.mono);
  }
  return longest;
}
