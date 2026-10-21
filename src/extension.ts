import * as vscode from "vscode";
import { SessionTreeProvider } from "./sessionTree";
import { TranscriptWatcher } from "./transcriptWatcher";
import { WorkflowPanel } from "./webview/panel";

export function activate(context: vscode.ExtensionContext): void {
  const tree = new SessionTreeProvider();
  tree.refresh();

  const treeView = vscode.window.createTreeView("caw.sessions", {
    treeDataProvider: tree,
    showCollapseAll: true,
  });

  const openSession = (filePath?: string): void => {
    if (!filePath || typeof filePath !== "string") {
      void vscode.window.showInformationMessage("Select a session in the Agent Workflow sidebar.");
      return;
    }
    WorkflowPanel.show(context.extensionUri, filePath);
  };

  const refreshAll = (): void => {
    tree.refresh();
    WorkflowPanel.refreshOpen();
  };

  const watcher = new TranscriptWatcher(() => {
    refreshAll();
  });
  watcher.start();

  context.subscriptions.push(
    treeView,
    watcher,
    vscode.commands.registerCommand("caw.refresh", refreshAll),
    vscode.commands.registerCommand("caw.openSession", (arg?: string | { filePath?: string }) => {
      if (typeof arg === "string") {
        openSession(arg);
      } else if (arg && typeof arg === "object" && typeof arg.filePath === "string") {
        openSession(arg.filePath);
      } else {
        openSession(undefined);
      }
    })
  );
}

export function deactivate(): void {
  /* no-op */
}
