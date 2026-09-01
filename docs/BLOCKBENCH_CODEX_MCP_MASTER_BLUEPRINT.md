# Blockbench Codex MCP Studio — Master Product and Implementation Blueprint

Status: design specification for a new clean-room project  
Owner: project maintainers
Target platform: Windows desktop, Blockbench 5.x, Codex CLI  
Primary use case: keyboard-first AI-assisted Minecraft modeling without relying on precise mouse work

## 1. Product vision

Build a personal, polished Blockbench assistant that feels like an expert modeler living inside Blockbench. The user should be able to describe a result conversationally, select relevant geometry or images, and let Codex inspect, modify, validate, preview, and refine the model through a real Model Context Protocol tool loop.

The assistant must take initiative from visible project state instead of repeatedly asking the user to restate information already available in Blockbench. It should remain predictable: every edit is scoped, validated, previewable when desired, undoable, and prevented from silently escaping the intended group, texture folder, or geometry bounds.

This should be a standalone project rather than part of one Minecraft mod. Project-specific behavior belongs in optional profiles stored beside a Blockbench project or mod repository.

Suggested product names:

- Blockbench Codex Studio
- ForgeBench AI
- Codex Modelbench
- Blocksmith MCP
- BB Codex Workshop

## 2. Why replace the current bridge

### Current one-shot bridge

The current assistant sends a project snapshot and prompt to Codex. Codex returns one large JSON operation proposal, and the plugin validates and applies it.

Flow:

```text
User prompt
  -> Blockbench snapshot
  -> Codex generates one complete JSON plan
  -> Plugin validates
  -> Plugin applies
```

This is useful as a fallback, but Codex must guess every coordinate before it can inspect the result. The growing list of prompt rules and validators exists because the model cannot observe and correct intermediate actions.

### Real MCP workflow

A real MCP exposes Blockbench as a set of tools and resources. Codex can inspect, act, inspect again, capture the viewport, validate, undo, and refine during one request.

```text
User prompt
  -> Codex calls get_selection
  -> Codex calls inspect_connectivity
  -> Codex calls connect_selected_chain
  -> Codex calls capture_viewport
  -> Codex calls validate_draft
  -> Codex corrects if needed
  -> User accepts or auto-apply commits
```

The core difference is the feedback loop. The model is no longer forced to produce a perfect answer in one shot.

## 3. Clean-room and ownership boundary

This project will be designed and implemented from scratch to match the owner's preferences.

Existing Blockbench MCP projects may be used to understand protocol compatibility, common user expectations, and missing capabilities, but their source code should not be copied. In particular, `jasonjgardner/blockbench-mcp-plugin` is GPL-3.0; copying or deriving from its source would carry GPL obligations. If the goal is independent ownership and licensing, use the official MCP SDK and public Blockbench APIs directly.

Recommended project license: choose explicitly before publication. MIT is simple for a permissive open-source tool; a private repository needs no public license until distribution.

## 4. Proposed repository structure

```text
blockbench-codex-studio/
├─ apps/
│  ├─ blockbench-plugin/       # Blockbench UI and in-process model adapter
│  ├─ mcp-server/              # MCP protocol, tool registry, session broker
│  └─ launcher/                # Windows launcher, diagnostics, updater
├─ packages/
│  ├─ contracts/               # Shared Zod/JSON schemas and protocol types
│  ├─ geometry/                # Connectivity, layout, bounds, collision algorithms
│  ├─ uv/                      # UV projection, coverage, packing, validation
│  ├─ images/                  # Generation providers, conversion, preview metadata
│  ├─ profiles/                # Project-specific rules and art-direction profiles
│  └─ test-fixtures/           # Disposable bbmodel projects and expected outputs
├─ docs/
├─ scripts/
├─ tests/
└─ package.json
```

Use TypeScript for the MCP server, schemas, geometry, and tests. Bundle the Blockbench plugin into a single JavaScript file for installation.

## 5. Runtime architecture

Recommended architecture:

```text
Integrated Blockbench panel
        |
        | authenticated localhost channel
        v
Local companion / MCP server
        |
        | Streamable HTTP MCP
        v
Codex CLI
```

### Blockbench plugin

- Reads and modifies the active Blockbench project.
- Displays chat, status, proposals, image previews, settings, and logs.
- Executes only typed, validated commands.
- Owns Blockbench Undo transactions and viewport refresh.
- Never accepts arbitrary JavaScript evaluation from the model.

### MCP server

