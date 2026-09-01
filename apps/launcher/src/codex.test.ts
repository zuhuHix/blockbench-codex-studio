import { describe, expect, it } from "vitest";

import { createMcpRegistrationArguments, parseCodexVersion } from "./codex.js";

describe("Codex setup", () => {
  it("parses the Codex CLI version", () => {
    expect(parseCodexVersion("codex-cli 0.152.0\n")).toBe("0.152.0");
  });

  it("constructs explicit Streamable HTTP registration arguments", () => {
    expect(createMcpRegistrationArguments(48172)).toEqual([
      "mcp",
      "add",
      "blockbench-codex-studio",
      "--url",
      "http://127.0.0.1:48172/mcp",
      "--bearer-token-env-var",
      "BLOCKBENCH_CODEX_TOKEN",
    ]);
  });

  it("rejects invalid ports", () => {
    expect(() => createMcpRegistrationArguments(0)).toThrow();
  });
});
