/*
 * A playlist's running order (alpha.22): Copy running order, Print running order… and Save running order as PDF… in
 * the open playlist's ⋯ (Pro Mode's). The main process makes it from the playlist's rows (src/main/running-order.ts).
 */

/** How Copy running order went: its numbered rows on the clipboard, or why not. */
export type RunningOrderCopied = { ok: true; rows: number } | { ok: false; message: string };
