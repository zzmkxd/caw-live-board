/* CAW Live Board — browser client */
(function () {
    const app = document.getElementById("app");
    const sessionsEl = document.getElementById("sessions");
    const sessionTree = document.getElementById("session-tree");
    const shell = document.getElementById("shell");
    const COLLAPSE_CHARS = 480;
    let session = null;
    let selectedTurnId = null;
    let bannerDismissed = false;
    let groups = [];
    let inProgressRows = [];
    let activePath = null;
    let harnessFilter = "all";
    /** tree = drive/dir hierarchy (original); inprogress = flat active-only (decoupled). */
    let listMode = "tree";
    const ACTIVE_MS = 120000;
    let openGen = 0;
    let sidebarCollapsed = false;
    let turnsCollapsed = false;
    let sideW = 280;
    let turnsW = 260;
    const openDrives = new Set();
    const openDirs = new Set();
    /** Insight timeline: which turn cards are expanded (ids). */
    const insightOpenTurns = new Set();

    function esc(s) {
      return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }
    function prettyJson(raw) {
      try { return JSON.stringify(JSON.parse(String(raw ?? "{}")), null, 2); }
      catch { return String(raw ?? "{}"); }
    }
    function countSteps(turns) {
      let steps = 0, tools = 0;
      for (const t of turns || []) {
        for (const step of t.steps || []) {
          steps += 1;
          tools += (step.tools || []).length;
        }
      }
      return { steps, tools };
    }
    function turnToolCount(turn) {
      let n = 0;
      for (const step of turn.steps || []) n += (step.tools || []).length;
      return n;
    }
    function collapsibleBlock(text, kind) {
      const full = String(text ?? "");
      const long = full.length > COLLAPSE_CHARS;
      const preview = long ? full.slice(0, COLLAPSE_CHARS) + "…" : full;
      const cls = kind === "json" ? "body mono" : "body";
      if (!long) return `<pre class="${cls}">${esc(full)}</pre>`;
      return `<div class="collapse" data-collapsed="1">
        <pre class="${cls} collapse-preview">${esc(preview)}</pre>
        <pre class="${cls} collapse-full hidden">${esc(full)}</pre>
        <button type="button" class="collapse-btn" data-action="toggle-collapse">Show more</button>
      </div>`;
    }
    function selectTurnByOffset(delta) {
      if (!session) return;
      const turns = session.turns || [];
      if (!turns.length) return;
      let idx = turns.findIndex((t) => t.id === selectedTurnId);
      if (idx < 0) idx = 0;
      idx = Math.max(0, Math.min(turns.length - 1, idx + delta));
      selectedTurnId = turns[idx].id;
      renderBoard({ keepTurnScroll: true, skipInsight: true });
    }
    function renderCards(active) {
      if (!active) return '<p class="empty">Select a turn.</p>';
      let html = `<article class="card card-user"><div class="card-head"><span class="badge badge-user">User</span></div><div class="card-title">Request</div>${collapsibleBlock(active.queryText || active.queryPreview || "", "text")}</article>`;
      for (const step of active.steps || []) {
        let toolsHtml = "";
        for (const tool of step.tools || []) {
          const resultBit = tool.resultPreview
            ? `<div class="tool-result"><div class="card-meta">result</div>${collapsibleBlock(tool.resultPreview, "text")}</div>`
            : "";
          toolsHtml += `<article class="card card-tool" data-collapsed="1"><div class="card-head"><button type="button" class="twisty" data-action="toggle-tool" aria-label="展开">▸</button><span class="badge badge-tool">Tool</span></div><div class="card-title">${esc(tool.name || "unknown")}</div><div class="tool-body hidden">${collapsibleBlock(prettyJson(tool.inputJson), "json")}${resultBit}</div></article>`;
        }
        const modelText = step.text || step.textPreview || "";
        html += `<article class="card card-model" data-collapsed="1"><div class="card-head"><button type="button" class="twisty" data-action="toggle-model" aria-label="展开">▸</button><span class="model-meta"><span class="badge badge-model">Model</span><span class="card-meta">Step ${esc(String(step.index + 1))}</span></span></div>${modelText ? `<p class="model-body">${esc(modelText)}</p>` : '<p class="muted">No text</p>'}${toolsHtml ? `<div class="tool-nest">${toolsHtml}</div>` : ""}</article>`;
      }
      return html;
    }
    function driveLetter(projectKey) {
      const raw = String(projectKey || "");
      const dsh = /^dsh:(?:--)?([A-Za-z])[-_]/.exec(raw);
      if (dsh) return dsh[1].toUpperCase();
      const m = /^([A-Za-z])-/.exec(raw);
      return m ? m[1].toUpperCase() : "其他";
    }
    function dirLabel(drive, label, projectKey) {
      const raw = String(label || projectKey || "");
      const prefix = drive + "/";
      if (drive !== "其他" && raw.startsWith(prefix)) return raw.slice(prefix.length) || raw;
      return raw;
    }
    function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
    let insightOpen = false;
    function applySidebar() {
      shell.classList.toggle("sidebar-collapsed", sidebarCollapsed);
      shell.classList.toggle("insight-open", insightOpen);
      // CSS grid templates on #shell / .insight-open handle columns; clear inline override
      shell.style.gridTemplateColumns = "";
      if (!insightOpen) {
        shell.style.gridTemplateColumns = sidebarCollapsed ? "40px 1fr" : sideW + "px 1fr";
      } else if (sidebarCollapsed) {
        shell.style.gridTemplateColumns = "40px minmax(0,1.15fr) minmax(280px,0.85fr)";
      } else {
        shell.style.gridTemplateColumns = sideW + "px minmax(0,1.15fr) minmax(280px,0.85fr)";
      }
      const btn = document.getElementById("btn-sidebar");
      if (btn) btn.textContent = sidebarCollapsed ? "展开侧栏" : "收起侧栏";
      const ib = document.getElementById("btn-insight");
      if (ib) ib.textContent = insightOpen ? "Insight ✓" : "Insight";
    }
    function setTurnsWidth(px) {
      const board = document.getElementById("board");
      const max = Math.max(220, (board ? board.clientWidth : 800) - 240);
      turnsW = clamp(px, 160, max);
      document.documentElement.style.setProperty("--turns-w", turnsW + "px");
    }
    function startSplitDrag(onMove) {
      document.body.classList.add("resizing");
      const move = (ev) => onMove(ev.clientX);
      const up = () => {
        document.body.classList.remove("resizing");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    }
    function renderBoard(opts) {
      if (!session) {
        app.innerHTML = '<p class="loading">Pick a session on the left.</p>';
        return;
      }
      const keepTurnScroll = !!(opts && opts.keepTurnScroll);
      const prevTurnList = app.querySelector(".turn-list");
      const turnScroll = keepTurnScroll && prevTurnList ? prevTurnList.scrollTop : 0;
      const prevChain = app.querySelector(".chain");
      const chainScroll = keepTurnScroll && prevChain ? prevChain.scrollTop : 0;

      const summary = session.summary || {};
      const turns = session.turns || [];
      const { steps: stepCount, tools: toolCount } = countSteps(turns);
      if (!selectedTurnId && turns.length) selectedTurnId = turns[0].id;
      const active = turns.find((t) => t.id === selectedTurnId) || turns[0] || null;
      if (active) selectedTurnId = active.id;
      const turnListHtml = turns.map((t) => {
        const activeCls = active && t.id === active.id ? " active" : "";
        const tools = turnToolCount(t);
        return `<button type="button" class="turn-item${activeCls}" data-action="select-turn" data-turn="${esc(t.id)}">
          <div class="turn-top"><span class="idx">#${esc(String(t.index + 1))}</span>
          <span class="tool-badge">${esc(String(tools))}</span></div>
          ${t.timestamp ? `<span class="ts">${esc(t.timestamp)}</span>` : ""}
          <span class="preview">${esc(t.queryText || t.queryPreview || "")}</span></button>`;
      }).join("");
      const banner = bannerDismissed ? "" : `<div class="banner" role="note"><span>Call only — tool outcomes are not stored in agent-transcripts.</span><button type="button" class="banner-dismiss" data-action="dismiss-banner">×</button></div>`;
      const turnsBtn = `<button type="button" class="turn-toggle" data-action="toggle-turns">${turnsCollapsed ? "展开 turns" : "收起 turns"}</button>`;
      const harnessName = harnessOf(summary);
      app.innerHTML = `<header class="summary-bar"><div class="summary-title"><span class="brand">CAW Live</span><span class="sep">·</span><span class="harness-badge harness-${harnessName}">${esc(harnessName)}</span><span class="sep">·</span><span class="proj">${esc(summary.projectLabel || "")}</span><span class="sid">${esc(summary.id || "")}</span></div>
        <div class="stats"><span class="stat"><b>${esc(String(turns.length))}</b> turns</span><span class="stat"><b>${esc(String(stepCount))}</b> steps</span><span class="stat"><b>${esc(String(toolCount))}</b> tools</span></div></header>
        ${banner}<div class="layout${turnsCollapsed ? " turns-collapsed" : ""}"><aside class="turn-list">${turnsBtn}${turnListHtml || '<p class="empty">No turns</p>'}</aside>
        <div class="turn-split split-v" title="拖动调整宽度"></div>
        <main class="detail"><div class="chain">${renderCards(active)}</div></main></div>`;
      if (keepTurnScroll) {
        const list = app.querySelector(".turn-list");
        if (list) list.scrollTop = turnScroll;
        const chain = app.querySelector(".chain");
        if (chain) chain.scrollTop = chainScroll;
      }
      // Insight 重绘会重置其滚动条；点选 turn 时跳过重绘
      if (!(opts && opts.skipInsight)) renderInsight();
      else syncInsightActiveOnly();
    }
    function syncInsightActiveOnly() {
      const body = document.getElementById("insight-body");
      if (!body) return;
      for (const card of body.querySelectorAll(".tl-card")) {
        card.classList.toggle("active", card.getAttribute("data-turn") === selectedTurnId);
      }
    }
    function harnessOf(s) {
      const h = s && s.harness;
      if (h === "claude" || h === "dsh" || h === "cursor") return h;
      return "cursor";
    }
    function toolArgLine(tool) {
      try {
        const o = JSON.parse(String(tool.inputJson || "{}"));
        const keys = Object.keys(o || {});
        if (keys.length) {
          const k0 = keys[0];
          return k0 + "=" + truncateRail(String(o[k0]), 48);
        }
      } catch {
        /* fall through */
      }
      return truncateRail(String(tool.inputJson || ""), 48);
    }
    function collectToolNames(turns) {
      const map = new Map();
      for (const t of turns || []) {
        for (const step of t.steps || []) {
          for (const tool of step.tools || []) {
            const n = tool.name || "?";
            map.set(n, (map.get(n) || 0) + 1);
          }
        }
      }
      return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    }
    function modelDotColor(id) {
      if (!id) return "#9ca3af";
      const s = String(id).toLowerCase();
      if (s === "auto" || s === "default") return "#64748b";
      if (s.includes("flash") || s.includes("composer")) return "#22c55e";
      if (s.includes("pro") && s.includes("deepseek")) return "#14b8a6";
      if (s.includes("deepseek")) return "#0d9488";
      if (s.includes("opus") || s.includes("sonnet") || s.includes("gpt") || s.includes("claude")) {
        return "#f97316";
      }
      let h = 0;
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      return "hsl(" + (h % 360) + " 55% 48%)";
    }
    function turnModelId(t) {
      if (t && t.modelId) return t.modelId;
      const steps = (t && t.steps) || [];
      for (let i = steps.length - 1; i >= 0; i--) {
        if (steps[i].modelId) return steps[i].modelId;
      }
      return "";
    }
    function renderInsight() {
      const body = document.getElementById("insight-body");
      const panel = document.getElementById("insight");
      if (!body) return;
      const scrollY = panel ? panel.scrollTop : 0;
      if (!session) {
        body.innerHTML = '<p class="empty">选中会话后显示会话摘要与可收缩时间线。</p>';
        return;
      }
      const summary = session.summary || {};
      const turns = session.turns || [];
      const { steps: stepCount, tools: toolCount } = countSteps(turns);
      const h = harnessOf(summary);
      const st = statusOf(summary);
      const topTools = collectToolNames(turns);
      const primary =
        summary.primaryModel ||
        summary.modelSelection ||
        (h === "cursor" ? "Auto" : "");
      const modelLabel = primary
        ? primary + (summary.modelMulti ? " · 多模型" : "")
        : "unknown";
      const modelColor = modelDotColor(primary || "unknown");

      let tl = "";
      for (const t of turns) {
        const tools = turnToolCount(t);
        const steps = (t.steps || []).length;
        const open = insightOpenTurns.has(t.id);
        const activeCls = t.id === selectedTurnId ? " active" : "";
        const mid = turnModelId(t) || (h === "cursor" ? "Auto" : "");
        const dot = modelDotColor(mid || "unknown");
        let kids = "";
        for (const step of t.steps || []) {
          const modelText = step.textPreview || step.text || "";
          if (modelText) {
            kids += `<div class="tl-kid step"><span class="rail-dot step"></span><div><b>step · ${esc(String(step.index + 1))}</b><div class="insight-sub">${esc(truncateRail(modelText, 100))}</div></div></div>`;
          }
          for (const tool of step.tools || []) {
            const detail = toolArgLine(tool) || (tool.resultPreview ? "result: " + truncateRail(tool.resultPreview, 64) : "");
            kids += `<div class="tl-kid tool"><span class="rail-dot tool"></span><div><b>${esc(tool.name || "?")}</b><div class="insight-sub">${esc(detail)}</div></div></div>`;
          }
        }
        tl += `<div class="tl-card${activeCls}" data-turn="${esc(t.id)}" data-open="${open ? "1" : "0"}" data-model="${esc(mid || "unknown")}" style="--llm-dot:${esc(dot)}">
          <div class="tl-head">
            <button type="button" class="twisty" data-action="toggle-insight-turn" data-turn="${esc(t.id)}" aria-label="展开">▸</button>
            <button type="button" class="tl-jump" data-action="select-turn" data-turn="${esc(t.id)}">
              <b>Turn #${esc(String(t.index + 1))}</b>
              <span class="tool-badge">${esc(String(steps))}s / ${esc(String(tools))}t</span>
            </button>
          </div>
          <div class="tl-preview">${esc(truncateRail(t.queryPreview || t.queryText || "", 160))}</div>
          <div class="tl-kids">${kids || '<p class="insight-sub">无 step/tool</p>'}</div>
        </div>`;
      }

      const toolBits = topTools.length
        ? topTools.map(([n, c]) => `${esc(n)}×${c}`).join(" · ")
        : "—";

      body.innerHTML = `
        <div class="insight-card insight-session"><h3>Session · 新分区</h3>
          <div class="insight-kv">
            <span>harness</span><span><span class="harness-badge harness-${h}">${esc(h)}</span></span>
            <span>status</span><span>${esc(st)}</span>
            <span>project</span><span>${esc(summary.projectLabel || "")}</span>
            <span>id</span><span class="sid">${esc(summary.id || "")}</span>
            <span>model</span><span class="insight-model"><span class="model-swatch" style="background:${esc(modelColor)}"></span>${esc(modelLabel)}</span>
            <span>counts</span><span>${esc(String(turns.length))} turns · ${esc(String(stepCount))} steps · ${esc(String(toolCount))} tools</span>
            <span>top tools</span><span>${toolBits}</span>
          </div>
        </div>
        <div class="insight-card"><h3>Timeline</h3>
          <p class="insight-sub" style="margin:0 0 8px">小卡片=turn（左点=LLM）；▸ 展开 step/tool；点标题跳 Board A</p>
          <p class="insight-legend"><span><i style="background:#64748b"></i>Auto</span><span><i style="background:#14b8a6"></i>pro</span><span><i style="background:#22c55e"></i>flash</span><span><i style="background:#9ca3af"></i>unknown</span></p>
          <div class="tl">${tl || '<p class="empty">No turns</p>'}</div>
        </div>`;
      if (panel) panel.scrollTop = scrollY;
    }
    function truncateRail(s, n) {
      const t = String(s || "").replace(/\s+/g, " ").trim();
      return t.length <= n ? t : t.slice(0, n - 1) + "…";
    }
    function statusOf(s) {
      const v = s && s.liveStatus;
      if (v === "active" || v === "idle" || v === "stale") return v;
      return "stale";
    }
    function samePath(a, b) {
      const norm = (p) => String(p || "").replace(/\\/g, "/").replace(/\//g, "/").toLowerCase();
      return norm(a) === norm(b);
    }
    function setLive(ok) {
      const el = document.getElementById("live-ind");
      if (!el) return;
      el.classList.toggle("live", !!ok);
      el.classList.toggle("reconnecting", !ok);
      el.textContent = ok ? "Live" : "Reconnecting";
    }
    function isFreshActive(s, now) {
      const m = Number(s && s.mtimeMs);
      if (!Number.isFinite(m)) return (s && s.liveStatus) === "active";
      return (now - m) <= ACTIVE_MS;
    }
    function updateInProgressCount() {
      const el = document.getElementById("inprogress-count");
      if (el) el.textContent = String(inProgressRows.length);
      const chip = document.getElementById("chip-inprogress");
      if (chip) chip.classList.toggle("on", listMode === "inprogress");
    }
    function sessButtonHtml(s, opts) {
      const act = samePath(s.filePath, activePath) ? " active" : "";
      const h = harnessOf(s);
      const st = isFreshActive(s, Date.now()) ? "active" : statusOf(s);
      const metaExtra = opts && opts.ageLabel ? ` · ${esc(opts.ageLabel)}` : "";
      const proj = opts && opts.groupLabel
        ? `<div class="proj-line">${esc(opts.groupLabel)}</div>`
        : "";
      return `<button type="button" class="sess harness-${h}${act}" data-path="${esc(s.filePath)}" aria-label="${esc(h + " " + st + " " + (s.id || ""))}">
        <div class="sess-idline"><span class="status-dot status-${st}" title="${esc(st)}"></span><span class="harness-badge harness-${h}">${esc(h)}</span><span class="sid">${esc(s.id || "")}</span></div>
        <div class="pv">${esc(s.preview || s.id)}</div>
        ${proj}
        <div class="meta">${esc(s.timestamp || "")} · ${esc(String(s.turnCount || "?"))} turns${metaExtra}</div>
      </button>`;
    }
    function renderInProgressSessions() {
      const scroll = sessionsEl.scrollTop;
      updateInProgressCount();
      const rows = inProgressRows;
      if (!rows.length) {
        sessionTree.innerHTML = '<div class="live-list"><p class="live-list-head">正在进行中 · 无活跃会话（mtime ≤ 2 分钟）</p><p class="empty">当前没有正在写入的会话。可关掉本标签回到目录树。</p></div>';
        sessionsEl.scrollTop = scroll;
        return;
      }
      let html = `<div class="live-list"><p class="live-list-head">正在进行中 · ${rows.length} 个活跃会话（无目录树）</p>`;
      for (const s of rows) {
        const ageSec = Math.max(0, Math.round((Date.now() - (s.mtimeMs || 0)) / 1000));
        html += sessButtonHtml(s, {
          ageLabel: ageSec + "s ago",
          groupLabel: s.groupLabel || "",
        });
      }
      html += "</div>";
      sessionTree.innerHTML = html;
      sessionsEl.scrollTop = scroll;
    }
    function renderTreeSessions() {
      const scroll = sessionsEl.scrollTop;
      updateInProgressCount();
      if (!groups.length) {
        sessionTree.innerHTML = '<p class="empty">No sessions under ~/.cursor · ~/.claude · ~/.dsh</p>';
        return;
      }
      const byDrive = new Map();
      for (const g of groups) {
        const sessions = (g.sessions || []).filter((s) => harnessFilter === "all" || harnessOf(s) === harnessFilter);
        if (!sessions.length) continue;
        const drive = driveLetter(g.projectKey);
        if (!byDrive.has(drive)) byDrive.set(drive, []);
        byDrive.get(drive).push({ g, sessions });
      }
      if (!byDrive.size) {
        sessionTree.innerHTML = '<p class="empty">No sessions for this filter.</p>';
        return;
      }
      let html = "";
      for (const drive of byDrive.keys()) {
        const driveOpen = openDrives.has(drive) ? " open" : "";
        html += `<details class="drive"${driveOpen} data-kind="drive" data-key="${esc(drive)}"><summary>${esc(drive)}:</summary>`;
        for (const row of byDrive.get(drive)) {
          const g = row.g;
          const dirKey = drive + "|" + (g.projectKey || "");
          const dirOpen = openDirs.has(dirKey) ? " open" : "";
          const label = dirLabel(drive, g.projectLabel, g.projectKey);
          html += `<details class="dir"${dirOpen} data-kind="dir" data-key="${esc(dirKey)}"><summary>${esc(label)}</summary>`;
          for (const s of row.sessions) {
            html += sessButtonHtml(s);
          }
          html += "</details>";
        }
        html += "</details>";
      }
      sessionTree.innerHTML = html;
      sessionsEl.scrollTop = scroll;
    }
    function renderSessions() {
      if (listMode === "inprogress") renderInProgressSessions();
      else renderTreeSessions();
    }
    async function loadSessions() {
      const scroll = sessionsEl.scrollTop;
      try {
        const [treeRes, ipRes] = await Promise.all([
          fetch("/api/sessions"),
          fetch("/api/sessions/in-progress?harness=" + encodeURIComponent(harnessFilter)),
        ]);
        const data = await treeRes.json();
        const ipData = await ipRes.json();
        groups = data.groups || [];
        inProgressRows = ipData.sessions || [];
        renderSessions();
        sessionsEl.scrollTop = scroll;
      } catch (err) {
        sessionTree.innerHTML = '<p class="empty">Failed to load sessions</p>';
      }
    }
    async function openSession(filePath, opts) {
      const gen = ++openGen;
      const keepTurn = opts && opts.keepTurn ? selectedTurnId : null;
      activePath = filePath;
      renderSessions();
      if (!keepTurn) app.innerHTML = '<p class="loading">Loading…</p>';
      const r = await fetch("/api/session?path=" + encodeURIComponent(filePath));
      const data = await r.json();
      if (gen !== openGen) return;
      if (data.error) {
        app.innerHTML = `<p class="error">${esc(data.error)}</p>`;
        return;
      }
      session = data.session;
      if (keepTurn && (session.turns || []).some((t) => t.id === keepTurn)) selectedTurnId = keepTurn;
      else selectedTurnId = null;
      if (!keepTurn) {
        bannerDismissed = false;
        insightOpenTurns.clear();
      }
      renderBoard();
    }
    function connectEvents() {
      let es;
      try { es = new EventSource("/api/events"); }
      catch { setLive(false); return; }
      es.onopen = () => setLive(true);
      es.onerror = () => setLive(false);
      es.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (!msg || !msg.type) return;
        if (msg.type === "sessions") loadSessions();
        if (msg.type === "session" && activePath && samePath(msg.path, activePath)) {
          openSession(activePath, { keepTurn: true });
        }
      };
    }
    sessionsEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".sess");
      if (!btn) return;
      openSession(btn.getAttribute("data-path"));
    });
    sessionsEl.addEventListener("toggle", (e) => {
      const node = e.target;
      if (!node || node.tagName !== "DETAILS") return;
      const kind = node.getAttribute("data-kind");
      const key = node.getAttribute("data-key");
      if (!kind || !key) return;
      const set = kind === "drive" ? openDrives : openDirs;
      if (node.open) set.add(key);
      else set.delete(key);
    }, true);
    document.getElementById("btn-sidebar").onclick = () => {
      sidebarCollapsed = !sidebarCollapsed;
      applySidebar();
    };
    document.getElementById("side-split").addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || sidebarCollapsed) return;
      e.preventDefault();
      startSplitDrag((x) => {
        sideW = clamp(x, 180, Math.max(240, window.innerWidth - 320));
        applySidebar();
      });
    });
    app.addEventListener("pointerdown", (e) => {
      const split = e.target.closest(".turn-split");
      if (!split || turnsCollapsed || e.button !== 0) return;
      e.preventDefault();
      const list = document.querySelector(".turn-list");
      const left = list ? list.getBoundingClientRect().left : 0;
      startSplitDrag((x) => setTurnsWidth(x - left));
    });
    applySidebar();
    setTurnsWidth(turnsW);
    document.getElementById("insight")?.addEventListener("click", (e) => {
      const el = e.target.closest("[data-action]");
      if (!el) return;
      const action = el.getAttribute("data-action");
      if (action === "toggle-insight-turn") {
        e.preventDefault();
        e.stopPropagation();
        const tid = el.getAttribute("data-turn");
        if (!tid) return;
        if (insightOpenTurns.has(tid)) insightOpenTurns.delete(tid);
        else insightOpenTurns.add(tid);
        const card = el.closest(".tl-card");
        if (card) {
          card.setAttribute("data-open", insightOpenTurns.has(tid) ? "1" : "0");
        }
        return;
      }
      if (action === "select-turn") {
        selectedTurnId = el.getAttribute("data-turn");
        renderBoard({ skipInsight: true, keepTurnScroll: true });
      }
    });
    app.addEventListener("click", (e) => {
      const el = e.target.closest("[data-action]");
      if (!el) return;
      const action = el.getAttribute("data-action");
      if (action === "select-turn") {
        selectedTurnId = el.getAttribute("data-turn");
        renderBoard({ keepTurnScroll: true, skipInsight: true });
        return;
      }
      if (action === "toggle-turns") { turnsCollapsed = !turnsCollapsed; renderBoard(); }
      if (action === "toggle-tool") {
        const card = el.closest(".card-tool");
        if (!card) return;
        const collapsed = card.getAttribute("data-collapsed") === "1";
        card.setAttribute("data-collapsed", collapsed ? "0" : "1");
        card.querySelector(".tool-body")?.classList.toggle("hidden", !collapsed);
        el.textContent = collapsed ? "▾" : "▸";
        el.setAttribute("aria-label", collapsed ? "收起" : "展开");
        return;
      }
      if (action === "toggle-model") {
        const card = el.closest(".card-model");
        if (!card) return;
        const collapsed = card.getAttribute("data-collapsed") !== "0";
        card.setAttribute("data-collapsed", collapsed ? "0" : "1");
        el.textContent = collapsed ? "▾" : "▸";
        el.setAttribute("aria-label", collapsed ? "收起" : "展开");
        return;
      }
      if (action === "dismiss-banner") { bannerDismissed = true; renderBoard(); }
      if (action === "toggle-collapse") {
        const wrap = el.closest(".collapse");
        const collapsed = wrap.getAttribute("data-collapsed") === "1";
        wrap.setAttribute("data-collapsed", collapsed ? "0" : "1");
        wrap.querySelector(".collapse-preview")?.classList.toggle("hidden", collapsed);
        wrap.querySelector(".collapse-full")?.classList.toggle("hidden", !collapsed);
        el.textContent = collapsed ? "Show less" : "Show more";
      }
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp") { e.preventDefault(); selectTurnByOffset(-1); }
      if (e.key === "ArrowDown") { e.preventDefault(); selectTurnByOffset(1); }
    });
    document.getElementById("btn-refresh").onclick = () => loadSessions();
    document.getElementById("btn-insight").onclick = () => {
      insightOpen = !insightOpen;
      applySidebar();
      renderInsight();
    };
    document.getElementById("chip-inprogress").onclick = () => {
      listMode = listMode === "inprogress" ? "tree" : "inprogress";
      renderSessions();
    };
    document.getElementById("filters").onclick = (e) => {
      const chip = e.target.closest("[data-harness]");
      if (!chip) return;
      harnessFilter = chip.getAttribute("data-harness") || "all";
      for (const el of document.querySelectorAll("#filters .chip")) {
        el.classList.toggle("on", el === chip);
      }
      // harness filter stays orthogonal; does not force exit in-progress mode
      loadSessions();
    };
    document.getElementById("btn-theme").onclick = () => {
      const light = document.body.classList.toggle("light");
      const btn = document.getElementById("btn-theme");
      btn.textContent = light ? "深色" : "浅色";
    };
    connectEvents();
    loadSessions();
  
})();
