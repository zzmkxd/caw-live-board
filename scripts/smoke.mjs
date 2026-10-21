/**
 * Offline smoke: scan + parse real transcripts. No network.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { parseTranscriptFile, summarizeTranscriptFile } = require("../dist/parser/parseTranscript.js");
const { scanSessions } = require("../dist/scanSessions.js");

const root = path.join(os.homedir(), ".cursor", "projects");
if (!fs.existsSync(root)) {
  console.error("FAIL: missing", root);
  process.exit(1);
}

const t0 = Date.now();
const groups = scanSessions();
const scanMs = Date.now() - t0;
if (!groups.length) {
  console.error("FAIL: scanSessions returned 0 projects");
  process.exit(1);
}

let sessions = 0;
for (const g of groups) sessions += g.sessions.length;

const sample = groups[0].sessions[0];
const sum = summarizeTranscriptFile(sample.filePath);
const parsed = parseTranscriptFile(sample.filePath);

if (!parsed.turns.length) {
  console.error("FAIL: parse produced 0 turns for", sample.filePath);
  process.exit(1);
}

let tools = 0;
for (const t of parsed.turns) {
  for (const s of t.steps) tools += s.tools.length;
}

console.log(
  JSON.stringify(
    {
      ok: true,
      projectsRoot: root,
      projectCount: groups.length,
      sessionCount: sessions,
      scanMs,
      sample: {
        file: sample.filePath,
        summaryPreview: sum.preview,
        turns: parsed.turns.length,
        tools,
        firstTool: parsed.turns.flatMap((t) => t.steps.flatMap((s) => s.tools.map((x) => x.name)))[0] || null,
      },
    },
    null,
    2
  )
);
