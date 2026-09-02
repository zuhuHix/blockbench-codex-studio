import { describe, expect, it } from "vitest";

import {
  providerForModel,
  resolveEffort,
  mcpServerName,
} from "./agent-providers.js";

describe("agent providers", () => {
  it("routes each supported model to its provider", () => {
    expect(providerForModel("gpt-5.6-terra").id).toBe("codex");
    expect(providerForModel("claude-opus-5").id).toBe("claude");
    expect(() => providerForModel("gpt-4")).toThrow(
      "Unsupported assistant model.",
    );
  });

  it("builds Claude arguments that isolate the bridge MCP server", () => {
    const args = providerForModel("claude-sonnet-5").buildArguments({
      model: "claude-sonnet-5",
      effort: "high",
      port: 48172,
    });
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain(`mcp__${mcpServerName}`);
    expect(args).not.toContain("--resume");
    const config = JSON.parse(args[args.indexOf("--mcp-config") + 1]!) as {
      mcpServers: Record<
        string,
        { url: string; headers: Record<string, string> }
      >;
    };
    expect(config.mcpServers[mcpServerName]!.url).toBe(
      "http://127.0.0.1:48172/mcp",
    );
    expect(config.mcpServers[mcpServerName]!.headers.Authorization).toBe(
      "Bearer ${BLOCKBENCH_CODEX_TOKEN}",
    );
  });

  it("resumes an existing Claude session by identifier", () => {
    const args = providerForModel("claude-opus-5").buildArguments({
      model: "claude-opus-5",
      effort: "max",
      port: 48172,
      resumeKey: "session-abc",
    });
    expect(args[args.indexOf("--resume") + 1]).toBe("session-abc");
    expect(args[args.indexOf("--effort") + 1]).toBe("max");
  });

  it("passes reasoning effort to Codex through its config override", () => {
    const args = providerForModel("gpt-5.6-sol").buildArguments({
      model: "gpt-5.6-sol",
      effort: "xhigh",
      port: 48172,
    });
    expect(args).toContain('model_reasoning_effort="xhigh"');
  });

  it("defaults to medium effort and rejects levels the CLI lacks", () => {
    const claude = providerForModel("claude-opus-5");
    const codex = providerForModel("gpt-5.6-sol");
    expect(resolveEffort(claude)).toBe("medium");
    expect(resolveEffort(claude, "max")).toBe("max");
    // "max" is Claude-only; "minimal" is Codex-only.
    expect(() => resolveEffort(codex, "max")).toThrow(
      "Unsupported effort level for codex.",
    );
    expect(() => resolveEffort(claude, "minimal")).toThrow(
      "Unsupported effort level for claude.",
    );
  });

  it("reads assistant text and the session key from Claude stream events", () => {
    const provider = providerForModel("claude-opus-5");
    expect(
      provider.parseEvent({
        type: "system",
        subtype: "init",
        session_id: "abc",
      }),
    ).toEqual({ sessionKey: "abc", assistantText: undefined });
    expect(
      provider.parseEvent({
        type: "assistant",
        session_id: "abc",
        message: {
          content: [
            { type: "thinking", thinking: "hidden" },
            { type: "text", text: "Hello" },
          ],
        },
      }),
    ).toEqual({ sessionKey: "abc", assistantText: "Hello" });
  });

  it("reads agent messages and the thread key from Codex stream events", () => {
    const provider = providerForModel("gpt-5.6-luna");
    expect(
      provider.parseEvent({
        thread_id: "thread-1",
        item: { type: "agent_message", text: "Hi" },
      }),
    ).toEqual({ sessionKey: "thread-1", assistantText: "Hi" });
  });
});
