/**
 * CAW Live Board — entry.
 * Binds 127.0.0.1 only. Never uploads. Never writes transcripts.
 *
 *   npm run board
 *   CAW_PORT defaults to 3922
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import { harnessRoots } from "./paths.mjs";
import { createWatchSystem } from "./watch.mjs";
import { createHandler } from "./httpApp.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

const distScan = path.join(repoRoot, "dist", "scanSessions.js");
if (!fs.existsSync(distScan)) {
  console.error("Run npm run compile first (or use npm run board).");
  process.exit(1);
}

const HOST = "127.0.0.1";
const PORT = Number(process.env.CAW_PORT || 3922);

const watch = createWatchSystem();
const handler = createHandler({ host: HOST, port: PORT, repoRoot, watch });
const server = http.createServer(handler);

watch.startPing(20000);

const roots = harnessRoots();
watch.watchProjects(roots.cursor);
watch.watchProjects(roots.claude);
watch.watchProjects(roots.dsh);

server.on("error", (err) => {
  console.error(err && err.code === "EADDRINUSE" ? `Port ${PORT} is already in use.` : err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}/`;
  console.log(`CAW Live board: ${url}`);
  console.log("Read-only. Ctrl+C to stop.");
  const opener =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(opener, () => {});
});
