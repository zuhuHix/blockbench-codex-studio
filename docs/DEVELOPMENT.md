# Development

## Prerequisites

- Windows 10 or later
- Node.js 22 or later
- npm 11 or later
- Blockbench 5.x for live integration work
- Codex CLI for MCP integration work

## Commands

```powershell
npm install
npm test
npm run lint
npm run build
npm run check
```

## Phase 1 development bridge

Build the plugin and server, then set a random bearer token before starting the server:

```powershell
$env:BLOCKBENCH_CODEX_TOKEN = '<random token containing at least 32 characters>'
npm run build
npm start -w @blockbench-codex/mcp-server
```

Install `apps/blockbench-plugin/dist/blockbench-codex-studio.js` as a development plugin in Blockbench. Open **Tools > Configure Codex Studio** and enter the same token. The plugin publishes project state once per second and publishes a 768x768 image when **Tools > Capture Viewport for Codex** is selected.

Codex registration is explicit and uses the supported Streamable HTTP flags:

```powershell
codex mcp add blockbench-codex-studio --url http://127.0.0.1:48172/mcp --bearer-token-env-var BLOCKBENCH_CODEX_TOKEN
```

Do not commit the token or place it in the Blockbench project file.

## Workspace map

- `apps/blockbench-plugin`: in-process Blockbench adapter and UI
- `apps/mcp-server`: authenticated local MCP server and session broker
- `apps/launcher`: Windows prerequisite detection, diagnostics, and startup
- `packages/contracts`: shared schemas and protocol types
- `packages/geometry`: deterministic geometry and connectivity algorithms
- `packages/uv`: UV inspection and projection algorithms
- `packages/profiles`: project-profile loading and validation
- `packages/test-fixtures`: disposable Blockbench projects

Keep product scope changes in the master blueprint. Keep tool inputs and outputs in `packages/contracts`; model-facing operations must not accept arbitrary JavaScript.
