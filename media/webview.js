(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById("app");
  const COLLAPSE_CHARS = 480;

  let session = null;
  let selectedTurnId = null;
  let bannerDismissed = false;

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function prettyJson(raw) {
    const s = String(raw ?? "{}");
    try {
      return JSON.stringify(JSON.parse(s), null, 2);
    } catch {
      return s;
    }
  }

  function countSteps(turns) {
    let steps = 0;
    let tools = 0;
    for (const t of turns) {
      for (const step of t.steps || []) {
        steps += 1;
        tools += (step.tools || []).length;
      }
    }
    return { steps, tools };
  }

  function turnToolCount(turn) {
    let n = 0;
    for (const step of turn.steps || []) {
      n += (step.tools || []).length;
    }
    return n;
  }

  function collapsibleBlock(text, kind) {
    const full = String(text ?? "");
    const long = full.length > COLLAPSE_CHARS;
    const preview = long ? full.slice(0, COLLAPSE_CHARS) + "…" : full;
    const cls = kind === "json" ? "body mono" : "body";
    if (!long) {
      return `<pre class="${cls}">${esc(full)}</pre>`;
    }
    return (
      `<div class="collapse" data-collapsed="1">` +
      `<pre class="${cls} collapse-preview">${esc(preview)}</pre>` +
      `<pre class="${cls} collapse-full hidden">${esc(full)}</pre>` +
      `<button type="button" class="collapse-btn" data-action="toggle-collapse">Show more</button>` +
      `</div>`
    );
  }

  function selectTurnByOffset(delta) {
    if (!session) return;
    const turns = Array.isArray(session.turns) ? session.turns : [];
    if (!turns.length) return;
    let idx = turns.findIndex((t) => t.id === selectedTurnId);
    if (idx < 0) idx = 0;
    idx = Math.max(0, Math.min(turns.length - 1, idx + delta));
    selectedTurnId = turns[idx].id;
    render();
    const el = app.querySelector(`.turn-item.active`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }

  function renderCards(active) {
    if (!active) {
      return '<p class="empty">Select a turn to inspect the request and tool chain.</p>';
    }

    let html =
      `<article class="card card-user">` +
      `<div class="card-head"><span class="badge badge-user">User</span></div>` +
      `<div class="card-title">Request</div>` +
      collapsibleBlock(active.queryText || active.queryPreview || "", "text") +
      `</article>`;

    const steps = active.steps || [];
    if (!steps.length) {
      html += '<p class="empty chain-empty">No model steps in this turn.</p>';
      return html;
    }

    for (const step of steps) {
      const text = step.textPreview || "";
      html +=
        `<article class="card card-model">` +
        `<div class="card-head">` +
        `<span class="badge badge-model">Model</span>` +
        `<span class="card-meta">Step ${esc(String(step.index + 1))}</span>` +
        `</div>` +
        (text
          ? collapsibleBlock(text, "text")
          : '<p class="muted">No text in this step.</p>') +
        `</article>`;

      for (const tool of step.tools || []) {
        const input = prettyJson(tool.inputJson || "{}");
        html +=
          `<article class="card card-tool">` +
          `<div class="card-head">` +
          `<span class="badge badge-tool">Tool</span>` +
          `</div>` +
          `<div class="card-title">${esc(tool.name || "unknown")}</div>` +
          collapsibleBlock(input, "json") +
          `</article>`;
      }
    }
    return html;
  }

  function render() {
    if (!session) {
      app.innerHTML = '<p class="loading">Waiting for session data…</p>';
      return;
    }

    const summary = session.summary || {};
    const turns = Array.isArray(session.turns) ? session.turns : [];
    const { steps: stepCount, tools: toolCount } = countSteps(turns);
    const turnCount = summary.turnCount ?? turns.length;

    if (!selectedTurnId && turns.length) {
      selectedTurnId = turns[0].id;
    }
    const active =
      turns.find((t) => t.id === selectedTurnId) || turns[0] || null;
    if (active) selectedTurnId = active.id;

    const turnListHtml = turns.length
      ? turns
          .map((t) => {
            const activeCls = active && t.id === active.id ? " active" : "";
            const tools = turnToolCount(t);
            const ts = t.timestamp
              ? `<span class="ts">${esc(t.timestamp)}</span>`
              : "";
            return (
              `<button type="button" class="turn-item${activeCls}" data-action="select-turn" data-turn="${esc(t.id)}">` +
              `<div class="turn-top">` +
              `<span class="idx">#${esc(String(t.index + 1))}</span>` +
              (tools
                ? `<span class="tool-badge" title="Tool calls">${esc(String(tools))}</span>`
                : `<span class="tool-badge zero">0</span>`) +
              `</div>` +
              ts +
              `<span class="preview">${esc(t.queryPreview || "")}</span>` +
              `</button>`
            );
          })
          .join("")
      : '<p class="empty">No turns in this session.</p>';

    const banner = bannerDismissed
      ? ""
      : `<div class="banner" role="note">` +
        `<span>Call only — tool outcomes are not stored in agent-transcripts.</span>` +
        `<button type="button" class="banner-dismiss" data-action="dismiss-banner" aria-label="Dismiss">×</button>` +
        `</div>`;

    const label = summary.projectLabel || summary.projectKey || "Session";
    const sid = summary.id || "";

    app.innerHTML =
      `<header class="summary-bar">` +
      `<div class="summary-title">` +
      `<span class="brand">Agent Workflow</span>` +
      `<span class="sep">·</span>` +
      `<span class="proj" title="${esc(label)}">${esc(label)}</span>` +
      (sid
        ? `<span class="sid" title="${esc(sid)}">${esc(sid)}</span>`
        : "") +
      `</div>` +
      `<div class="stats">` +
      `<span class="stat"><b>${esc(String(turnCount))}</b> turns</span>` +
      `<span class="stat"><b>${esc(String(stepCount))}</b> steps</span>` +
      `<span class="stat"><b>${esc(String(toolCount))}</b> tools</span>` +
      `</div>` +
      `</header>` +
      banner +
      `<div class="layout">` +
      `<aside class="turn-list" aria-label="Turns">${turnListHtml}</aside>` +
      `<main class="detail">` +
      `<div class="chain" aria-label="Turn chain">${renderCards(active)}</div>` +
      `</main>` +
      `</div>`;
  }

  app.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const actionEl = t.closest("[data-action]");
    if (!actionEl) return;
    const action = actionEl.getAttribute("data-action");

    if (action === "select-turn") {
      selectedTurnId = actionEl.getAttribute("data-turn");
      render();
      return;
    }
    if (action === "dismiss-banner") {
      bannerDismissed = true;
      render();
      return;
    }
    if (action === "toggle-collapse") {
      const wrap = actionEl.closest(".collapse");
      if (!wrap) return;
      const collapsed = wrap.getAttribute("data-collapsed") === "1";
      wrap.setAttribute("data-collapsed", collapsed ? "0" : "1");
      wrap.querySelector(".collapse-preview")?.classList.toggle("hidden", collapsed);
      wrap.querySelector(".collapse-full")?.classList.toggle("hidden", !collapsed);
      actionEl.textContent = collapsed ? "Show less" : "Show more";
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      selectTurnByOffset(-1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      selectTurnByOffset(1);
    }
  });

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "error") {
      app.innerHTML = `<p class="error">${esc(msg.message || "Parse error")}</p>`;
      return;
    }
    if (msg.type === "session") {
      session = msg.session;
      selectedTurnId = null;
      render();
    }
  });

  vscode.postMessage({ type: "ready" });
})();
