import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function runExecutable(
  executablePath: string,
  arguments_: readonly string[],
) {
  if (!executablePath.toLowerCase().endsWith(".cmd")) {
    return execFileAsync(executablePath, [...arguments_]);
  }
  return execFileAsync(process.env.ComSpec ?? "cmd.exe", [
    "/d",
    "/c",
    "call",
    executablePath,
    ...arguments_,
  ]);
}

export interface CodexDetectionResult {
  readonly detected: boolean;
  readonly executablePath?: string;
  readonly version?: string;
  readonly supportsStreamableHttpMcp: boolean;
  readonly error?: string;
}

export function parseCodexVersion(output: string): string | undefined {
  return /^codex-cli\s+([^\s]+)$/m.exec(output.trim())?.[1];
}

export function createMcpRegistrationArguments(
  port: number,
): readonly string[] {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("MCP port must be an integer between 1 and 65535.");
  }
  return [
    "mcp",
    "add",
    "blockbench-codex-studio",
    "--url",
    `http://127.0.0.1:${port}/mcp`,
    "--bearer-token-env-var",
    "BLOCKBENCH_CODEX_TOKEN",
  ];
}

export async function detectCodex(): Promise<CodexDetectionResult> {
  try {
    const where = await execFileAsync("where.exe", ["codex"]);
    const candidates = where.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const executablePath =
      candidates.find((candidate) => /\.(?:cmd|exe)$/iu.test(candidate)) ??
      candidates[0];
    if (executablePath === undefined)
      throw new Error("where.exe returned no Codex executable.");

    const versionOutput = await runExecutable(executablePath, ["--version"]);
    const helpOutput = await runExecutable(executablePath, [
      "mcp",
      "add",
      "--help",
    ]);
    return {
      detected: true,
      executablePath,
      version:
        parseCodexVersion(versionOutput.stdout) ?? versionOutput.stdout.trim(),
      supportsStreamableHttpMcp:
        helpOutput.stdout.includes("--url") &&
        helpOutput.stdout.includes("--bearer-token-env-var"),
    };
  } catch (error) {
    return {
      detected: false,
      supportsStreamableHttpMcp: false,
      error: error instanceof Error ? error.message : "Codex detection failed.",
    };
  }
}