- Exposes tools, resources, and prompts.
- Maintains sessions and draft transactions.
- Performs schema validation before commands reach Blockbench.
- Hosts deterministic geometry and UV algorithms.
- Connects to Codex without embedding global secrets in the plugin.

### Local transport

- Bind only to `127.0.0.1`.
- Use a random bearer token generated on first launch.
- Store the token in Windows Credential Manager or a user-only configuration file.
- Reject browser origins and non-loopback requests.
- Display connection state and port in the UI.
- Allow port changes when occupied.

## 6. Codex detection and setup

The launcher should detect Codex automatically.

Detection sequence:

1. Run `where.exe codex`.
2. Check the common npm installation under `%APPDATA%\npm`.
3. Check known Codex desktop/runtime locations when available.
4. Run `codex --version` and parse the version.
5. Run `codex mcp add --help` to verify streamable HTTP MCP support.
6. Display `Codex detected`, version, executable path, and MCP capability.

If Codex is missing:

- Keep Blockbench modeling tools available in manual mode.
- Show a concise setup card rather than a terminal error.
- Provide `Locate Codex…`, `Copy install instructions`, and `Retry detection`.

MCP registration command concept:

```powershell
codex mcp add blockbench-codex-studio --url http://127.0.0.1:<port>/mcp --bearer-token-env-var BLOCKBENCH_CODEX_TOKEN
```

Registration should be initiated by an explicit button and confirmed to the user. Do not silently rewrite global Codex configuration.

When the MCP configuration changes, explain that a fresh Codex session may be required.

## 7. Integrated assistant panel

### Header

- Product name and plugin version.
- MCP status indicator.
- Codex detected/version indicator.
- Active project name.
- Compact diagnostics button.

### Model controls

- Model selector populated from detected/supported Codex models where possible.
- Friendly presets such as Sol / Terra / Luna when available.
- Codex Fast mode toggle.
- New conversation button.
- Current session indicator.

### Composer

- Enter sends.
- Shift+Enter inserts a newline.
- Image/reference attachment button.
- Capture viewport button.
- Clear attachments button.
- Visible list of active selections and references.
- Stop button while an agent run is active.

### Application controls

- `Apply changes immediately` toggle, enabled by default for safe operations.
- `Preview before Apply` behavior when auto-apply is off.
- Deletes, overwrites, broad exports, and destructive batch operations always require confirmation.
- Auto-refine toggle with a configurable 1–4 pass limit.
- Each pass must produce a separate Undo entry unless the user chooses one combined transaction.

### Layout and accessibility

- Entire panel must scroll vertically.
- Header and active-run status remain sticky.
- Apply/Discard action bar remains sticky and reachable.
- Floating panel is resizable in both directions.
- Sensible default floating size around 440×700.
- Docked and floating layouts both work.
- Long proposal details collapse into expandable sections.
- Keyboard navigation must cover every control.
- Remember panel size and section states.
- Avoid trapping nested scroll areas unnecessarily.

### History

- Display user, Codex, automatic refinement, validation, and tool-call events distinctly.
- Show concise summaries by default with expandable tool arguments/results.
- Allow copying a request or rerunning it against the current model state.
- Persist history per Blockbench project optionally.

## 8. MCP resources

Resources should make project state inspectable without dumping everything into every prompt.

- `blockbench://project/current`
- `blockbench://projects`
- `blockbench://selection`
- `blockbench://outline`
- `blockbench://groups/{id}`
- `blockbench://elements/{id}`
- `blockbench://textures`
- `blockbench://textures/{id}`
- `blockbench://uv/{element-id}`
- `blockbench://connectivity`
- `blockbench://validation`
- `blockbench://history`
- `blockbench://profile`

Large resources need filters, pagination, compact summaries, and exact UUIDs. Names are for humans; UUIDs are authoritative for edits.

## 9. MCP inspection tools

### Project and hierarchy

- `health`
- `get_project_summary`
- `list_projects`
- `list_groups`
- `list_outline`
- `get_element`
- `get_elements`
- `find_elements`
- `get_selection`
- `set_selection`
- `get_model_bounds`
- `get_format_constraints`

### Visual inspection

- `capture_viewport`
- `capture_standard_views` for top/front/back/left/right/isometric
- `capture_app_view`
- `set_camera`
- `focus_elements`
- `analyze_silhouette`

### Geometry analysis

- `measure_elements`
- `inspect_connectivity`
- `inspect_collisions`
- `inspect_out_of_bounds`
- `inspect_symmetry`
- `inspect_stage_membership`
- `infer_primary_anchor`
- `classify_selected_targets`

