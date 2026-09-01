import { startStudioServer } from "./app.js";

const token = process.env.BLOCKBENCH_CODEX_TOKEN;
if (token === undefined) {
  throw new Error(
    "Set BLOCKBENCH_CODEX_TOKEN to a random token of at least 32 characters.",
  );
}

const port = Number.parseInt(process.env.BLOCKBENCH_CODEX_PORT ?? "48172", 10);
const running = await startStudioServer({ token, port });

console.log(
  `Blockbench Codex MCP Studio listening on http://${running.host}:${running.port}/mcp`,
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void running.close().then(() => process.exit(0));
  });
}
