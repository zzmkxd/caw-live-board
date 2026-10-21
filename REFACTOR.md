# CAW Live · 解耦 / 简化重构（clean 目录）

工作目录：`C:\Users\Ourten\Desktop\caw-live-board-clean`  
原版备份：`C:\Users\Ourten\Desktop\caw-live-board`（勿改）

## 目标

1. **解耦**：`board-server.mjs` 巨石拆开（HTTP / 页面壳 / 客户端逻辑 / 样式）。
2. **简化**：正在进行中列表以服务端 `collectInProgressSessions` 为唯一真相；客户端少重复过滤。
3. **行为不变**：端口默认 3922、三 harness、SSE、Insight skipInsight、目录树、正在进行中芯片。

## 目标结构

```
scripts/board/
  index.mjs          # 入口：listen + watch（原 board-server.mjs 瘦身后）
  httpApp.mjs        # 路由：/, /api/sessions, /api/sessions/in-progress, /api/session, /api/events, 静态
  paths.mjs          # harness 根路径、isUnder、isSessionLog、harnessForPath
  watch.mjs          # fs.watch + debounce + SSE broadcast
  page.mjs           # 最小 HTML 壳（链 /media/…）
media/board/
  app.js             # 浏览器端全部交互（原 inline <script>）
  board.css          # 看板专用样式（原 pageHtml 内联 style 中非 webview 部分）
media/webview.css    # 保留（Board A 卡片等）
src/…                # 解析/扫描逻辑尽量不动，仅必要时小改导出
```

`package.json`：`"board": "npm run compile && node scripts/board/index.mjs"`

## Done checklist

- [x] Split server into `scripts/board/{paths,watch,httpApp,page,index}.mjs`
- [x] Extract `media/board/board.css` + `media/board/app.js`
- [x] In-progress: client fetches `/api/sessions/in-progress?harness=` (no client ACTIVE_WINDOW filter)
- [x] Tree mode still uses `/api/sessions` groups
- [x] Delete `scripts/board-server.mjs`; smoke checks `scripts/board/` + `media/board/`
- [x] Preserve: skipInsight、正在进行中 chip、harness 正交、dsh zstd、full session id、Live SSE
- [x] Acceptance: compile + smoke-live + board on 3922

## 禁区

- 不改 `Desktop\caw-live-board`
- 不删功能；不改默认端口语义
- 扩展 VS Code 侧栏可暂不重构（非本轮重点）

## 验收

```
npm install
npm run compile
node scripts/smoke-live.mjs
npm run board
# GET / 200；/api/sessions；/api/sessions/in-progress；/api/events SSE
```
