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
import { applySessionModels } from "../parser/sessionModels";
import type { ProjectGroup } from "../scanSessions";
import { decompressDshLog } from "./dshZstd";

const MAX_FULL_BYTES = 12 * 1024 * 1024;
/** Enough frames for header + title + first user preview on list scan. */
const LIST_MAX_FRAMES = 80;

export function dshHome(): string {
  const env = process.env.DSH_HOME;
  if (env && env.trim()) {
    return path.resolve(env.trim());
  }
  return path.join(os.homedir(), ".dsh");
}

export function dshSessionsRoot(): string {
  return path.join(dshHome(), "sessions");
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function safeReadDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function truncate(s: string, max = 80): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) {
    return t;
  }
  return t.slice(0, max - 1) + "…";
}

/** `--C-Users-Ourten--` → `C/Users/Ourten` */
export function dshProjectLabel(slug: string): string {
  let s = slug.trim();
  if (s.startsWith("--") && s.endsWith("--")) {
    s = s.slice(2, -2);
  }
  // Drive letter: C-Users-... → C/Users/...
  const m = /^([A-Za-z])-(.*)$/.exec(s);
  if (m) {
    return `${m[1]}/${m[2].replace(/-/g, "/")}`;
  }
  return s.replace(/-/g, "/") || slug;
}

/** Pick highest session.vN.jsonl[.zstd] (plain session.jsonl = v0). */
export function pickNewestGeneration(files: string[]): string | undefined {
  let best: { score: number; name: string } | undefined;
  for (const name of files) {
    const m = /^session(?:\.v(\d+))?\.jsonl(\.zstd)?$/i.exec(name);
    if (!m) {
      continue;
    }
    const ver = m[1] ? Number(m[1]) : 0;
    const z = m[2] ? 0 : 1; // prefer uncompressed tie-break slightly
    const score = ver * 10 + z;
    if (!best || score > best.score || (score === best.score && name > best.name)) {
      best = { score, name };
    }
  }
  return best?.name;
}

interface DshLine {
  type?: string;
  seq?: number;
  time?: number;
  data?: Record<string, unknown>;
  id?: string;
  cwd?: string;
  createdAt?: number;
  origin?: string;
  version?: number;
}

function parseLines(text: string): DshLine[] {
  const out: DshLine[] = [];
  for (const raw of text.split(/\n/)) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    try {
      out.push(JSON.parse(line) as DshLine);
    } catch {
      /* skip */
    }
  }
  return out;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const b of content) {
    if (!b || typeof b !== "object") {
      continue;
    }
    const block = b as { type?: string; text?: string };
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join("\n");
}

function readLogText(filePath: string, listMode: boolean): string {
  const st = fs.statSync(filePath);
  const size = Math.min(st.size, listMode ? 2 * 1024 * 1024 : MAX_FULL_BYTES);
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, 0);
    return decompressDshLog(buf, listMode ? LIST_MAX_FRAMES : Infinity);
  } finally {
    fs.closeSync(fd);
  }
}

export function summarizeDshSessionFile(
  filePath: string,
  projectKey: string
): SessionSummary {
  const abs = path.resolve(filePath);
  const st = fs.statSync(abs);
  let sessionId = path.basename(path.dirname(abs));
  let preview: string | undefined;
  let title: string | undefined;
  let turnCount = 0;
  let cwdLabel = dshProjectLabel(projectKey);

  try {
    const lines = parseLines(readLogText(abs, true));
    for (const line of lines) {
      if (line.type === "session") {
        if (typeof line.id === "string" && line.id.trim()) {
          sessionId = line.id.trim();
        }
        if (typeof line.cwd === "string" && line.cwd) {
          cwdLabel = line.cwd.replace(/\\/g, "/");
        }
        continue;
      }
      if (line.type === "session/title") {
        const t = line.data?.title;
        if (typeof t === "string" && t.trim()) {
          title = t.trim();
        }
        continue;
      }
      if (line.type === "turn/start") {
        turnCount += 1;
        continue;
      }
      if (line.type === "user/message" && !preview) {
        const src = (line.data?.source as { kind?: string } | undefined)?.kind;
        if (src && src !== "user") {
          continue;
        }
        // v0 often omits source on real user lines; prefer content text
        const text = textFromContent(line.data?.content);
        if (text.trim()) {
          // skip if looks like injected system blob without source.kind===user when many exist
          if (!src || src === "user") {
            preview = truncate(text, 80);
          }
        }
      }
    }
  } catch {
    /* list still works */
  }

  return {
    id: sessionId,
    projectKey,
    projectLabel: cwdLabel,
    filePath: abs,
    mtimeMs: st.mtimeMs,
    preview: preview || (title ? truncate(title, 80) : undefined),
    turnCount,
    harness: "dsh",
    liveStatus: liveStatusFromMtime(st.mtimeMs),
  };
}

