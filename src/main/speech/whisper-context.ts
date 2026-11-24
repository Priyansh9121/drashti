/*
 * QWC-1 (the owner's call, waits for his answer): whisper's audio context sized to the piece, with the temperature
 * fallback off, ONLY for a CPU whisper engine with a small model. Whisper reads 30 s of sound for every answer however
 * short the piece; a context sized to the piece reads less. Measured on CI's Windows (runs 45400846089 and 45408618411,
 * 4 processors): answers 2.6-3x faster (Hindi 2.09 s against 5.80 s), the words no worse on the clips shown in both,
 * nothing made up on silence, noise or hum. Turbo looped on noise at 512 (cap-whisper-ctx), so it keeps 1500, and a
 * Mac's engine asks for the GPU (Metal), fast enough at 1500: both send today's request exactly.
 */

/** whisper's audio context for a piece of `samples` (16 kHz): its 20 ms steps rounded up to 64, from 512 to 1500. */
export function audioContextFor(samples: number): number {
  return Math.min(1500, Math.max(512, Math.ceil(samples / 320 / 64) * 64));
}

/**
 * Whether a whisper engine sizes its audio context: a CPU engine (Windows' whisper-server, a CPU build) with a small
 * model, the general small (Standard) or a tuned small language model. Never turbo or a medium model, never a Mac.
 */
export function sizesContext(platform: NodeJS.Platform, model: string): boolean {
  return platform === 'win32' && (model === 'small' || /(^|-)small(-|$)/u.test(model));
}
