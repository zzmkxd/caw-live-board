export type HarnessId = "cursor" | "claude" | "dsh";

/** active ≤2 min, idle ≤30 min, otherwise stale. Computed from file mtime. */
export type LiveStatus = "active" | "idle" | "stale";

/** Session list row (tree + panel header). */
export interface SessionSummary {
  id: string;
  projectKey: string;
  projectLabel: string;
  filePath: string;
  mtimeMs: number;
  /** From first `<timestamp>` if present. */
  timestamp?: string;
  /** From first `<user_query>` if present. */
  preview?: string;
  turnCount: number;
  harness: HarnessId;
  liveStatus: LiveStatus;
  /**
   * Display model for Insight: last resolved modelId when available,
   * else selectionFallback (e.g. Cursor Auto).
   */
  primaryModel?: string;
  /** User-facing selection label (Auto / default). Not the routed slug. */
  modelSelection?: string;
  /** True when session saw more than one distinct modelId. */
  modelMulti?: boolean;
}

/** One tool_use block inside an assistant step. */
export interface ToolCallCard {
  id: string;
  name: string;
  /** Stringified JSON of tool input (transcripts often omit tool_result). */
  inputJson: string;
  /** Reserved; usually undefined in Cursor JSONL. */
  resultPreview?: string;
}

/** One assistant message (text + tool cards) within a user turn. */
export interface ModelStep {
  id: string;
  index: number;
  textPreview: string;
  /** Full assistant text. Board clamps it; tree rows keep textPreview. */
  text?: string;
  tools: ToolCallCard[];
  /** Resolved LLM id for this assistant step (not the UI "Model" badge). */
  modelId?: string;
}

/** User message + following assistant steps until the next user message. */
export interface UserTurn {
  id: string;
  index: number;
  timestamp?: string;
  /** Prefer `<user_query>` body; else truncated user text. */
  queryPreview: string;
  /** Full user text for detail pane. */
  queryText: string;
  steps: ModelStep[];
  /** Last known resolved LLM id within this turn (DSH/Claude). */
  modelId?: string;
}

/** Fully parsed workflow for the webview. */
export interface WorkflowSession {
  summary: SessionSummary;
  turns: UserTurn[];
}
