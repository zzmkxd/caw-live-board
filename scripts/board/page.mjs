/** Minimal HTML shell — styles/scripts live under /media/. */
export function pageHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CAW Live Board</title>
  <link rel="stylesheet" href="/media/webview.css" />
  <link rel="stylesheet" href="/media/board/board.css" />
</head>
<body>
  <div id="shell">
    <aside id="sessions">
      <div class="side-head"><button type="button" id="btn-sidebar">收起侧栏</button></div>
      <div class="view-filters" id="view-filters">
        <button type="button" class="chip-live" id="chip-inprogress" title="仅平铺 mtime≤2min 的活跃会话，无目录树">
          正在进行中<span class="live-count" id="inprogress-count">0</span>
        </button>
      </div>
      <div class="filters" id="filters">
        <button type="button" class="chip on" data-harness="all">All</button>
        <button type="button" class="chip" data-harness="cursor">Cursor</button>
        <button type="button" class="chip" data-harness="claude">Claude</button>
        <button type="button" class="chip" data-harness="dsh">dsh</button>
      </div>
      <div id="session-tree"><p class="loading">Loading sessions…</p></div>
      <div id="side-split" class="split-v" title="拖动调整宽度"></div>
    </aside>
    <section id="board">
      <div class="cli-bar">
        <span class="brand-live">CAW Live</span>
        <span id="live-ind" class="live-ind reconnecting">Reconnecting</span>
        <span>127.0.0.1 · read-only</span>
        <button type="button" id="btn-insight" title="第二块 Insight 看板">Insight</button>
        <button type="button" id="btn-refresh">Refresh</button>
      </div>
      <div id="app"><p class="loading">Pick a session on the left.</p></div>
    </section>
    <aside id="insight">
      <div class="insight-head">
        <h2>Insight</h2>
        <span class="insight-sub">Board B · 占位（旧版 Board A 不变）</span>
      </div>
      <div id="insight-body"><p class="empty">选中会话后显示摘要与活动轨。</p></div>
    </aside>
  </div>
  <button type="button" id="btn-theme">浅色</button>
  <script src="/media/board/app.js"></script>
</body>
</html>`;
}
