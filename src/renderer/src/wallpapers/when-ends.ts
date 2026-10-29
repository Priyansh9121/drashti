import { useEffect, useState } from 'react';
import type { EngineState } from '../../../shared/engine/state';
import { playbackLeftMs } from '../../../shared/media';
import type { WhenEnds } from '../../../shared/wallpapers';
import {
  DEFAULT_WHEN_ENDS,
  inLastSeconds,
  LAST_SECONDS_MS,
  WHEN_ENDS,
  WHEN_ENDS_NAMES,
} from '../../../shared/wallpapers';
import { useEngine } from '../engine/engine-store';
import type { FileTarget } from '../files/file-menu';
import { addFileMenuItems } from '../files/file-menu';
import { pushRemoval } from '../library/undo';
import { useNotice } from '../operator/actions';
import { usePlaylists } from '../playlists/playlist-store';
import { engineNow } from '../render/clock';
import type { MenuEntry } from '../ui/Menu';

/*
 * When a video ends (Session 55, Part 6, A): in each video's row's menu (the one right-click menu, Part 14), Wallpaper
 * (the default), Next item, Loop or Freeze, ticked as the row has it, kept per row with Undo. And a video's last 10
 * seconds (E): its row and the time under LIVE turn amber (the stage shows the time left: render/StageEndsIn.tsx).
 */

/** A row's When it ends, as the open playlist has it. */
function whenEndsOf(itemId: string): WhenEnds | null {
  const item = usePlaylists.getState().items.find((i) => i.id === itemId);
  return item?.kind === 'media' && item.media === 'video' ? (item.whenEnds ?? DEFAULT_WHEN_ENDS) : null;
}

/** Set a row's When it ends, with Undo. */
export async function setWhenEnds(itemId: string, name: string, to: WhenEnds): Promise<void> {
  const was = whenEndsOf(itemId) ?? DEFAULT_WHEN_ENDS;
  if (was === to) return;
  const done = await window.drashti.playlists.setWhenEnds(itemId, to);
  if (!done.ok) {
    useNotice.setState({ text: done.message });
    return;
  }
  pushRemoval({
    text: `“${name}” when it ends: ${WHEN_ENDS_NAMES[to]}`,
    restore: async () => {
      await window.drashti.playlists.setWhenEnds(itemId, was);
    },
  });
}

/** The menu's choices for a video's row in a playlist: the four, the row's ticked. None for anything else. */
export function whenEndsEntries(target: FileTarget): MenuEntry[] {
  if (target.kind !== 'video' || target.place !== 'playlist' || target.itemId === undefined) return [];
  const itemId = target.itemId;
  const now = whenEndsOf(itemId);
  if (now === null) return [];
  return WHEN_ENDS.map((w) => ({
    label: `When it ends: ${WHEN_ENDS_NAMES[w]}`,
    checked: w === now,
    onSelect: () => void setWhenEnds(itemId, target.name, w),
  }));
}

let added = false;

/** Put the choices in the one menu (once for the window). */
export function addWhenEndsToMenu(): void {
  if (added) return;
  added = true;
  addFileMenuItems(whenEndsEntries);
}

/**
 * The video on the screens in its last 10 seconds (E), and which playlist row it came from: its time left (ms), or
 * null when no video is (none up, going round, paused at more than 10 s, not yet known how long, or played out).
 */
export function lastSecondsOf(
  state: EngineState | null | undefined,
  now: number,
): { leftMs: number; itemId: string | null } | null {
  const bg = state?.layers.background;
  if (bg?.kind !== 'media' || bg.media !== 'video' || bg.loop) return null;
  if (bg.durationMs === undefined || bg.durationMs <= 0) return null;
  const leftMs = playbackLeftMs(bg, bg.durationMs, now);
  if (!inLastSeconds(leftMs)) return null;
  const live = state?.live;
  const itemId = live?.presentationId === null ? (live.playlist?.itemId ?? null) : null;
  return { leftMs, itemId };
}

/**
 * The playlist row whose video is in its last 10 seconds now (E), or null: drawn again only as that changes (the video
 * coming into its last seconds, or ending), never several times a second, so a long playlist stays light.
 */
export function useLastSecondsRow(): string | null {
  const state = useEngine((s) => s.state);
  const [, redraw] = useState(0);
  const last = lastSecondsOf(state, engineNow());
  useEffect(() => {
    const bg = state?.layers.background;
    if (bg?.kind !== 'media' || bg.media !== 'video' || bg.loop || bg.seek?.paused === true) return;
    if (bg.durationMs === undefined || bg.durationMs <= 0) return;
    const left = playbackLeftMs(bg, bg.durationMs, engineNow());
    if (left <= 0) return;
    const wait = left > LAST_SECONDS_MS ? left - LAST_SECONDS_MS : left;
    const timer = setTimeout(() => {
      redraw((n) => n + 1);
    }, wait + 20);
    return () => {
      clearTimeout(timer);
    };
  });
  return last?.itemId ?? null;
}
