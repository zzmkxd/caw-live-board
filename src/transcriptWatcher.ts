import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

/**
 * Watch Cursor agent-transcript directories (read-only).
 * Prefer Node fs.watch — VS Code FileSystemWatcher often misses paths
 * outside the open workspace on Windows.
 */
export class TranscriptWatcher implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private debounceTimer: NodeJS.Timeout | undefined;
  private readonly debounceMs = 400;

  constructor(private readonly onChange: () => void) {}

  start(): void {
    this.disposeWatchers();

    const root = path.join(os.homedir(), ".cursor", "projects");
    if (!fs.existsSync(root)) {
      try {
        fs.mkdirSync(root, { recursive: true });
      } catch {
        /* ignore — nothing to watch yet */
      }
    }

    const fire = (): void => {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = undefined;
        this.onChange();
      }, this.debounceMs);
    };

    try {
      const watcher = fs.watch(root, { recursive: true }, () => fire());
      watcher.on("error", () => {
        /* ignored; interval fallback not auto-switched at runtime */
      });
      this.disposables.push({
        dispose: () => {
          try {
            watcher.close();
          } catch {
            /* ignore */
          }
        },
      });
      return;
    } catch {
      /* fall through */
    }

    try {
      const pattern = new vscode.RelativePattern(
        vscode.Uri.file(root),
        "**/agent-transcripts/**/*.jsonl"
      );
      const vw = vscode.workspace.createFileSystemWatcher(pattern);
      this.disposables.push(
        vw,
        vw.onDidCreate(fire),
        vw.onDidChange(fire),
        vw.onDidDelete(fire)
      );
    } catch {
      const id = setInterval(() => this.onChange(), 5000);
      this.disposables.push({ dispose: () => clearInterval(id) });
    }
  }

  private disposeWatchers(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }

  dispose(): void {
    this.disposeWatchers();
  }
}
