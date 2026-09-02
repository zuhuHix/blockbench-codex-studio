import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";

import {
  providerForModel,
  resolveEffort,
  type AgentProvider,
} from "./agent-providers.js";

export type ChatEvent = {
  readonly id: number;
  readonly type: string;
  readonly text?: string;
  readonly detail?: unknown;
  readonly createdAt: string;
};

type ChatSession = {
  readonly id: string;
  providerId?: string;
  resumeKey?: string;
  process?: ChildProcessWithoutNullStreams;
  nextEventId: number;
  events: ChatEvent[];
};

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
    effort?: string,
  ): void {
    const session = this.#session(sessionId);
    if (session.process !== undefined)
      throw new Error("The assistant is already working.");
    const provider = providerForModel(model);
    if (session.providerId !== undefined && session.providerId !== provider.id)
      throw new Error(
        "Start a new chat to switch between Codex and Claude models.",
      );
    const cleanPrompt = prompt.trim();
    if (cleanPrompt.length === 0 || cleanPrompt.length > 20_000)
      throw new Error("Prompt must contain between 1 and 20,000 characters.");

    const { command, args: prefix } = provider.entrypoint();
    const child = spawn(
      command,
      [
        ...prefix,
        ...provider.buildArguments({
          model,
          effort: resolveEffort(provider, effort),
          port,
          resumeKey: session.resumeKey,
        }),
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, BLOCKBENCH_CODEX_TOKEN: token },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    session.providerId = provider.id;
    session.process = child;
    this.#push(session, "status", provider.busyMessage);
    child.stdin.end(cleanPrompt);

    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      const lines = stdout.split(/\r?\n/u);
      stdout = lines.pop() ?? "";
      for (const line of lines) this.#consume(session, provider, line);
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4_000);
    });
    child.on("close", (code) => {
      if (stdout.trim() !== "") this.#consume(session, provider, stdout);
      session.process = undefined;
      if (code === 0) this.#push(session, "done", "Ready");
      else
        this.#push(
          session,
          "error",
          stderr.trim() || `The assistant exited with code ${code}.`,
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
    this.#push(session, "status", "Stopping the assistant");
  }

  #consume(session: ChatSession, provider: AgentProvider, line: string): void {
    try {
      const raw = JSON.parse(line) as Record<string, unknown>;
      const event = provider.parseEvent(raw);
      if (event.sessionKey !== undefined) session.resumeKey = event.sessionKey;
      if (event.assistantText !== undefined) {
        this.#push(session, "assistant", event.assistantText);
      } else {
        this.#push(session, "tool", undefined, raw);
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
