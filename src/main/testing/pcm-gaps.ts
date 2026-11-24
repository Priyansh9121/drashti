/*
 * The stream's PCM through a long drawing frame (tests/e2e/video-cue-audio-queue.spec.ts): how long the encoder waited
 * for sound while that frame ran, which is what the test claims ("the encoder receives sound through the long drawing
 * frame"). Until alpha.22's gate 3 it timed every wait from the watch's start, 20-50 ms before the frame: on CI's Mac (no
 * sound device: the output paced by a software timer) one delivery came 12 ms late there (a 35.2 ms wait ending 11 ms
 * before the frame began, attempt 3 of run 45449968552), with every wait in the frame 20.0-23.8 ms.
 */

/** One PCM delivery as the encoder's stand-in saw it: the wall clock (to place it) and its own steady clock (to time). */
export interface PcmDelivery {
  wall: number;
  mono: number;
}

/**
 * The longest wait between two deliveries (the last one may be the end of the watch) that overlaps the long frame,
 * `from` to `to` on the wall clock: any part of it inside, counted whole on the steady clock. The wall clock is whole
 * milliseconds, so a wait that touches the frame in the same millisecond counts too: the judged window is never
 * narrower than the frame. It fails closed: no frame (a missing or reversed window) or fewer than two deliveries is an
 * error, never a pass.
 */
export function longestPcmWait(deliveries: readonly PcmDelivery[], from: number, to: number): number {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from)
    throw new Error(`No long frame to judge the PCM by (from ${String(from)} to ${String(to)})`);
  if (deliveries.length < 2)
    throw new Error(`Too few PCM deliveries to judge (${String(deliveries.length)})`);
  let longest = 0;
  for (let i = 1; i < deliveries.length; i++) {
    const a = deliveries[i - 1],
      b = deliveries[i];
    if (a && b && b.wall >= from && a.wall <= to) longest = Math.max(longest, b.mono - a.mono);
  }
  return longest;
}
