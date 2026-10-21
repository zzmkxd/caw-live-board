import * as fs from "fs";
import * as path from "path";
import { liveStatusFromMtime } from "../liveStatus";
import type {
  ModelStep,
  SessionSummary,
  ToolCallCard,
  UserTurn,
  WorkflowSession,
} from "./types";

interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
  id?: string;
}

interface TranscriptMessage {
  role?: string;
  message?: {
    content?: ContentBlock[] | string;
  };
}

interface TranscriptLine {
  role?: string;
  message?: TranscriptMessage["message"];
  type?: string;
}

function extractTag(text: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i");
  const m = text.match(re);
  return m?.[1]?.trim() || undefined;
}

function contentBlocks(msg: TranscriptLine): ContentBlock[] {
  const c = msg.message?.content;
  if (!c) {
    return [];
  }
  if (typeof c === "string") {
    return [{ type: "text", text: c }];
  }
  return c;
}

function joinText(blocks: ContentBlock[]): string {
  return blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
}

function truncate(s: string, max = 120): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) {
    return t;
  }
  return t.slice(0, max - 1) + "…";
}

function toolCards(blocks: ContentBlock[], stepId: string): ToolCallCard[] {
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

function projectLabelFromKey(projectKey: string): string {
  // Cursor folder keys look like C-Users-Ourten-Desktop
  return projectKey.replace(/^C-Users-[^-]+-/, "").replace(/-/g, "/") || projectKey;
}

/**
 * Parse a Cursor agent transcript JSONL file into a WorkflowSession.
 * Lines: `{role,message:{content:[{type:text|tool_use,...}]}}` and optional `{type:turn_ended}`.
 */
export function parseTranscriptFile(filePath: string): WorkflowSession {
  const raw = fs.readFileSync(filePath, "utf8");
  return parseTranscriptText(raw, filePath);
}

export function parseTranscriptText(raw: string, filePath: string): WorkflowSession {
  const abs = path.resolve(filePath);
  const sessionId = path.basename(abs, path.extname(abs));
  // .../projects/<projectKey>/agent-transcripts/<sessionId>/<file>.jsonl
  const parts = abs.split(path.sep);
  const atIdx = parts.lastIndexOf("agent-transcripts");
  const projectKey =
    atIdx > 0 ? parts[atIdx - 1] : path.basename(path.dirname(path.dirname(abs)));

  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(abs).mtimeMs;
  } catch {
    /* ignore */
  }

  const lines = raw.split(/\r?\n/);
  const turns: UserTurn[] = [];
  let current: UserTurn | undefined;
  let turnIndex = 0;
  let stepIndex = 0;
  let firstTimestamp: string | undefined;
  let firstPreview: string | undefined;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li].trim();
    if (!line) {
      continue;
    }
    let obj: TranscriptLine;
    try {
      obj = JSON.parse(line) as TranscriptLine;
    } catch {
      continue;
    }

    if (obj.type === "turn_ended") {
      continue;
    }

    const role = obj.role;
    if (role !== "user" && role !== "assistant") {
      continue;
    }

    const blocks = contentBlocks(obj);
    const text = joinText(blocks);

    if (role === "user") {
      const timestamp = extractTag(text, "timestamp");
      const query = extractTag(text, "user_query") ?? text;
      if (!firstTimestamp && timestamp) {
        firstTimestamp = timestamp;
      }
      if (!firstPreview && query) {
        firstPreview = truncate(query, 80);
      }

      current = {
        id: `turn-${turnIndex}`,
        index: turnIndex,
        timestamp,
        queryPreview: truncate(query, 100),
        queryText: query,
        steps: [],
      };
      turns.push(current);
      turnIndex += 1;
      stepIndex = 0;
      continue;
    }

    // assistant
    if (!current) {
      // Orphan assistant before any user — synthesize a turn
      current = {
        id: `turn-${turnIndex}`,
        index: turnIndex,
        queryPreview: "(no user message)",
        queryText: "",
        steps: [],
      };
      turns.push(current);
      turnIndex += 1;
      stepIndex = 0;
    }

    const stepId = `${current.id}-step-${stepIndex}`;
    const tools = toolCards(blocks, stepId);
    const step: ModelStep = {
      id: stepId,
      index: stepIndex,
      textPreview: truncate(text, 160),
      text,
      tools,
    };
    current.steps.push(step);
    stepIndex += 1;
  }

  const summary: SessionSummary = {
    id: sessionId,
    projectKey,
    projectLabel: projectLabelFromKey(projectKey),
    filePath: abs,
    mtimeMs,
    timestamp: firstTimestamp,
    preview: firstPreview,
    turnCount: turns.length,
    harness: "cursor",
    liveStatus: liveStatusFromMtime(mtimeMs),
  };

  return { summary, turns };
}

/**
 * Lightweight summary for tree rows — reads only the head of the file
 * so scanning hundreds of sessions stays cheap. Full parse happens on open.
 */
export function summarizeTranscriptFile(filePath: string): SessionSummary {
  const abs = path.resolve(filePath);
  const sessionId = path.basename(abs, path.extname(abs));
  const parts = abs.split(path.sep);
  const atIdx = parts.lastIndexOf("agent-transcripts");
  const projectKey =
    atIdx > 0 ? parts[atIdx - 1] : path.basename(path.dirname(path.dirname(abs)));

  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(abs).mtimeMs;
  } catch {
    /* ignore */
  }

  let firstTimestamp: string | undefined;
  let firstPreview: string | undefined;
  let turnCount = 0;

  try {
    const fd = fs.openSync(abs, "r");
    try {
      const buf = Buffer.alloc(64 * 1024);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      const head = buf.slice(0, n).toString("utf8");
      for (const line of head.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        let obj: TranscriptLine;
        try {
          obj = JSON.parse(t) as TranscriptLine;
        } catch {
          continue;
        }
        if (obj.role === "user") {
          turnCount += 1;
          if (!firstPreview) {
            const text = joinText(contentBlocks(obj));
            const timestamp = extractTag(text, "timestamp");
            const query = extractTag(text, "user_query") ?? text;
            if (timestamp) firstTimestamp = timestamp;
            if (query) firstPreview = truncate(query, 80);
          }
        }
      }
      // Large files: head-only turnCount is a lower bound; full count on panel open.
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    /* leave defaults */
  }

  return {
    id: sessionId,
    projectKey,
    projectLabel: projectLabelFromKey(projectKey),
    filePath: abs,
    mtimeMs,
    timestamp: firstTimestamp,
    preview: firstPreview,
    turnCount,
    harness: "cursor",
    liveStatus: liveStatusFromMtime(mtimeMs),
  };
}
