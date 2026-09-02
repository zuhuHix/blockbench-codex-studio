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

This builds the workspace, creates or reuses a user-local development token under `%LOCALAPPDATA%\BlockbenchCodexStudio`, and launches Blockbench. Side-load the generated plugin once through **File > Plugins > Load Plugin from File**, allow its `net`, `child_process`, and `process` permissions, and enter the printed token through **Tools > Configure Codex Studio**. Blockbench remembers the file plugin, permissions, and token. The plugin starts its owned companion hidden when necessary, reconnects automatically, and terminates that owned process when the plugin unloads or Blockbench closes. Nothing is written into the repository or Blockbench project.

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

## Phase 4 UV workflow

With the connected anchor and target cubes selected:

1. Call `get_cube_face_uvs` for any cube to inspect its explicit north, south, east, west, up, and down mappings.
2. Call `measure_uv_coverage` for the selected set. Coverage is the unique clipped atlas area, so overlapping islands are not counted repeatedly.
3. Call `audit_uv_seams` to compare current target mappings with deterministic world-space projection from the inferred anchor.
4. Call `project_connected_uv` to create a draft containing all six target-face mappings. The projection preserves the anchor texture, face rotation, UV direction (including flipped axes), and texels per model unit.
5. Inspect and validate the draft, then call `commit_draft`. The plugin applies every face mapping as one named Blockbench Undo entry and refreshes geometry and UV views.
6. Measure coverage and audit seams again, inspect the viewport, and verify that one Ctrl+Z restores the original mappings.

`set_face_uv` provides a direct typed mapping tool. `pack_uv_islands` produces deterministic non-overlapping rows within the published project texture dimensions, preserving island size and flipped direction. `normalize_texel_density` stages a requested pixels-per-model-unit scale for all enabled selected faces. Root-level cubes, missing six-face snapshots, stale face mappings, invalid atlas sizes, and islands that cannot fit are rejected.

The algorithms and MCP/Undo path are covered by the automated gate. The textured fixture has also passed live acceptance in Blockbench with increased coverage and no visible or audited discontinuities.

## Live acceptance evidence

The specimen fixture was accepted against Blockbench 5.1.6 on 2026-09-01:

- Authenticated snapshots and a 768x768 viewport were received from the installed development plugin.
- `main_blob` was inferred as the anchor for the three-cube selection.
- Two loose targets were staged with their original dimensions and parent group preserved.
- `validate_draft` returned valid with zero errors.
- The committed result reported one connected component and two physical contact edges.
- The result viewport was captured through MCP.
- One Ctrl+Z restored both target bounds exactly and returned connectivity to three components with zero edges.

The textured Phase 4 fixture was accepted against Blockbench 5.1.6 on 2026-09-02:

- The typed bridge selected all three connected fixture cubes without manual UI setup.
- Continuous projection validated as one draft containing 12 target-face operations.
- The seam audit improved from 12 discontinuities to zero.
- Unique atlas coverage increased from 37.5% to 42.72%, a 13.9% relative increase.
- Before, after, and restored viewports were captured and visually inspected.
- One native Undo restored all 18 original face mappings exactly.

For repeatable diagnostics, `scripts/live-acceptance.mjs` supports `inspect`, `stage`, `commit <transaction-id>`, and `viewport <output.png>` actions when `BLOCKBENCH_CODEX_TOKEN` is set.

For the complete Phase 4 acceptance, launch `specimen-uv-chain.bbmodel` and run `node scripts/live-acceptance.mjs phase4 [output-prefix]`. The script selects the three fixture cubes through the typed bridge, records coverage and seam audits, commits continuous projection, saves before/after/restored viewports, and verifies that one native Undo restores every original face mapping exactly.

Codex registration is explicit and uses the supported Streamable HTTP flags:

```powershell
codex mcp add blockbench-codex-studio --url http://127.0.0.1:48172/mcp --bearer-token-env-var BLOCKBENCH_CODEX_TOKEN
```

Do not commit the token or place it in the Blockbench project file.

## Phase 5 image provider detection

The `detect_image_providers` MCP tool and the authenticated `GET /bridge/image-providers` endpoint report every image generation backend, which one will be used, and whether it may bill the user. The report never contains a key, only where one was found.

| Backend          | Configuration                                                                                                                  | Cost                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| Codex-native     | Codex CLI installed **and** `BLOCKBENCH_CODEX_NATIVE_IMAGES=1`                                                                 | none                          |
| Local ComfyUI    | an instance answering `/system_stats` at `BLOCKBENCH_CODEX_COMFYUI_URL` (default `http://127.0.0.1:8188`)                      | none                          |
| OpenAI GPT Image | `BLOCKBENCH_CODEX_OPENAI_API_KEY`, `OPENAI_API_KEY`, or the `BlockbenchCodexStudio:OpenAI` entry in Windows Credential Manager | billed to your OpenAI account |

Cost-free backends are selected first, so nothing bills the account while a local option works. A Codex or ChatGPT login is never assumed to grant image generation; it requires the explicit opt-in above. Store the API key with Windows Credential Manager rather than in the repository or a project file:

```powershell
cmdkey /generic:BlockbenchCodexStudio:OpenAI /user:openai /pass
```

## Phase 5 reference manager

References are attached by name before any generation request is planned. `add_image_reference` takes the latest Blockbench capture when `source` is `viewport`; every other source supplies `mimeType`, `dataBase64`, `width`, and `height`. Payloads are validated against their declared format, capped at 8 MiB and 8 attachments, and never returned by `list_image_references` — tool results carry only names, provenance, roles, and sizes.

Roles are `shape`, `palette`, `layout`, `style`, and `edit-target`. `plan_image_generation` returns the exact request that would be sent: the prompt, each reference with its role, the selected provider, whether it bills the account, and any warnings. Planning contacts no provider and imports nothing.

The plan is `dispatchable: false` when a reference was detached or listed twice, when an editing mode (`edit-current-texture`, `inpaint-region`, `outpaint-extend`, `variation`, `pixel-art-conversion`) does not carry exactly one `edit-target`, or when no backend is configured. Advisory warnings, such as API cost or a decal without transparency, leave the plan dispatchable. Actual provider dispatch and the preview gallery arrive with the next Phase 5 slice.

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
