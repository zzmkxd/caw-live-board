import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { summarizeTranscriptFile } from "./parser/parseTranscript";
import type { SessionSummary } from "./parser/types";

export interface ProjectGroup {
  projectKey: string;
  projectLabel: string;
  sessions: SessionSummary[];
}

export function projectsRoot(): string {
  return path.join(os.homedir(), ".cursor", "projects");
}

function safeReadDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Scan `%USERPROFILE%\.cursor\projects\*\agent-transcripts\*\*.jsonl` (read-only). */
export function scanSessions(): ProjectGroup[] {
  const root = projectsRoot();
  if (!isDir(root)) {
    return [];
  }

  const groups: ProjectGroup[] = [];

  for (const projectKey of safeReadDir(root)) {
    const transcriptsDir = path.join(root, projectKey, "agent-transcripts");
    if (!isDir(transcriptsDir)) {
      continue;
    }

    const sessions: SessionSummary[] = [];
    for (const sessionDirName of safeReadDir(transcriptsDir)) {
      const sessionDir = path.join(transcriptsDir, sessionDirName);
      if (!isDir(sessionDir)) {
        if (sessionDirName.endsWith(".jsonl")) {
          try {
            sessions.push(summarizeTranscriptFile(sessionDir));
          } catch {
            /* skip bad file */
          }
        }
        continue;
      }
      for (const file of safeReadDir(sessionDir)) {
        if (!file.endsWith(".jsonl")) {
          continue;
        }
        const filePath = path.join(sessionDir, file);
        try {
          sessions.push(summarizeTranscriptFile(filePath));
        } catch {
          /* skip */
        }
      }
    }

    if (sessions.length === 0) {
      continue;
    }

    sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
    groups.push({
      projectKey,
      projectLabel: sessions[0].projectLabel || projectKey,
      sessions,
    });
  }

  groups.sort((a, b) => {
    const am = a.sessions[0]?.mtimeMs ?? 0;
    const bm = b.sessions[0]?.mtimeMs ?? 0;
    return bm - am;
  });

  return groups;
}
