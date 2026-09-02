import { build } from "esbuild";
import { resolve } from "node:path";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/blockbench_codex_studio.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  sourcemap: true,
  define: {
    __STUDIO_SERVER_SCRIPT__: JSON.stringify(
      resolve("../mcp-server/dist/cli.js"),
    ),
  },
  banner: { js: "// Blockbench Codex Studio - generated development plugin" },
});
