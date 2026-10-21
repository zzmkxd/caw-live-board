import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { liveStatusFromMtime } from "../liveStatus";
import type {
  ModelStep,
  SessionSummary,
  ToolCallCard,
  UserTurn,
  WorkflowSession,
} from "../parser/types";
import type { ProjectGroup } from "../scanSessions";

const HEAD_BYTES = 64 * 1024;
const MAX_PARSE_BYTES = 8 * 1024 * 1024;
const MAX_DEPTH = 8;

interface ClaudeBlock {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: unknown;
  id?: string;
  content?: unknown;
}

interface ClaudeLine {
  type?: string;
  role?: string;
  isMeta?: boolean;
  timestamp?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
  content?: unknown;
}

export function claudeProjectsRoot(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function truncate(s: string, max = 80): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) {
    return t;
  }
  return t.slice(0, max - 1) + "…";
}

function extractTag(text: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i");
  const m = text.match(re);
  return m?.[1]?.trim() || undefined;
}

/** Claude encodes `C:\\Users\\...` as `C--Users-...` (colon and separators → `-`). */
export function claudeProjectLabel(projectKey: string): string {
  const drive = /^([A-Za-z])--(.*)$/.exec(projectKey);
  if (drive) {
    const rest = drive[2].replace(/-/g, "/");
    return rest ? `${drive[1]}/${rest}` : drive[1];
  }
  if (/^[A-Za-z]-/.test(projectKey)) {
    return projectKey.replace(/-/g, "/");
  }
  return projectKey;
}

function identity(filePath: string, root?: string): {
  abs: string;
  id: string;
  projectKey: string;
  projectLabel: string;
} {
  const abs = path.resolve(filePath);
  const base = root ?? claudeProjectsRoot();
  let rel = "";
  try {
    rel = path.relative(base, abs);
  } catch {
    rel = path.basename(abs);
  }
  if (rel.startsWith("..")) {
    rel = path.basename(abs);
  }
  const segs = rel.split(path.sep).filter(Boolean);
  const projectKey = segs.length > 1 ? segs[0] : "claude";
  return {
    abs,
    id: path.basename(abs, path.extname(abs)),
    projectKey,
    projectLabel: claudeProjectLabel(projectKey),
  };
}

function readHead(filePath: string, max = HEAD_BYTES): string {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(max);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.slice(0, n).toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

function asBlocks(content: unknown): ClaudeBlock[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  if (!Array.isArray(content)) {
    return [];
  }
  const blocks: ClaudeBlock[] = [];
  for (const item of content) {
    if (typeof item === "string") {
      blocks.push({ type: "text", text: item });
    } else if (item && typeof item === "object") {
      blocks.push(item as ClaudeBlock);
    }
  }
  return blocks;
}

function lineBlocks(obj: ClaudeLine): ClaudeBlock[] {
  if (obj.message && obj.message.content !== undefined) {
    return asBlocks(obj.message.content);
  }
  return asBlocks(obj.content);
}

function visibleText(blocks: ClaudeBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (!b || b.type === "thinking" || b.type === "tool_result" || b.type === "tool_use") {
      continue;
    }
    if (typeof b.text === "string" && b.text.trim()) {
      parts.push(b.text);
    }
  }
  return parts.join("\n").trim();
}

function roleOf(obj: ClaudeLine): "user" | "assistant" | undefined {
  const raw = obj.role || obj.type || obj.message?.role;
  if (raw === "user" || raw === "assistant") {
    return raw;
  }
  return undefined;
}

function userQueryText(obj: ClaudeLine): string | undefined {
  if (obj.isMeta) {
    return undefined;
  }
  const blocks = lineBlocks(obj);
  if (blocks.length > 0 && blocks.every((b) => b.type === "tool_result")) {
    return undefined;
  }
  const text = visibleText(blocks);
  if (!text) {
    return undefined;
  }
  return extractTag(text, "user_query") ?? text;
}

function toolCards(blocks: ClaudeBlock[], stepId: string): ToolCallCard[] {
  const cards: ToolCallCard[] = [];
  let i = 0;
  for (const b of blocks) {
    if (b.type !== "tool_use" || !b.name) {
      continue;
    }
    let inputJson = "{}";
    try {
      inputJson = JSON.stringify(b.input ?? {}, null, 2);
    } catch {
      inputJson = String(b.input);
    }
    cards.push({
      id: b.id || `${stepId}-tool-${i}`,
      name: b.name,
      inputJson,
    });
    i += 1;
  }
  return cards;
}

function parseLines(raw: string): ClaudeLine[] {
  const out: ClaudeLine[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) {
      continue;
    }
    try {
      out.push(JSON.parse(t) as ClaudeLine);
    } catch {
      /* partial tail or unknown line */
    }
  }
  return out;
}

function mtimeOf(abs: string): number {
  try {
    return fs.statSync(abs).mtimeMs;
  } catch {
    return 0;
  }
}

/** Light summary. Unknown layouts still return a row; this does not throw. */
export function summarizeClaudeFile(filePath: string, root?: string): SessionSummary {
  const idn = identity(filePath, root);
  const mtimeMs = mtimeOf(idn.abs);
  let preview: string | undefined;
  let timestamp: string | undefined;
  let turnCount = 0;
  try {
    for (const obj of parseLines(readHead(idn.abs))) {
      if (roleOf(obj) !== "user") {
        continue;
      }
      const query = userQueryText(obj);
      if (!query) {
        continue;
      }
      turnCount += 1;
      if (!preview) {
        preview = truncate(query, 80);
        if (obj.timestamp) {
          timestamp = obj.timestamp;
        }
      }
    }
  } catch {
    /* list the file anyway */
  }
  return {
    id: idn.id,
    projectKey: idn.projectKey,
    projectLabel: idn.projectLabel,
    filePath: idn.abs,
    mtimeMs,
    timestamp,
    preview,
    turnCount,
    harness: "claude",
    liveStatus: liveStatusFromMtime(mtimeMs),
  };
}

