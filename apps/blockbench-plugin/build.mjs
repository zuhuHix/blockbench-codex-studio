import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/blockbench-codex-studio.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  sourcemap: true,
  external: ["node:http"],
  banner: { js: "// Blockbench Codex Studio - generated development plugin" },
});