export function parseDshTranscriptFile(filePath: string): WorkflowSession {
  const abs = path.resolve(filePath);
  const st = fs.statSync(abs);
  const projectKey = path.basename(path.dirname(path.dirname(abs)));
  let sessionId = path.basename(path.dirname(abs));

  const lines = parseLines(readLogText(abs, false));
  let cwdLabel = dshProjectLabel(projectKey);
  let title: string | undefined;

  const turns: UserTurn[] = [];
  let current: UserTurn | undefined;
  let stepIndex = 0;
  let pendingModel: string | undefined;
  const pendingTools = new Map<string, ToolCallCard>();

  const takeModel = (raw: unknown): string | undefined => {
    if (typeof raw !== "string") {
      return undefined;
    }
    const m = raw.trim();
    return m ? m : undefined;
  };

  const ensureTurn = (time?: number): UserTurn => {
    if (!current) {
      current = {
        id: `dsh-turn-${turns.length}`,
        index: turns.length,
        timestamp: time ? new Date(time).toISOString() : undefined,
        queryPreview: "",
        queryText: "",
        steps: [],
        modelId: pendingModel,
      };
      turns.push(current);
      stepIndex = 0;
    }
    return current;
  };

  for (const line of lines) {
    if (line.type === "session") {
      if (typeof line.id === "string" && line.id.trim()) {
        sessionId = line.id.trim();
      }
      if (typeof line.cwd === "string" && line.cwd) {
        cwdLabel = line.cwd.replace(/\\/g, "/");
      }
      continue;
    }
    if (line.type === "session/title") {
      const t = line.data?.title;
      if (typeof t === "string") {
        title = t;
      }
      continue;
    }
    if (line.type === "turn/start") {
      pendingModel = undefined;
      current = {
        id: `dsh-turn-${turns.length}`,
        index: turns.length,
        timestamp: line.time ? new Date(line.time).toISOString() : undefined,
        queryPreview: "",
        queryText: "",
        steps: [],
      };
      turns.push(current);
      stepIndex = 0;
      pendingTools.clear();
      continue;
    }
    if (line.type === "request/header") {
      const header = line.data?.header as
        | { config?: { model?: unknown } }
        | undefined;
      const m = takeModel(header?.config?.model);
      if (m) {
        pendingModel = m;
        if (current) {
          current.modelId = m;
        }
      }
      continue;
    }
    if (line.type === "request/context") {
      const m = takeModel(line.data?.model);
      if (m) {
        pendingModel = m;
        if (current) {
          current.modelId = m;
        }
      }
      continue;
    }
    if (line.type === "user/message") {
      const src = (line.data?.source as { kind?: string } | undefined)?.kind;
      if (src && src !== "user") {
        continue;
      }
      const text = textFromContent(line.data?.content);
      if (!text.trim()) {
        continue;
      }
      const turn = ensureTurn(line.time);
      if (!turn.queryText) {
        turn.queryText = text;
        turn.queryPreview = truncate(text, 100);
      } else {
        turn.queryText += "\n\n" + text;
        turn.queryPreview = truncate(turn.queryText, 100);
      }
      continue;
    }
    if (line.type === "assistant/message") {
      const turn = ensureTurn(line.time);
      const msg = line.data?.message as
        | { content?: unknown; role?: string }
        | undefined;
      const text = textFromContent(msg?.content);
      const tools: ToolCallCard[] = [];
      // tools may arrive as separate tool/call events; also embed tool-call blocks
      if (Array.isArray(msg?.content)) {
        for (const b of msg!.content as Array<{
          type?: string;
          id?: string;
          name?: string;
          arguments?: unknown;
        }>) {
          if (b?.type === "tool-call" && b.name) {
            const id = b.id || `tool-${tools.length}`;
            const inputJson =
              typeof b.arguments === "string"
                ? b.arguments
                : JSON.stringify(b.arguments ?? {}, null, 2);
            const card: ToolCallCard = { id, name: b.name, inputJson };
            tools.push(card);
            pendingTools.set(id, card);
          }
        }
      }
      const step: ModelStep = {
        id: `dsh-step-${turn.index}-${stepIndex}`,
        index: stepIndex,
        textPreview: truncate(text, 160),
        text,
        tools,
        modelId: pendingModel || turn.modelId,
      };
      if (step.modelId) {
        turn.modelId = step.modelId;
      }
      turn.steps.push(step);
      stepIndex += 1;
      continue;
    }
    if (line.type === "tool/call") {
      const turn = ensureTurn(line.time);
      const name = String(line.data?.name || "tool");
      const callId = String(line.data?.callId || line.data?.id || `call-${stepIndex}`);
      const args = line.data?.arguments;
      const inputJson =
        typeof args === "string" ? args : JSON.stringify(args ?? {}, null, 2);
      const card: ToolCallCard = { id: callId, name, inputJson };
      pendingTools.set(callId, card);
      let step = turn.steps[turn.steps.length - 1];
      if (!step) {
        step = {
          id: `dsh-step-${turn.index}-${stepIndex}`,
          index: stepIndex,
          textPreview: "",
          text: "",
          tools: [],
          modelId: pendingModel || turn.modelId,
        };
        turn.steps.push(step);
        stepIndex += 1;
      }
      if (!step.tools.some((t) => t.id === callId)) {
        step.tools.push(card);
      }
      continue;
    }
    if (line.type === "tool/result") {
      const callId = String(
        (line.data?.message as { source?: { callId?: string } } | undefined)?.source
          ?.callId ||
          line.data?.callId ||
          ""
      );
      const card = pendingTools.get(callId);
      if (card) {
        const body = textFromContent(
          (line.data?.message as { content?: unknown } | undefined)?.content
        );
        // tool-result nested
        let preview = body;
        const msgContent = (line.data?.message as { content?: unknown })?.content;
        if (Array.isArray(msgContent)) {
          for (const b of msgContent as Array<{
            type?: string;
            content?: unknown;
          }>) {
            if (b?.type === "tool-result") {
              preview = textFromContent(b.content) || preview;
            }
          }
        }
        if (preview) {
          card.resultPreview = truncate(preview, 400);
        }
      }
      continue;
    }
  }

  if (turns.length === 0 && title) {
    turns.push({
      id: "dsh-turn-0",
      index: 0,
      queryPreview: truncate(title, 100),
      queryText: title,
      steps: [],
    });
  }

  const summary: SessionSummary = {
    id: sessionId,
    projectKey,
    projectLabel: cwdLabel,
    filePath: abs,
    mtimeMs: st.mtimeMs,
    preview: turns[0]?.queryPreview || (title ? truncate(title, 80) : undefined),
    turnCount: turns.length,
    harness: "dsh",
    liveStatus: liveStatusFromMtime(st.mtimeMs),
  };
  applySessionModels(summary, turns);

  return { summary, turns };
}

