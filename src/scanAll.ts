import { scanClaudeSessions } from "./harness/claudeScan";
import { scanDshSessions } from "./harness/dshScan";
import type { ProjectGroup } from "./scanSessions";
import { scanSessions } from "./scanSessions";

/** Combine harness scans. Same projectKey (rare across encodings) shares one group. */
export function mergeProjectGroups(parts: ProjectGroup[][]): ProjectGroup[] {
  const map = new Map<string, ProjectGroup>();
  for (const groups of parts) {
    for (const g of groups) {
      const prev = map.get(g.projectKey);
      if (!prev) {
        map.set(g.projectKey, {
          projectKey: g.projectKey,
          projectLabel: g.projectLabel,
          sessions: [...g.sessions],
        });
        continue;
      }
      prev.sessions.push(...g.sessions);
      prev.sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
    }
  }
  const out = [...map.values()];
  out.sort((a, b) => (b.sessions[0]?.mtimeMs ?? 0) - (a.sessions[0]?.mtimeMs ?? 0));
  return out;
}

export function scanAllSessions(): ProjectGroup[] {
  let claude: ProjectGroup[] = [];
  try {
    claude = scanClaudeSessions();
  } catch {
    claude = [];
  }
  let cursor: ProjectGroup[] = [];
  try {
    cursor = scanSessions();
  } catch {
    cursor = [];
  }
  let dsh: ProjectGroup[] = [];
  try {
    dsh = scanDshSessions();
  } catch {
    dsh = [];
  }
  return mergeProjectGroups([cursor, claude, dsh]);
}
