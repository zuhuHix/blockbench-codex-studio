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

Use `npm ci` instead of `npm install` when verifying a clean checkout against the committed lockfile. `npm run check` is the release gate and must pass formatting, lint, tests, and a complete workspace build.

## Phase 1 development bridge

For the complete Windows development startup, run:

```powershell
.\scripts\Start-Development.ps1 -ProjectPath .\packages\test-fixtures\models\specimen-loose-chain.bbmodel
```

This builds the workspace, creates or reuses a user-local development token under `%LOCALAPPDATA%\BlockbenchCodexStudio`, starts the MCP server hidden, and launches Blockbench. Side-load the generated plugin once through **File > Plugins > Load Plugin from File**, allow its `net`, `child_process`, and `process` permissions, and enter the printed token through **Tools > Configure Codex Studio**. Blockbench remembers the file plugin, permissions, and token. On later Blockbench launches, the plugin probes the saved local bridge, starts the companion hidden when necessary, and reconnects automatically. Nothing is written into the repository or Blockbench project.

Manual startup remains available:

Build the plugin and server, then set a random bearer token before starting the server:

```powershell
$env:BLOCKBENCH_CODEX_TOKEN = '<random token containing at least 32 characters>'
npm run build
npm start -w @blockbench-codex/mcp-server
```

Install `apps/blockbench-plugin/dist/blockbench_codex_studio.js` as a development plugin in Blockbench. Open **Tools > Configure Codex Studio** and enter the same token. The plugin publishes project state once per second and publishes a 768x768 image when **Tools > Capture Viewport for Codex** is selected. Committed drafts also publish the resulting viewport automatically; the server retains that capture across later state-only snapshots.

## First playable chain workflow

With one main blob and at least one loose cube selected in the same Outliner group:

1. Call `connect_selected_chain`. The server infers the anchor from semantic naming and volume, preserves target dimensions, and stages physically overlapping moves in the targets' original dominant direction.
2. Inspect the returned operation list with `get_draft_summary`.
3. Call `validate_draft` to re-check the live project, parent groups, dimensions, and configured project bounds.
4. Call `commit_draft` with the returned transaction ID.
5. The plugin applies every move as one named Blockbench Undo entry, refreshes the canvas, and publishes a 768x768 result capture.
6. Call `capture_viewport` to inspect the result. One Ctrl+Z reverts the complete committed draft.

The semantic operation rejects root-level targets, mixed-group selections, stale geometry, dimension changes, and layouts outside known project bounds.

## Live acceptance evidence

The specimen fixture was accepted against Blockbench 5.1.6 on 2026-09-01:

- Authenticated snapshots and a 768x768 viewport were received from the installed development plugin.
- `main_blob` was inferred as the anchor for the three-cube selection.
- Two loose targets were staged with their original dimensions and parent group preserved.
- `validate_draft` returned valid with zero errors.
- The committed result reported one connected component and two physical contact edges.
- The result viewport was captured through MCP.
- One Ctrl+Z restored both target bounds exactly and returned connectivity to three components with zero edges.

For repeatable diagnostics, `scripts/live-acceptance.mjs` supports `inspect`, `stage`, `commit <transaction-id>`, and `viewport <output.png>` actions when `BLOCKBENCH_CODEX_TOKEN` is set.

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
