# P1 Live Board · 我替领导拍的板（v0.1）

1. **场景**：单人 Windows；浏览器大屏盯多会话；只读，不控制 agent。
2. **数据**：旁路读盘。Cursor `~\.cursor\projects\*\agent-transcripts` 全量；Claude Code `~\.claude\projects` 只读扫描（能解析多少算多少，失败不炸）。
3. **实时**：`fs.watch`（recursive）+ 400ms debounce → SSE `/api/events` 推 `sessions`；打开中的会话文件变更则推 `session`。
4. **UI**：保留 CAW 全部 turn/steps/折叠/拖宽/主题/完整 sid；侧栏加 harness 标签、状态点（active≤2min / idle≤30min / stale）、Live 指示、按 harness 过滤。不做 KPI/热力图。
5. **端口**：默认 `3922`（避免撞原 CAW `3921`）。环境变量 `CAW_PORT`。
6. **禁区**：不改 `Desktop\cursor-agent-workflow`；不上传；不写用户 transcript。
