import type { LiveStatus } from "./parser/types";

/** mtime within this window → active. */
export const ACTIVE_WINDOW_MS = 2 * 60 * 1000;
/** mtime within this window (and outside active) → idle. Older → stale. */
export const IDLE_WINDOW_MS = 30 * 60 * 1000;

export function liveStatusFromMtime(mtimeMs: number, now = Date.now()): LiveStatus {
  const age = now - (Number.isFinite(mtimeMs) ? mtimeMs : 0);
  if (age <= ACTIVE_WINDOW_MS) {
    return "active";
  }
  if (age <= IDLE_WINDOW_MS) {
    return "idle";
  }
  return "stale";
}
