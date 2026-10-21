import * as vscode from "vscode";
import { scanSessions, type ProjectGroup } from "./scanSessions";
import type { SessionSummary } from "./parser/types";

export type SessionTreeItemKind = "project" | "session";

export class SessionItem extends vscode.TreeItem {
  constructor(
    public readonly kind: SessionTreeItemKind,
    label: string,
    collapsible: vscode.TreeItemCollapsibleState,
    public readonly summary?: SessionSummary,
    public readonly projectKey?: string
  ) {
    super(label, collapsible);
    if (kind === "session" && summary) {
      this.contextValue = "session";
      this.description = summary.timestamp ?? undefined;
      this.tooltip = summary.preview
        ? `${summary.preview}\n${summary.filePath}`
        : summary.filePath;
      this.command = {
        command: "caw.openSession",
        title: "Open Agent Workflow",
        arguments: [summary.filePath],
      };
      this.iconPath = new vscode.ThemeIcon("comment-discussion");
    } else {
      this.contextValue = "project";
      this.iconPath = new vscode.ThemeIcon("folder");
    }
  }
}

export class SessionTreeProvider implements vscode.TreeDataProvider<SessionItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    SessionItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private cache: ProjectGroup[] = [];

  refresh(): void {
    this.cache = scanSessions();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SessionItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SessionItem): Thenable<SessionItem[]> {
    if (!element) {
      if (this.cache.length === 0) {
        this.cache = scanSessions();
      }
      return Promise.resolve(
        this.cache.map(
          (g) =>
            new SessionItem(
              "project",
              g.projectLabel,
              vscode.TreeItemCollapsibleState.Collapsed,
              undefined,
              g.projectKey
            )
        )
      );
    }

    if (element.kind === "project") {
      const group = this.cache.find((g) => g.projectKey === element.projectKey);
      if (!group) {
        return Promise.resolve([]);
      }
      return Promise.resolve(
        group.sessions.map((s) => {
          const label = s.preview || s.id.slice(0, 8);
          return new SessionItem(
            "session",
            label,
            vscode.TreeItemCollapsibleState.None,
            s
          );
        })
      );
    }

    return Promise.resolve([]);
  }
}

export { scanSessions } from "./scanSessions";
