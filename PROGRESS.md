# PROGRESS

- 2026-10-22：从 CAW 复制源码到本目录（无 node_modules/dist）。
- 2026-10-22：v0.1 完成（Cursor + Claude + SSE）。
- 2026-10-22：v0.2.0 推进（dsh / Insight / C1）。
- 2026-10-22：**正在进行中**视图（与目录树解耦）
  - 模块 `src/inProgressSessions.ts`；API `GET /api/sessions/in-progress`。
  - 侧栏独立芯片：点选 → 平铺 mtime≤2min 活跃会话，无 drive/dir；再点恢复树。
  - harness 芯片仍正交过滤；不碰 openDrives/openDirs。
- 2026-10-22：**clean 重构验收通过**（本目录为现行运行版）
  - 巨石 `board-server.mjs` 删除 → `scripts/board/{index,httpApp,page,paths,watch}.mjs`
  - 前端 → `media/board/{app.js,board.css}`；正在进行中以 API 为唯一过滤源
  - 原目录 `Desktop\caw-live-board` 未改；本目录 `npm run board` → :3922
- 2026-10-22：**解耦重构 done**（见 `REFACTOR.md`）
  - [x] `scripts/board/{paths,watch,httpApp,page,index}.mjs` 拆分原 `board-server.mjs`
  - [x] `media/board/{board.css,app.js}` 抽出内联样式与 IIFE
  - [x] 正在进行中：客户端只拉 `/api/sessions/in-progress?harness=`，不重复 ACTIVE_WINDOW 过滤
  - [x] `package.json` board → `node scripts/board/index.mjs`；smoke 指向 `scripts/board/`
  - [x] 删除 `scripts/board-server.mjs`
  - [x] 验收：`npm run compile` + `node scripts/smoke-live.mjs` + `npm run board`（3922）