### Texture and UV analysis

- `list_textures`
- `get_texture_metadata`
- `get_texture_preview`
- `get_face_mappings`
- `inspect_uv_layout`
- `measure_uv_coverage`
- `inspect_uv_overlap`
- `inspect_uv_continuity`
- `analyze_texture_palette`

## 10. Draft transaction system

No complex request should modify the live model incrementally without a transaction boundary.

Required tools:

- `begin_draft`
- `get_draft_summary`
- `validate_draft`
- `preview_draft`
- `commit_draft`
- `discard_draft`
- `undo`
- `redo`
- `save_checkpoint`

Draft rules:

- Capture the original state required for rollback.
- Apply proposed edits to an isolated operation graph or temporary Blockbench state.
- Keep a readable diff of every changed element and face.
- A draft may be visually previewed, then completely reverted before user approval.
- Commit creates one named Blockbench Undo entry.
- A failed tool call automatically rolls back its partial action.
- Auto-refine cannot delete elements or overwrite files.

## 11. Low-level geometry tools

- `create_group`
- `create_cube`
- `update_cube`
- `move_cube_preserve_size`
- `rotate_cube`
- `duplicate_element`
- `move_to_group`
- `rename_element`
- `set_visibility`
- `delete_element`
- `apply_geometry_batch`

Low-level tools must enforce:

- Exact UUID targeting.
- Valid `from < to` bounds on all axes.
- Project-format rotation constraints.
- Existing destination groups.
- Configurable world safety envelope.
- No silent fallback to the Outliner root.
- No arbitrary dimension changes from a movement tool.

## 12. Semantic modeling tools

These are the main reason to build a personal MCP instead of exposing only Blockbench internals.

### `connect_selected_chain`

Purpose: turn loose pieces into continuous branches growing from a selected/inferred anchor.

Inputs:

- Anchor UUID or `infer`.
- Target UUIDs or current selection.
- Branch count.
- Preferred directions.
- Minimum/maximum overlap.
- Bend amount.
- Organic irregularity seed.
- Preserve size, volume, texture, UV, and group flags.
- Collision avoidance regions.

Behavior:

1. Identify the main blob from explicit selection, semantic names such as `main_blob` or `center_mound`, or largest central organic cube.
2. Treat remaining selected cubes as targets.
3. Classify targets by direction from the anchor.
4. Allocate them into branches.
5. Sort each branch from the anchor outward.
6. Preserve dimensions and volume.
7. Translate and optionally rotate pieces.
8. Require physical overlap or contact between consecutive pieces.
9. Avoid chamber walls, glass, floor penetration, and self-collision.
10. Keep every target inside its existing stage group.
11. Continue UV mapping from anchor to branch.
12. Return connectivity metrics and a visual preview.

It must reject the known exploit where cubes are merely enlarged until their bounding boxes touch.

### Other semantic tools

- `grow_from_surface`
- `arrange_organic_tentacles`
- `create_membrane_arms`
- `scatter_surface_details` with required surface attachment
- `build_radial_branches`
- `make_asymmetric`
- `fit_inside_container`
- `repair_disconnected_geometry`
- `simplify_geometry`
- `replace_repeated_cubes`
- `mirror_or_break_symmetry`

Every semantic tool should be deterministic enough to guarantee physical correctness while leaving visual choices to Codex.

## 13. Initiative and inference rules

Codex should not ask the user to repeat facts already visible in Blockbench.

- Infer the main anchor from selection, names, size, center, and image evidence.
- Infer stage from names and parent folders.
- Infer target cubes as selected non-anchor geometry.
- Prefer modifying existing geometry before creating replacements.
- Preserve existing dimensions unless resizing is requested.
- Preserve groups, textures, UVs, visibility, and names by default.
- If one reasonable interpretation dominates, act and preview it.
- Ask a question only when two materially different edits remain genuinely indistinguishable.
- Never claim metadata is missing when the corresponding MCP resource/tool result is available.
- Empty refusal-style responses should be retried once with explicit derived context.

## 14. Group and stage safety

- Naming `Stage 2` should resolve to the exact existing `culture_stage_2` group when unambiguous.
- Selecting a cube inside one parent group should scope new related geometry to that group.
- Every proposal must display its destination group.
- Unknown groups are errors.
- Root-level placement is forbidden when a stage or selected parent is known.
- Moving between stages requires explicit intent and a visible warning.
- Group hierarchy and visibility must be inspectable before edits.

## 15. UV and texture system

