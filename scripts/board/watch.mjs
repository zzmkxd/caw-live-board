import fs from "fs";
import path from "path";
import { isSessionLog } from "./paths.mjs";

const DEFAULT_DEBOUNCE_MS = 400;

/**
 * SSE clients + fs.watch debounce → broadcast sessions / session events.
 */
export function createWatchSystem({ debounceMs = DEFAULT_DEBOUNCE_MS } = {}) {
  const sseClients = new Set();
  const dirtyPaths = new Set();
  let watchTimer = null;

  function writeSse(res, event) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  function broadcast(event) {
    for (const res of sseClients) {
      try {
        writeSse(res, event);
      } catch {
        sseClients.delete(res);
      }
    }
  }

  function flushWatch() {
    watchTimer = null;
    const paths = [...dirtyPaths];
    dirtyPaths.clear();
    broadcast({ type: "sessions" });
    for (const filePath of paths) {
      if (filePath && isSessionLog(filePath)) {
        broadcast({ type: "session", path: filePath });
      }
    }
  }

  function noteWatch(rootDir, filename) {
    let name = "";
    if (Buffer.isBuffer(filename)) name = filename.toString("utf8");
    else if (filename) name = String(filename);
    if (name) dirtyPaths.add(path.resolve(rootDir, name));
    if (watchTimer) clearTimeout(watchTimer);
    watchTimer = setTimeout(flushWatch, debounceMs);
  }

  function watchProjects(rootDir) {
    if (!rootDir || !fs.existsSync(rootDir)) return;
    let watcher;
    try {
      watcher = fs.watch(rootDir, { recursive: true }, (_eventType, filename) => {
        noteWatch(rootDir, filename);
      });
    } catch (e) {
      console.warn("watch failed:", rootDir, e && e.message ? e.message : e);
      return;
    }
    watcher.on("error", (err) => {
      console.warn("watch error:", rootDir, err && err.message ? err.message : err);
      try {
        watcher.close();
      } catch {
        /* ignore */
      }
      setTimeout(() => watchProjects(rootDir), 1000);
    });
    console.log("watching", rootDir);
  }

  function addSseClient(req, res) {
    sseClients.add(res);
    const drop = () => sseClients.delete(res);
    req.on("close", drop);
    res.on("close", drop);
  }

  function startPing(intervalMs = 20000) {
    const timer = setInterval(() => {
      for (const res of sseClients) {
        try {
          res.write(": ping\n\n");
        } catch {
          sseClients.delete(res);
        }
      }
    }, intervalMs);
    timer.unref?.();
    return timer;
  }

  return {
    sseClients,
    writeSse,
    broadcast,
    watchProjects,
    noteWatch,
    addSseClient,
    startPing,
  };
}
