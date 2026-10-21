# CAW Live · v0.2 规划（dsh + 右侧双看板 + 去朴素）

> 2026-10-22 · 拍板前提：现右侧「旧版」turn/steps **功能满意、暂定为旧版保留**；要加 **DeepSeek Harness (dsh)**；另起 **第二块大 AI 看板**；视觉先规划再动大刀。

---

## A. DeepSeek Harness（dsh）— 本轮实现

| 项 | 决定 |
|----|------|
| 根目录 | `%USERPROFILE%\.dsh\sessions`（尊重 `DSH_HOME`） |
| 布局 | `sessions/<projectSlug>/<sessionId>/session[.vN].jsonl[.zstd]`；同目录取**最高 generation** |
| 压缩 | 多帧 zstd（Node `zlib.zstdDecompressSync` 逐帧） |
| harness id | `dsh`（徽章文案 `dsh`，色：DeepSeek 青绿系） |
| 列表 | 读 header + title/首条用户消息；`liveStatus` 仍用 mtime |
| 打开 | 映射为现有 turn/steps：`user/message`(source.kind=user) → turn；`assistant/message` → step；`tool/call` → tool（可带 `tool/result` 预览，dsh 有结果） |
| 过滤芯片 | All / Cursor / Claude / **dsh** |
| watch | 增监 `~/.dsh/sessions` |
| Desktop 路径 | `%APPDATA%\dsh-desktop\...` 本机暂无 → v0.2 不做，预留注释 |

**不做（本轮）**：改写 dsh 文件、KPI、把 subagent 单独成 Theater 办公室。

---

## B. 布局演进：右侧「两块大看板」

当前：`[侧栏会话] | [单一旧版 Board：turns + chain]`

目标骨架（v0.2.x，分步）：

```
┌──────────┬─────────────────────────────┬─────────────────────────────┐
│ Sessions │  Board A · Legacy（旧版）    │  Board B · Insight（新）     │
│ +filter  │  现有 turn/steps 原样保留    │  第二块大 AI 看板（先占位）  │
│ +live    │  仅做视觉抛光，不改交互语义  │  见 C                                │
└──────────┴─────────────────────────────┴─────────────────────────────┘
```

| 阶段 | 做什么 |
|------|--------|
| **B0（本轮后半）** | CSS 三栏可选：`side | A | B`；B 先放「Insight 占位」+ 会话级摘要条（harness/status/turn 数/最近 tool） |
| **B1** | B 内做 **活动时间线**（本会话 tool/model 顺序条），仍非全量 DAG |
| **B2** | 可选：B 升级为轻量 DAG / 或对接未来 P2 编排预览——**等你点头再开** |

默认比例：侧栏 ~260px；A:B ≈ 55:45，中间可拖；可「只显 A / 只显 B」。

**原则**：A = 旧版真理源（你已满意）；B = 增量视角，坏了不影响 A。

---

## C. 「太朴素」——视觉优化规划（不动功能语义）

在 **不改 turn/tool 交互模型** 前提下，分三层：

### C1 · 氛围（低风险，建议先做）
- 统一设计 token：间距、圆角、边框、muted 层级（现 VS Code 变量可保留，加一层自有 `--caw-*`）
- 顶栏：更清晰的 Live 脉冲、harness 色条、会话标题行（项目 / 完整 id）
- 侧栏会话卡：左边色条=harness；状态点加大一点；hover 不「一块死灰」
- 深浅色各补一档对比度（scrollbar / chip / badge）

### C2 · 信息密度（中风险）
- 旧版 chain 卡片：左边细时间轨 / step 序号轨（装饰，不改折叠逻辑）
- Tool 卡默认收起时显示 **工具名一行 + 参数一行摘要**（已有则加强排版）
- dsh 若有 tool result：折叠区显示短结果预览（Cursor 仍常无结果）

### C3 · 动效（克制）
- SSE 刷新：侧栏会话点一下高亮，不整页闪
- Live 绿点呼吸；切换会话 crossfade 轻量即可
- **禁止**：大面积玻璃拟态、紫光、dashboard 指标墙（与「弱化 KPI」一致）

---

## D. 建议落地顺序

1. **dsh 扫描 + 过滤 + 打开会话**（功能，本轮必达）  
2. 写清本 PLAN；右侧 B 栏 **占位骨架**（可关）  
3. C1 视觉 token 抛光旧版 A  
4. 你看完 v0.2 → 再决 B1 时间线 / C2  

---

## E. 验收（dsh）

- 芯片可选 `dsh`，列表出现 `~/.dsh/sessions` 下会话  
- 打开一条：turns≥1 或至少 summary 不炸  
- SSE watch 含 `.dsh`  
- 原 Cursor/Claude 行为不回归  
