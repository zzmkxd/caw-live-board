import type { SessionSummary, UserTurn } from "./types";

/**
 * Fill summary.primaryModel from turn/step modelIds.
 * Prefer last non-empty resolved id; flag modelMulti when >1 distinct.
 */
export function applySessionModels(
  summary: SessionSummary,
  turns: UserTurn[],
  opts?: { selectionFallback?: string }
): void {
  const ids: string[] = [];
  for (const t of turns) {
    if (t.modelId) {
      ids.push(t.modelId);
    }
    for (const step of t.steps || []) {
      if (step.modelId) {
        ids.push(step.modelId);
      }
    }
  }
  const uniq = [...new Set(ids.filter((x) => x && x.trim()))];
  if (uniq.length) {
    summary.primaryModel = uniq[uniq.length - 1];
    summary.modelMulti = uniq.length > 1;
  } else if (opts?.selectionFallback) {
    summary.primaryModel = opts.selectionFallback;
  }
  if (opts?.selectionFallback) {
    summary.modelSelection = opts.selectionFallback;
  }
}
