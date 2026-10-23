/**
 * Live-board smoke: compile is the caller's job (npm run smoke:live).
 * Asserts cursor/claude/dsh scan arrays, and scripts/board/ exposes
 * SSE /api/events, in-progress chip, default port 3922.
 * Does not bind a port.
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { scanSessions } = require("../dist/scanSessions.js");
const { scanClaudeSessions } = require("../dist/harness/claudeScan.js");
const { scanDshSessions } = require("../dist/harness/dshScan.js");
const { collectInProgressSessions, ACTIVE_WINDOW_MS } = require("../dist/inProgressSessions.js");
const { scanAllSessions } = require("../dist/scanAll.js");

function readBoardSources() {
  const boardDir = path.join(root, "scripts", "board");
  const mediaBoard = path.join(root, "media", "board");
  const files = [
    path.join(boardDir, "index.mjs"),
    path.join(boardDir, "httpApp.mjs"),
    path.join(boardDir, "page.mjs"),
    path.join(boardDir, "watch.mjs"),
    path.join(boardDir, "paths.mjs"),
    path.join(mediaBoard, "app.js"),
    path.join(mediaBoard, "board.css"),
  ];
  for (const f of files) {
    if (!fs.existsSync(f)) {
      console.error("FAIL: missing", path.relative(root, f));
      process.exit(1);
    }
  }
  return files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
}

const cursorGroups = scanSessions();
if (!Array.isArray(cursorGroups)) {
  console.error("FAIL: scanSessions did not return an array");
  process.exit(1);
}

let claudeGroups;
try {
  claudeGroups = scanClaudeSessions();
} catch (err) {
  console.error("FAIL: scanClaudeSessions threw", err);
  process.exit(1);
}
if (!Array.isArray(claudeGroups)) {
  console.error("FAIL: scanClaudeSessions did not return an array");
  process.exit(1);
}

let dshGroups;
try {
  dshGroups = scanDshSessions();
} catch (err) {
  console.error("FAIL: scanDshSessions threw", err);
  process.exit(1);
}
if (!Array.isArray(dshGroups)) {
  console.error("FAIL: scanDshSessions did not return an array");
  process.exit(1);
}

for (const g of cursorGroups) {
  for (const s of g.sessions || []) {
    if (s.harness !== "cursor") {
      console.error("FAIL: cursor session missing harness", s.filePath);
      process.exit(1);
    }
    if (!["active", "idle", "stale"].includes(s.liveStatus)) {
      console.error("FAIL: cursor session missing liveStatus", s.filePath);
      process.exit(1);
    }
  }
}
for (const g of claudeGroups) {
  for (const s of g.sessions || []) {
    if (s.harness !== "claude") {
      console.error("FAIL: claude session missing harness", s.filePath);
      process.exit(1);
    }
    if (!s.id) {
      console.error("FAIL: claude session missing id", s.filePath);
      process.exit(1);
    }
  }
}
for (const g of dshGroups) {
  for (const s of g.sessions || []) {
    if (s.harness !== "dsh") {
      console.error("FAIL: dsh session missing harness", s.filePath);
      process.exit(1);
    }
    if (!s.id) {
      console.error("FAIL: dsh session missing id", s.filePath);
      process.exit(1);
    }
  }
}

const allGroups = scanAllSessions();
const inProg = collectInProgressSessions(allGroups, "all");
if (!Array.isArray(inProg)) {
  console.error("FAIL: collectInProgressSessions did not return an array");
  process.exit(1);
}
for (const s of inProg) {
  if (s.liveStatus !== "active") {
    console.error("FAIL: in-progress row not active", s.filePath);
    process.exit(1);
  }
}

const serverSrc = readBoardSources();
if (!serverSrc.includes("/api/sessions/in-progress")) {
  console.error("FAIL: /api/sessions/in-progress missing from scripts/board/");
  process.exit(1);
}
if (!serverSrc.includes("chip-inprogress") || !serverSrc.includes("正在进行中")) {
  console.error("FAIL: 正在进行中 chip missing from scripts/board/ or media/board/");
  process.exit(1);
}
if (!serverSrc.includes('"/api/events"') && !serverSrc.includes("'/api/events'")) {
  console.error("FAIL: SSE route /api/events missing from scripts/board/");
  process.exit(1);
}
if (!serverSrc.includes("text/event-stream")) {
  console.error("FAIL: text/event-stream missing from scripts/board/");
  process.exit(1);
}
if (!serverSrc.includes("3922")) {
  console.error("FAIL: default port 3922 missing from scripts/board/");
  process.exit(1);
}
if (serverSrc.includes(">file</span>") || /insight-kv[\s\S]*?<span>file<\/span>/.test(serverSrc)) {
  // Insight Session must not show file/preview rows (P0).
  const appJs = fs.readFileSync(path.join(root, "media", "board", "app.js"), "utf8");
  if (appJs.includes("<span>file</span>") || appJs.includes("<span>preview</span>")) {
    console.error("FAIL: Insight Session still renders file/preview KV");
    process.exit(1);
  }
}
{
  const appJs = fs.readFileSync(path.join(root, "media", "board", "app.js"), "utf8");
  if (!appJs.includes("step ·") || appJs.includes("model · ${")) {
    console.error("FAIL: Insight timeline should label assistant kids as step · n");
    process.exit(1);
  }
  if (!appJs.includes("insight-model") || !appJs.includes("modelDotColor")) {
    console.error("FAIL: Insight model swatch / color helper missing");
    process.exit(1);
  }
}
{
  const { parseDshTranscriptFile, dshSessionsRoot } = require("../dist/harness/dshScan.js");
  const { parseClaudeTranscriptFile, claudeProjectsRoot } = require("../dist/harness/claudeScan.js");
  const fs2 = fs;
  const dshRoot = dshSessionsRoot();
  const dshCandidates = [];
  function walk(dir, depth) {
    if (depth > 6) return;
    let ents;
    try {
      ents = fs2.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/^session(?:\.v\d+)?\.jsonl(\.zstd)?$/i.test(e.name)) {
        try {
          dshCandidates.push({ p, size: fs2.statSync(p).size });
        } catch {
          /* skip */
        }
      }
    }
  }
  if (fs2.existsSync(dshRoot)) walk(dshRoot, 0);
  dshCandidates.sort((a, b) => b.size - a.size);
  const dshFile = dshCandidates[0]?.p;
  if (dshFile) {
    const sess = parseDshTranscriptFile(dshFile);
    if (!sess.summary.primaryModel) {
      console.error("FAIL: DSH session missing primaryModel", dshFile);
      process.exit(1);
    }
    const withModel = (sess.turns || []).filter((t) => t.modelId);
    if (!withModel.length) {
      console.error("FAIL: DSH turns missing modelId", dshFile);
      process.exit(1);
    }
  }
  const claudeRoot = claudeProjectsRoot();
  const claudeCandidates = [];
  function walkC(dir, depth) {
    if (depth > 4) return;
    let ents;
    try {
      ents = fs2.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walkC(p, depth + 1);
      else if (e.name.endsWith(".jsonl")) {
        try {
          claudeCandidates.push({ p, size: fs2.statSync(p).size });
        } catch {
          /* skip */
        }
      }
    }
  }
  if (fs2.existsSync(claudeRoot)) walkC(claudeRoot, 0);
  claudeCandidates.sort((a, b) => b.size - a.size);
  const claudeFile = claudeCandidates[0]?.p;
  if (claudeFile) {
    const sess = parseClaudeTranscriptFile(claudeFile);
    // Some tiny/synthetic-only journals may lack models; only assert when data exists.
    const hasModelField = (sess.turns || []).some(
      (t) => t.modelId || (t.steps || []).some((s) => s.modelId)
    );
    if (hasModelField && !sess.summary.primaryModel) {
      console.error("FAIL: Claude session has step models but no primaryModel", claudeFile);
      process.exit(1);
    }
  }
}

const cursorSessions = cursorGroups.reduce((n, g) => n + (g.sessions ? g.sessions.length : 0), 0);
const claudeSessions = claudeGroups.reduce((n, g) => n + (g.sessions ? g.sessions.length : 0), 0);
const dshSessions = dshGroups.reduce((n, g) => n + (g.sessions ? g.sessions.length : 0), 0);

console.log(
  JSON.stringify(
    {
      ok: true,
      cursorGroups: cursorGroups.length,
      cursorSessions,
      claudeGroups: claudeGroups.length,
      claudeSessions,
      dshGroups: dshGroups.length,
      dshSessions,
      inProgress: inProg.length,
      activeWindowMs: ACTIVE_WINDOW_MS,
      sse: true,
      defaultPort: 3922,
    },
    null,
    2
  )
);