### Six-face contract

Every Minecraft cube face must be represented: north, south, east, west, up, and down. Disabled faces use explicit null/disabled values rather than being omitted.

### UV tools

- `get_cube_face_uvs`
- `set_face_uv`
- `set_face_texture`
- `rotate_face_uv`
- `project_connected_uv`
- `pack_uv_islands`
- `transform_uv_islands`
- `normalize_texel_density`
- `match_anchor_texel_density`
- `measure_uv_coverage`
- `audit_uv_seams`

### Continuous blob projection

Connected pieces should sample the same texture scale as the main blob. For each face orientation, derive the UV scale from the anchor's world-space axes, then extrapolate the target rectangle by its physical offset. Subsequent pieces may anchor to the previous accepted piece, producing a continuous chain.

Requirements:

- Preserve face rotation and texture identity.
- Support negative/flipped UV directions.
- Detect out-of-atlas coordinates.
- Offer wrap, clamp, repack, or expand-atlas strategies.
- Display before/after UV coverage percentage.
- Never reuse a tiny identical patch on every cube unless intentionally tiled.

## 16. Image and texture generation workspace

Image generation is a first-class workspace, not a single button.

### Provider detection

On startup:

1. Detect Codex.
2. Detect whether the active Codex environment exposes image generation.
3. Detect an optional OpenAI API configuration without printing secrets.
4. Detect optional local providers such as ComfyUI.
5. Clearly show which backend will be used and whether it may incur API cost.

Provider options:

- Codex-native image generation when genuinely available to the session.
- OpenAI GPT Image through a separately configured API key.
- Local ComfyUI/Stable Diffusion as an optional advanced backend.

Do not assume the Codex/ChatGPT login grants direct API image access. Never store an API key in the plugin source, project file, or chat history. Prefer Windows Credential Manager or environment-based configuration.

### Generation modes

- New seamless texture.
- Edit current texture.
- Create UV atlas.
- Generate transparent decal/cutout.
- Create visual concept reference.
- Create variation from generated image.
- Inpaint selected image region.
- Extend/outpaint texture.
- Convert concept art to controlled Minecraft pixel art.

### Reference sources

The user must be able to select one or several named references easily:

- Current Blockbench viewport.
- Standard-angle viewport captures.
- Current selected texture.
- Any imported local image.
- Any previously generated variant.
- A texture already loaded in the project.
- Clipboard image.

References appear as removable chips/thumbnails with names. The prompt should explicitly list which references will be sent and their roles, such as shape reference, palette reference, layout reference, or edit target.

### Preview gallery

- Display generated results as a thumbnail grid.
- Clicking a thumbnail opens a large fit-to-panel preview.
- Support zoom, pan, checkerboard transparency, and pixel grid.
- Compare two variants side by side.
- Show dimensions, format, alpha, provider, prompt, seed when available, and generation time.
- Mark favorites.
- Regenerate, vary, edit, or use as reference.
- Nothing is imported or overwritten merely because it was generated.

### Texture destination folders

- Native `Select texture folder…` dialog.
- Remember a destination per Blockbench project/profile.
- Display the resolved absolute path and project-relative path.
- Offer `Reveal in Explorer`.
- Show writable/unwritable status.
- Suggest common Minecraft paths such as `assets/<modid>/textures/block` while allowing any folder.
- Never silently overwrite; generate a unique filename or request confirmation.
- Sanitize names and preserve PNG transparency.
- Maintain an optional generation manifest containing prompt and provenance without embedding secrets.

### Import and conversion

- Preview original generated resolution.
- Offer 16×16, 32×32, 64×64, 128×128, and custom output sizes.
- Use nearest-neighbor final scaling for pixel art.
- Provide palette limiting and manual palette reference.
- Verify real alpha rather than a fake checkerboard background.
- Avoid text, UI, scenery, or multiple objects for single-icon modes.
- Import into Blockbench as a new texture.
- Optionally apply to selected cubes.
- Optionally run continuous UV projection afterward.
- Refresh the texture and UV editors immediately.

## 17. Viewport auto-refinement

- Optional, off by default.
- Configurable maximum of 1–4 passes; default 3.
- Capture at least a 768×768 image after each draft pass.
- Prefer multiple standard views for spatial tasks when resource limits permit.
- Codex compares the result against the original goal and references.
- Corrections must be minimal and validated.
- Automatic passes cannot delete elements, overwrite files, escape the target group, enlarge repair targets, or create speculative decoration.
- Stop when satisfied, no safe correction exists, the limit is reached, or the user presses Stop.
- Report resource usage and the reason for stopping.

