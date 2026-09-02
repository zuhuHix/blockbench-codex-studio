import { execFile } from "node:child_process";

/** Opens the folder in the platform file manager, never a file's contents. */
export function revealInFileManager(absolutePath: string): void {
  const command =
    process.platform === "win32"
      ? "explorer.exe"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  execFile(command, [absolutePath], () => {
    // Explorer reports a non-zero exit even when the window opened.
  });
}
