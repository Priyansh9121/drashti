/*
 * FFmpeg's command line and its messages carry the stream key in the
 * address it sends to. Everything FFmpeg says, and every address, goes
 * through here before it is logged or shown.
 */

export const HIDDEN_KEY = '[stream key]';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** Any rtmp(s) address keeps its host and first folder; the rest (where the key goes) is hidden. */
const RTMP_URL = /\b(rtmps?:\/\/[^\s/'"]+\/[^\s/'"]*)\/[^\s'":,;)]+/giu;

/** The text with every known key, and the key part of any RTMP address, hidden. */
export function redact(text: string, keys: readonly string[] = []): string {
  let out = text.replace(RTMP_URL, `$1/${HIDDEN_KEY}`);
  for (const key of keys) {
    if (key.length < 4) continue;
    for (const form of new Set([key, encodeURIComponent(key)]))
      out = out.replace(new RegExp(escape(form), 'gu'), HIDDEN_KEY);
  }
  return out;
}

/** The address to show: the ingest without the key. */
export function safeAddress(url: string): string {
  return redact(url);
}
