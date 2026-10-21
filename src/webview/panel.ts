import * as fs from "fs";
import * as vscode from "vscode";
import { parseTranscriptFile } from "../parser/parseTranscript";
import type { WorkflowSession } from "../parser/types";

/**
 * Host for the Agent Workflow WebviewPanel.
 * Rich UI lives in media/webview.js + media/webview.css — keep this file as wiring only.
 */
export class WorkflowPanel {
  public static readonly viewType = "caw.workflowPanel";

  private static current: WorkflowPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private filePath: string;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    filePath: string
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.filePath = filePath;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => {
        if (msg?.type === "ready") {
          this.postSession();
        }
      },
      null,
      this.disposables
    );

    this.panel.webview.html = this.getHtml(this.panel.webview);
    this.postSession();
  }

  static show(extensionUri: vscode.Uri, filePath: string): WorkflowPanel {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (WorkflowPanel.current) {
      WorkflowPanel.current.filePath = filePath;
      WorkflowPanel.current.panel.reveal(column);
      WorkflowPanel.current.panel.webview.html = WorkflowPanel.current.getHtml(
        WorkflowPanel.current.panel.webview
      );
      WorkflowPanel.current.postSession();
      return WorkflowPanel.current;
    }

    const panel = vscode.window.createWebviewPanel(
      WorkflowPanel.viewType,
      "Agent Workflow",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      }
    );

    WorkflowPanel.current = new WorkflowPanel(panel, extensionUri, filePath);
    return WorkflowPanel.current;
  }

  /** Refresh if this panel is showing the given path (or any path if omitted). */
  static refreshOpen(filePath?: string): void {
    const cur = WorkflowPanel.current;
    if (!cur) {
      return;
    }
    if (filePath && cur.filePath !== filePath) {
      // Still refresh if same session dir / any change under watch
      try {
        if (!fs.existsSync(cur.filePath)) {
          return;
        }
      } catch {
        return;
      }
    }
    cur.postSession();
  }

  private postSession(): void {
    let session: WorkflowSession;
    try {
      session = parseTranscriptFile(this.filePath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void this.panel.webview.postMessage({
        type: "error",
        message,
      });
      return;
    }

    this.panel.title = "Agent Workflow";
    void this.panel.webview.postMessage({
      type: "session",
      session,
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "webview.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "webview.css")
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Agent Workflow</title>
</head>
<body>
  <!-- Hook: rich UI is owned by media/webview.js; host only posts {type:'session', session}. -->
  <div id="app">
    <p class="loading">Loading session…</p>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    WorkflowPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 32; i++) {
    s += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return s;
}