function emptyTurn(summary: SessionSummary): UserTurn {
  const text = summary.preview || "(claude transcript; format not fully parsed)";
  return {
    id: "turn-0",
    index: 0,
    timestamp: summary.timestamp,
    queryPreview: truncate(text, 100),
    queryText: text,
    steps: [],
  };
}

/**
 * Best-effort Claude Code JSONL → board session.
 * Recognizes `{type:user|assistant, message:{role,content}}` plus string content.
 * Anything else becomes a single placeholder turn instead of throwing.
 */
export function parseClaudeTranscriptFile(filePath: string): WorkflowSession {
  const summary = summarizeClaudeFile(filePath);
  try {
    let raw = "";
    try {
      const st = fs.statSync(summary.filePath);
      if (st.size > MAX_PARSE_BYTES) {
        raw = readHead(summary.filePath, MAX_PARSE_BYTES);
        summary.preview = summary.preview || "(large file; showing the head only)";
      } else {
        raw = fs.readFileSync(summary.filePath, "utf8");
      }
    } catch {
      return { summary, turns: [emptyTurn(summary)] };
    }

    const turns: UserTurn[] = [];
    let current: UserTurn | undefined;
    let turnIndex = 0;
    let stepIndex = 0;
    let firstTimestamp: string | undefined;
    let firstPreview: string | undefined;

    const ensureTurn = (query: string, timestamp?: string): UserTurn => {
      const turn: UserTurn = {
        id: `turn-${turnIndex}`,
        index: turnIndex,
        timestamp,
        queryPreview: truncate(query || "(no user message)", 100),
        queryText: query,
        steps: [],
      };
      turns.push(turn);
      turnIndex += 1;
      stepIndex = 0;
      return turn;
    };

    for (const obj of parseLines(raw)) {
      const role = roleOf(obj);
      if (!role) {
        continue;
      }
      if (role === "user") {
        const query = userQueryText(obj);
        if (!query) {
          continue;
        }
        if (!firstTimestamp && obj.timestamp) {
          firstTimestamp = obj.timestamp;
        }
        if (!firstPreview) {
          firstPreview = truncate(query, 80);
        }
        current = ensureTurn(query, obj.timestamp);
        continue;
      }

      if (!current) {
        current = ensureTurn("(no user message)");
      }
      const blocks = lineBlocks(obj);
      const text = visibleText(blocks);
      const stepId = `${current.id}-step-${stepIndex}`;
      const step: ModelStep = {
        id: stepId,
        index: stepIndex,
        textPreview: truncate(text, 160),
        text,
        tools: toolCards(blocks, stepId),
      };
      if (!step.text && step.tools.length === 0) {
        continue;
      }
      current.steps.push(step);
      stepIndex += 1;
    }

    summary.turnCount = turns.length || summary.turnCount;
    if (firstTimestamp) {
      summary.timestamp = firstTimestamp;
    }
    if (firstPreview) {
      summary.preview = firstPreview;
    }
    summary.liveStatus = liveStatusFromMtime(summary.mtimeMs);
    if (turns.length === 0) {
      return { summary, turns: [emptyTurn(summary)] };
    }
    return { summary, turns };
  } catch {
    return { summary, turns: [emptyTurn(summary)] };
  }
}

function walkJsonl(dir: string, out: string[], depth: number): void {
  if (depth > MAX_DEPTH) {
    return;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name === "." || ent.name === "..") {
      continue;
    }
    const p = path.join(dir, ent.name);
    try {
      if (ent.isSymbolicLink()) {
        continue;
      }
      if (ent.isDirectory()) {
        walkJsonl(p, out, depth + 1);
      } else if (ent.isFile() && ent.name.toLowerCase().endsWith(".jsonl")) {
        out.push(p);
      }
    } catch {
      /* skip unreadable entry */
    }
  }
}

/** Scan `~/.claude/projects/**\/*.jsonl`. Missing root → []. Never throws. */
export function scanClaudeSessions(): ProjectGroup[] {
  try {
    const root = claudeProjectsRoot();
    if (!isDir(root)) {
      return [];
    }
    const files: string[] = [];
    walkJsonl(root, files, 0);
    const byKey = new Map<string, SessionSummary[]>();
    for (const file of files) {
      try {
        const summary = summarizeClaudeFile(file, root);
        const list = byKey.get(summary.projectKey) ?? [];
        list.push(summary);
        byKey.set(summary.projectKey, list);
      } catch {
        /* one bad file must not drop the board */
      }
    }
    const groups: ProjectGroup[] = [];
    for (const [projectKey, sessions] of byKey) {
      sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
      groups.push({
        projectKey,
        projectLabel: sessions[0]?.projectLabel || projectKey,
        sessions,
      });
    }
    groups.sort((a, b) => (b.sessions[0]?.mtimeMs ?? 0) - (a.sessions[0]?.mtimeMs ?? 0));
    return groups;
  } catch {
    return [];
  }
}
