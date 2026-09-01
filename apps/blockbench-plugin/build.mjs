import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/blockbench_codex_studio.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  sourcemap: true,
  banner: { js: "// Blockbench Codex Studio - generated development plugin" },
});
