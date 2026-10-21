import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { harnessForPath, isSessionLog } from "./paths.mjs";
import { pageHtml } from "./page.mjs";

const require = createRequire(import.meta.url);
const { scanAllSessions } = require("../../dist/scanAll.js");
const { parseTranscriptFile } = require("../../dist/parser/parseTranscript.js");
const { parseClaudeTranscriptFile } = require("../../dist/harness/claudeScan.js");
const { parseDshTranscriptFile } = require("../../dist/harness/dshScan.js");
const { liveStatusFromMtime } = require("../../dist/liveStatus.js");
const {
  ACTIVE_WINDOW_MS,
  collectInProgressSessions,
} = require("../../dist/inProgressSessions.js");

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendHtml(res, html) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html);
}

function safeMediaPath(repoRoot, urlPath) {
  if (!urlPath.startsWith("/media/")) return null;
  const rel = urlPath.slice("/media/".length);
  if (!rel || rel.includes("\0") || path.isAbsolute(rel)) return null;
  const mediaRoot = path.resolve(repoRoot, "media");
  const resolved = path.resolve(mediaRoot, rel);
  if (resolved !== mediaRoot && !resolved.startsWith(mediaRoot + path.sep)) {
    return null;
  }
  return resolved;
}

/** HTTP request handler: /, /media/*, /api/sessions, /api/sessions/in-progress, /api/session, /api/events */
export function createHandler({ host, port, repoRoot, watch }) {
  return function handler(req, res) {
    const url = new URL(req.url || "/", `http://${host}:${port}`);

    if (url.pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write("retry: 2000\n\n");
      try {
        watch.writeSse(res, { type: "sessions" });
      } catch {
        return;
      }
      watch.addSseClient(req, res);
      return;
    }

    if (url.pathname === "/api/sessions") {
      try {
        const groups = scanAllSessions();
        return sendJson(res, 200, { groups });
      } catch (e) {
        return sendJson(res, 500, { error: String(e.message || e) });
      }
    }

    if (url.pathname === "/api/sessions/in-progress") {
      try {
        const harness = url.searchParams.get("harness") || "all";
        const allowed = new Set(["all", "cursor", "claude", "dsh"]);
        const filter = allowed.has(harness) ? harness : "all";
        const groups = scanAllSessions();
        const sessions = collectInProgressSessions(groups, filter);
        return sendJson(res, 200, {
          sessions,
          activeWindowMs: ACTIVE_WINDOW_MS,
          count: sessions.length,
        });
      } catch (e) {
        return sendJson(res, 500, { error: String(e.message || e) });
      }
    }

    if (url.pathname === "/api/session") {
      const filePath = url.searchParams.get("path") || "";
      const resolved = path.resolve(filePath);
      const harness = harnessForPath(resolved);
      if (!harness || !isSessionLog(resolved)) {
        return sendJson(res, 400, {
          error: "path must be a session log under ~/.cursor, ~/.claude, or ~/.dsh",
        });
      }
      try {
        let session;
        if (harness === "dsh") session = parseDshTranscriptFile(resolved);
        else if (harness === "claude") session = parseClaudeTranscriptFile(resolved);
        else session = parseTranscriptFile(resolved);
        if (session && session.summary) {
          session.summary.harness = harness;
          session.summary.liveStatus = liveStatusFromMtime(session.summary.mtimeMs || 0);
        }
        return sendJson(res, 200, { session });
      } catch (e) {
        return sendJson(res, 500, { error: String(e.message || e) });
      }
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return sendHtml(res, pageHtml());
    }

    const mediaFile = safeMediaPath(repoRoot, url.pathname);
    if (mediaFile) {
      if (!fs.existsSync(mediaFile) || !fs.statSync(mediaFile).isFile()) {
        res.writeHead(404);
        return res.end("Not found");
      }
      const ext = path.extname(mediaFile).toLowerCase();
      const type = MIME[ext] || "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": type,
        "Cache-Control": "no-store",
      });
      return fs.createReadStream(mediaFile).pipe(res);
    }

    res.writeHead(404);
    res.end("Not found");
  };
}
