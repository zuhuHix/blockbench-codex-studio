import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export type ChatEvent = {
  readonly id: number;
  readonly type: string;
  readonly text?: string;
  readonly detail?: unknown;
  readonly createdAt: string;
};

type ChatSession = {
  readonly id: string;
  codexThreadId?: string;
  process?: ChildProcessWithoutNullStreams;
  nextEventId: number;
  events: ChatEvent[];
};

const allowedModels = new Set(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]);

function codexEntrypoint(): string {
  const appData = process.env.APPDATA;
  if (appData === undefined) throw new Error("APPDATA is unavailable.");
  const entrypoint = join(
    appData,
    "npm",
    "node_modules",
    "@openai",
    "codex",
    "bin",
    "codex.js",
  );
  if (!existsSync(entrypoint))
    throw new Error("The Codex CLI is not installed.");
  return entrypoint;
}

export class ChatManager {
  readonly #sessions = new Map<string, ChatSession>();

  create(): string {
    const id = randomUUID();
    this.#sessions.set(id, { id, nextEventId: 1, events: [] });
    return id;
  }

  events(sessionId: string, after = 0): readonly ChatEvent[] {
    return this.#session(sessionId).events.filter((event) => event.id > after);
  }

  send(
    sessionId: string,
    prompt: string,
    model: string,
    port: number,
    token: string,
  ): void {
    const session = this.#session(sessionId);
    if (session.process !== undefined)
      throw new Error("Codex is already working.");
    if (!allowedModels.has(model)) throw new Error("Unsupported Codex model.");
    const cleanPrompt = prompt.trim();
    if (cleanPrompt.length === 0 || cleanPrompt.length > 20_000)
      throw new Error("Prompt must contain between 1 and 20,000 characters.");

    const isNew = session.codexThreadId === undefined;
    const base = isNew ? ["exec"] : ["exec", "resume", session.codexThreadId!];
    const args = [
      codexEntrypoint(),
      ...base,
      "-",
      "--json",
      "--model",
      model,
      ...(isNew ? ["--sandbox", "read-only"] : []),
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--ignore-rules",
      "-c",
      'approval_policy="never"',
      "-c",
      `mcp_servers.blockbench-codex-studio.url="http://127.0.0.1:${port}/mcp"`,
      "-c",
      'mcp_servers.blockbench-codex-studio.bearer_token_env_var="BLOCKBENCH_CODEX_TOKEN"',
    ];
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: { ...process.env, BLOCKBENCH_CODEX_TOKEN: token },
      stdio: ["pipe", "pipe", "pipe"],
    });
    session.process = child;
    this.#push(session, "status", "Codex is working");
    child.stdin.end(cleanPrompt);

    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      const lines = stdout.split(/\r?\n/u);
      stdout = lines.pop() ?? "";
      for (const line of lines) this.#consume(session, line);
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4_000);
    });
    child.on("close", (code) => {
      if (stdout.trim() !== "") this.#consume(session, stdout);
      session.process = undefined;
      if (code === 0) this.#push(session, "done", "Ready");
      else
        this.#push(
          session,
          "error",
          stderr.trim() || `Codex exited with code ${code}.`,
        );
    });
    child.on("error", (error) => {
      session.process = undefined;
      this.#push(session, "error", error.message);
    });
  }

  stop(sessionId: string): void {
    const session = this.#session(sessionId);
    session.process?.kill();
    this.#push(session, "status", "Stopping Codex");
  }

  #consume(session: ChatSession, line: string): void {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const threadId = event.thread_id;
      if (typeof threadId === "string") session.codexThreadId = threadId;
      const item = event.item as Record<string, unknown> | undefined;
      const text = item?.text;
      if (item?.type === "agent_message" && typeof text === "string") {
        this.#push(session, "assistant", text);
      } else {
        this.#push(session, "tool", undefined, event);
      }
    } catch {
      this.#push(session, "tool", line);
    }
  }

  #push(
    session: ChatSession,
    type: string,
    text?: string,
    detail?: unknown,
  ): void {
    session.events.push({
      id: session.nextEventId++,
      type,
      text,
      detail,
      createdAt: new Date().toISOString(),
    });
    if (session.events.length > 500) session.events.splice(0, 100);
  }

  #session(id: string): ChatSession {
    const session = this.#sessions.get(id);
    if (session === undefined) throw new Error("Unknown chat session.");
    return session;
  }
}
