import { existsSync } from "node:fs";
import { join } from "node:path";

export interface ProviderEvent {
  readonly assistantText?: string;
  readonly sessionKey?: string;
}

export interface BuildOptions {
  readonly model: string;
  readonly effort: string;
  readonly port: number;
  readonly resumeKey?: string;
}

export interface AgentProvider {
  readonly id: string;
  readonly models: readonly string[];
  /** Reasoning effort levels this CLI accepts, cheapest first. */
  readonly efforts: readonly string[];
  readonly busyMessage: string;
  /** Executable plus any leading arguments needed to reach the CLI. */
  entrypoint(): { readonly command: string; readonly args: readonly string[] };
  buildArguments(options: BuildOptions): readonly string[];
  parseEvent(event: Record<string, unknown>): ProviderEvent;
}

export const mcpServerName = "blockbench-codex-studio";

function npmGlobalPackage(...segments: readonly string[]): string {
  const appData = process.env.APPDATA;
  if (appData === undefined) throw new Error("APPDATA is unavailable.");
  return join(appData, "npm", "node_modules", ...segments);
}

const codexProvider: AgentProvider = {
  id: "codex",
  models: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
  efforts: ["minimal", "low", "medium", "high", "xhigh"],
  busyMessage: "Codex is working",

  entrypoint() {
    const script = npmGlobalPackage("@openai", "codex", "bin", "codex.js");
    if (!existsSync(script)) throw new Error("The Codex CLI is not installed.");
    return { command: process.execPath, args: [script] };
  },

  buildArguments({ model, effort, port, resumeKey }) {
    const isNew = resumeKey === undefined;
    return [
      ...(isNew ? ["exec"] : ["exec", "resume", resumeKey]),
      "-",
      "--json",
      "--model",
      model,
      ...(isNew ? ["--sandbox", "read-only"] : []),
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--ignore-rules",
      "-c",
      `model_reasoning_effort="${effort}"`,
      "-c",
      'approval_policy="never"',
      "-c",
      `mcp_servers.${mcpServerName}.url="http://127.0.0.1:${port}/mcp"`,
      "-c",
      `mcp_servers.${mcpServerName}.bearer_token_env_var="BLOCKBENCH_CODEX_TOKEN"`,
    ];
  },

  parseEvent(event) {
    const threadId = event.thread_id;
    const item = event.item as Record<string, unknown> | undefined;
    const text = item?.text;
    return {
      sessionKey: typeof threadId === "string" ? threadId : undefined,
      assistantText:
        item?.type === "agent_message" && typeof text === "string"
          ? text
          : undefined,
    };
  },
};

const claudeProvider: AgentProvider = {
  id: "claude",
  models: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
  efforts: ["low", "medium", "high", "xhigh", "max"],
  busyMessage: "Claude is working",

  entrypoint() {
    const executable = npmGlobalPackage(
      "@anthropic-ai",
      "claude-code",
      "bin",
      "claude.exe",
    );
    if (!existsSync(executable))
      throw new Error("The Claude Code CLI is not installed.");
    return { command: executable, args: [] };
  },

  buildArguments({ model, effort, port, resumeKey }) {
    const mcpConfig = JSON.stringify({
      mcpServers: {
        [mcpServerName]: {
          type: "http",
          url: `http://127.0.0.1:${port}/mcp`,
          headers: { Authorization: "Bearer ${BLOCKBENCH_CODEX_TOKEN}" },
        },
      },
    });
    return [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      model,
      "--effort",
      effort,
      ...(resumeKey === undefined ? [] : ["--resume", resumeKey]),
      "--mcp-config",
      mcpConfig,
      "--strict-mcp-config",
      "--permission-mode",
      "dontAsk",
      "--allowedTools",
      `mcp__${mcpServerName}`,
    ];
  },

  parseEvent(event) {
    const sessionId = event.session_id;
    const sessionKey = typeof sessionId === "string" ? sessionId : undefined;
    if (event.type !== "assistant") return { sessionKey };
    const message = event.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (!Array.isArray(content)) return { sessionKey };
    const text = content
      .filter(
        (block): block is { type: "text"; text: string } =>
          typeof block === "object" &&
          block !== null &&
          (block as { type?: unknown }).type === "text" &&
          typeof (block as { text?: unknown }).text === "string",
      )
      .map((block) => block.text)
      .join("");
    return { sessionKey, assistantText: text.length > 0 ? text : undefined };
  },
};

export const agentProviders: readonly AgentProvider[] = [
  codexProvider,
  claudeProvider,
];

export function resolveEffort(
  provider: AgentProvider,
  effort?: string,
): string {
  if (effort === undefined)
    return provider.efforts.includes("medium")
      ? "medium"
      : provider.efforts[0]!;
  if (!provider.efforts.includes(effort))
    throw new Error(`Unsupported effort level for ${provider.id}.`);
  return effort;
}

export function providerForModel(model: string): AgentProvider {
  const provider = agentProviders.find((candidate) =>
    candidate.models.includes(model),
  );
  if (provider === undefined) throw new Error("Unsupported assistant model.");
  return provider;
}