export function scanDshSessions(): ProjectGroup[] {
  const root = dshSessionsRoot();
  if (!isDir(root)) {
    return [];
  }

  const groups: ProjectGroup[] = [];

  for (const projectKey of safeReadDir(root)) {
    const projectDir = path.join(root, projectKey);
    if (!isDir(projectDir)) {
      continue;
    }
    const sessions: SessionSummary[] = [];
    for (const sessionId of safeReadDir(projectDir)) {
      const sessionDir = path.join(projectDir, sessionId);
      if (!isDir(sessionDir)) {
        continue;
      }
      const gen = pickNewestGeneration(safeReadDir(sessionDir));
      if (!gen) {
        continue;
      }
      const filePath = path.join(sessionDir, gen);
      try {
        sessions.push(summarizeDshSessionFile(filePath, projectKey));
      } catch {
        /* skip */
      }
    }
    if (!sessions.length) {
      continue;
    }
    sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
    groups.push({
      projectKey: `dsh:${projectKey}`,
      projectLabel: sessions[0].projectLabel || dshProjectLabel(projectKey),
      sessions,
    });
  }

  groups.sort((a, b) => (b.sessions[0]?.mtimeMs ?? 0) - (a.sessions[0]?.mtimeMs ?? 0));
  return groups;
}
