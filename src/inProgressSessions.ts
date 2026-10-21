/**
 * In-progress (正在进行中) view — decoupled from drive/dir tree grouping.
 * A session is "in progress" when its transcript mtime is within ACTIVE_WINDOW_MS.
 */
import { ACTIVE_WINDOW_MS, liveStatusFromMtime } from "./liveStatus";
import type { HarnessId, SessionSummary } from "./parser/types";
import type { ProjectGroup } from "./scanSessions";

export { ACTIVE_WINDOW_MS };

export function isInProgressSession(
  s: Pick<SessionSummary, "mtimeMs" | "liveStatus">,
  now = Date.now()
): boolean {
  if (Number.isFinite(s.mtimeMs)) {
    return liveStatusFromMtime(s.mtimeMs, now) === "active";
  }
  return s.liveStatus === "active";
}

export interface InProgressRow extends SessionSummary {
  /** Project label from its group (tree view unused). */
  groupLabel: string;
}

/**
 * Flatten all groups → in-progress sessions only, newest first.
 * Optional harness filter (all | cursor | claude | dsh) stays orthogonal to tree mode.
 */
export function collectInProgressSessions(
  groups: ProjectGroup[],
  harnessFilter: "all" | HarnessId = "all",
  now = Date.now()
): InProgressRow[] {
  const out: InProgressRow[] = [];
  for (const g of groups || []) {
    for (const s of g.sessions || []) {
      if (harnessFilter !== "all" && s.harness !== harnessFilter) {
        continue;
      }
      if (!isInProgressSession(s, now)) {
        continue;
      }
      out.push({
        ...s,
        liveStatus: "active",
        groupLabel: g.projectLabel || g.projectKey || "",
      });
    }
  }
  out.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
  return out;
}