## 18. Proposal and change summaries

Every proposal should explain what will actually change, not merely which object will be touched.

Examples:

- `MOVE arm_west_2 from [1,10,4]–[3,11,5] to [5.8,10,7]–[7.8,11,8]; preserve size; attach to main_blob; keep in culture_stage_2.`
- `PROJECT all six UV faces of arm_west_2 from main_blob; estimated coverage 4% -> 11%.`
- `CREATE membrane_tip inside culture_stage_2; attached to arm_west_2; texture culture_meat.png.`

Show:

- Old and new coordinates.
- Dimensions and volume changes.
- Pivot and rotation.
- Anchor and connectivity chain.
- Parent group.
- Texture and all affected face UVs.
- File destinations.
- Validation warnings.
- Whether Apply is automatic or awaiting confirmation.

## 19. Safety and permissions

- Localhost only with bearer authentication.
- Strict typed tool schemas.
- No general `eval`, `execute_script`, arbitrary shell, or arbitrary filesystem tool.
- Read access limited to explicitly selected reference files and project assets.
- Write access limited to user-approved folders.
- Canonicalize and verify every path before writes.
- No recursive deletion.
- Deletion and overwrite require confirmation.
- Maximum operation count and payload/image sizes.
- Timeouts and cancellation.
- Redact secrets from logs.
- Transaction rollback on any failed edit.
- Named Undo entry for every commit.
- Optional stable-tools-only mode.
- Explicit indicator when experimental tools are enabled.

## 20. Project profiles

Optional `.blockbench-codex.json` beside a project or repository:

```json
{
  "profileVersion": 1,
  "projectType": "minecraft_java_block",
  "modId": "example_mod",
  "modelBounds": { "min": [0, 0, 0], "max": [16, 32, 16] },
  "textureFolders": ["src/main/resources/assets/example_mod/textures/block"],
  "groupPatterns": { "stage": "culture_stage_{n}" },
  "artDirection": [
    "clinical machine versus disgusting layered wet living meat",
    "organic asymmetry",
    "low-profile membrane details rather than oversized generic tentacles"
  ],
  "rules": {
    "preserveGroups": true,
    "allCubeFacesRequired": true,
    "preventRootGeometry": true
  }
}
```

Profiles supplement live inspection; they must never override explicit user instructions silently.

## 21. Diagnostics and logging

Diagnostics page:

- Plugin version.
- MCP server version.
- Codex detected path/version.
- Connection URL without revealing bearer token.
- Active model and service tier.
- Blockbench version and project format.
- Current permissions.
- Image provider status.
- Recent tool errors.
- `Copy diagnostics` with secrets removed.
- `Reconnect`, `Restart server`, and `Run self-test` actions.

Logs should record tool name, duration, success/failure, affected UUIDs, and transaction ID. Avoid recording entire images, secrets, or unnecessary prompt contents by default.

## 22. Launcher, installation, and updates

- One Windows launcher for stable builds.
- Separate development launcher for source/watch mode.
- Detect Node and Codex prerequisites.
- Start hidden background helpers where practical.
- Open Blockbench optionally.
- Provide Desktop shortcuts for stable and development versions.
- Display clear version numbers everywhere.
- Support safe self-update or manual release download later.
- Keep installed plugin, source checkout, MCP server, and launcher versions distinguishable.

## 23. Testing strategy

### Unit tests

- Schema validation.
- Path canonicalization.
- Group inference.
- Anchor inference.
- AABB/rotated contact checks.
- Chain construction.
- Dimension and volume preservation.
- UV projection and flipped axes.
- UV coverage calculations.
- Filename collision/no-overwrite logic.
- Pixel scaling and alpha validation.

### Integration tests

- Connect to a disposable Blockbench project.
- Inspect selection and outline.
- Create, modify, and undo cubes.
- Build a connected chain while preserving sizes.
- Reject resize-until-touch exploits.
- Reject missing groups and root-level stage geometry.
- Apply all six face UVs.
- Capture viewport and receive image data.
- Generate/import a texture into an approved temporary folder.
- Disconnect/reconnect Codex and MCP safely.

### Visual fixtures

- Central blob with loose tentacle pieces.
- Multiple stage folders with overlapping names.
- Dense UV atlas with low initial coverage.
- Transparent texture references.
- Chamber walls and collision regions.
- Models larger than the normal context limit.

### Acceptance test for the first playable slice

