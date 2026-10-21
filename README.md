# CAW Live Board

本机只读的实时会话看板。同时看 **Cursor**、**Claude Code**、**DeepSeek Harness (dsh)** 的会话；不控制 agent，不改写、不删除、也不上传 transcript。

从 Cursor Agent Workflow 本地看板演进而来；默认端口 **3922**（避免和旧 CAW `3921` 冲突）。

## 功能摘要

- 浏览器看板：`http://127.0.0.1:3922/`（`CAW_PORT` 可改）
- SSE 实时刷新；侧栏 All / Cursor / Claude / dsh；**正在进行中**平铺活跃会话（无目录树）
- Insight 第二栏活动时间线；旧版 turn/steps 大看板保留
- 盘符/目录树、折叠、拖宽、浅深色、完整 session id

VS Code / Cursor 活动栏扩展仍是较简单的侧栏，不含浏览器实时与多 harness。

## 环境

- Node.js **22+**（dsh 的 zstd 需要 `zlib.zstdDecompressSync`）
- Cursor：`%USERPROFILE%\.cursor\projects\*\agent-transcripts\`
- Claude Code：`%USERPROFILE%\.claude\projects\`
- DeepSeek Harness：`%USERPROFILE%\.dsh\sessions\`（可用 `DSH_HOME`）

## 启动

```bash
npm install
npm run board
```

浏览器打开 `http://127.0.0.1:3922/`。只监听 `127.0.0.1`。

```powershell
# Windows PowerShell
$env:CAW_PORT = "4000"
npm run board
```

```bash
# macOS / Linux
CAW_PORT=4000 npm run board
```

顶栏 **CAW Live** 旁：SSE 连上是绿色 **Live**（圆点呼吸），断开是黄色 **Reconnecting**。EventSource 会自己重连。

筛选：**All / Cursor / Claude / dsh**，以及 **正在进行中**。打开中的会话文件变更会尽量保留当前 turn 重载。

Cursor 记录里通常只有工具名和入参；dsh 会话可带短 result 预览。

## 自检 / 打包

```bash
npm run compile
npm run smoke:live
npm run package   # 产出 .vsix（扩展侧栏；浏览器看板不进 vsix）
```

## 隐私

只读本机：

- `%USERPROFILE%\.cursor\projects\`
- `%USERPROFILE%\.claude\projects\`
- `%USERPROFILE%\.dsh\sessions\`

看板绑定 `127.0.0.1`。无上传，不写回 transcript。

## 许可

MIT
