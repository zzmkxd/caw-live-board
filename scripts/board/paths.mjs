import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { dshSessionsRoot } = require("../../dist/harness/dshScan.js");

export function homeDir() {
  return process.env.USERPROFILE || process.env.HOME || os.homedir();
}

export function harnessRoots() {
  const home = homeDir();
  let dshRoot;
  try {
    dshRoot = dshSessionsRoot();
  } catch {
    dshRoot = path.resolve(home, ".dsh", "sessions");
  }
  return {
    cursor: path.resolve(home, ".cursor", "projects"),
    claude: path.resolve(home, ".claude", "projects"),
    dsh: path.resolve(dshRoot),
  };
}

export function isUnder(resolved, rootDir) {
  const file = path.resolve(resolved).toLowerCase();
  const root = path.resolve(rootDir).toLowerCase();
  return file === root || file.startsWith(root + path.sep);
}

export function isSessionLog(resolved) {
  const lower = resolved.toLowerCase();
  return lower.endsWith(".jsonl") || lower.endsWith(".jsonl.zstd");
}

export function harnessForPath(resolved) {
  const roots = harnessRoots();
  if (isUnder(resolved, roots.dsh)) return "dsh";
  if (isUnder(resolved, roots.claude)) return "claude";
  if (isUnder(resolved, roots.cursor)) return "cursor";
  return null;
}