Given a selected main blob and several loose target pieces, the command `Fix these tentacles so they form natural continuous chains growing from the main blob` must:

1. Identify one correct anchor automatically.
2. Treat the remaining selection as targets.
3. Preserve every target's dimensions and volume.
4. Move every target into a connected chain.
5. Keep every target in the correct stage group.
6. Avoid chamber walls and floor penetration.
7. Continue the blob UV mapping.
8. Capture a preview.
9. Apply visibly without requiring Undo/Redo to refresh.
10. Revert fully with one Ctrl+Z.

## 24. Development roadmap

### Phase 0 — repository and contracts

- Create repository and license.
- Set up TypeScript workspace, linting, tests, and builds.
- Define shared error/result/tool schemas.
- Create disposable Blockbench fixture.

### Phase 1 — MCP foundation

- Local authenticated server.
- Codex detection and registration helper.
- Health, project, selection, outline, element, and screenshot tools.
- Read-only proof of connection.

Exit criterion: Codex can inspect the live Blockbench project and capture a screenshot.

### Phase 2 — transactions and basic edits

- Draft lifecycle.
- Create/update/move/group tools.
- Undo/redo/checkpoint.
- Exact proposal summaries.
- Auto-apply toggle.

Exit criterion: reversible typed edits appear immediately in Blockbench.

### Phase 3 — first playable semantic slice

- Anchor inference.
- Connectivity graph.
- Size-preserving chain layout.
- Bounds/collision/group validation.
- `connect_selected_chain`.

Exit criterion: the specimen-chamber test passes all ten acceptance requirements.

### Phase 4 — UV system

- Six-face mapping tools.
- Continuous anchor projection.
- Coverage and seam audits.
- Packing and texel-density controls.

Exit criterion: connected blob pieces use substantially more of the texture without visible discontinuities.

### Phase 5 — image workspace

- Provider detection.
- Reference manager.
- Generation/edit requests.
- Thumbnail and full preview gallery.
- Folder selection and remembered project destination.
- Pixel-art conversion, transparency verification, import, and apply.

Exit criterion: generate or edit a texture, preview variants, save safely, import into Blockbench, and apply to selected geometry.

### Phase 6 — visual refinement and polish

- Multi-view capture.
- Bounded auto-refine.
- Resizable/scrollable/sticky UI polish.
- Diagnostics and crash recovery.
- Stable installer/release flow.

## 25. Explicit non-goals for early versions

- General unrestricted JavaScript execution inside Blockbench.
- Full replacement for every manual Blockbench feature.
- Cloud-hosted public MCP endpoint.
- Fully autonomous deletion or file overwrite.
- High-poly sculpting.
- Animation authoring before geometry and UV workflows are reliable.
- Supporting every Blockbench format in v1.

Initial formats should be Minecraft Java block/item and optionally GeckoLib after the core is stable.

## 26. Open product decisions

- Final product name.
- Private versus open-source repository and license.
- In-process MCP server versus separate companion process.
- Whether drafts use temporary live geometry or a ghost overlay.
- Default model and reasoning effort.
- Whether Fast mode defaults on.
- Which image provider is primary.
- Whether image generation requires API configuration in v1 or waits until Codex-native image tooling is detected.
- Default generated texture resolution.
- Whether project profiles live beside `.bbmodel` files or at repository root.
- Stable-tools-only default versus opt-in experimental tools.

## 27. Recommended immediate starting point

Do not start with image generation or a giant tool catalog. Build this vertical slice first:

1. Detect Codex.
2. Start authenticated MCP server.
3. Read selection and Outliner.
4. Capture viewport.
5. Begin draft.
6. Move cubes while preserving dimensions.
7. Connect selected targets to inferred anchor.
8. Validate connectivity and groups.
9. Preview and commit.
10. Undo in one step.

This proves the architectural advantage over the current one-shot bridge. Once it works reliably on the specimen chamber, add UV continuity and then the complete image-generation workspace.

## 28. Reference links

- Codex and OpenAI developer documentation: https://developers.openai.com/
- Model Context Protocol: https://modelcontextprotocol.io/
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- Blockbench plugin documentation: https://www.blockbench.net/wiki/docs/plugin/
- Existing Blockbench MCP for feature comparison only: https://github.com/jasonjgardner/blockbench-mcp-plugin
- Minecraft-oriented comparison: https://github.com/SwagRee/BlockBenchMCP

---

This document is the source-of-truth blueprint for the new standalone project. Changes to scope should be recorded here before implementation so the tool remains coherent instead of accumulating unrelated patches.
