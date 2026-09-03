# Blockbench Codex MCP Studio

A clean-room, Windows-first Blockbench assistant that exposes safe, typed modeling workflows to Codex through the Model Context Protocol (MCP).

The first playable vertical slice is complete: Codex can connect to Blockbench, inspect the active project, capture the viewport, stage reversible draft edits, and connect selected geometry while preserving dimensions, groups, bounds, and Undo behavior. Phase 4's typed UV system is implemented and accepted live in Blockbench with increased unique coverage, zero audited seams, and exact one-step Undo restoration.

## Source of truth

Read [BLOCKBENCH_CODEX_MCP_MASTER_BLUEPRINT.md](docs/BLOCKBENCH_CODEX_MCP_MASTER_BLUEPRINT.md) before changing product scope or architecture.

## Status

- Repository initialized
- Master blueprint imported
- Phase 0 TypeScript workspace initialized
- Shared result, scene, and draft-operation contracts started
- Geometry safety primitives and a disposable specimen-chamber fixture added
- Authenticated read-only MCP bridge and installable development plugin added
- First Phase 2 draft path added: stage size-preserving cube moves, validate live state, commit through the bridge, and apply as one Blockbench Undo entry
- First Phase 3 semantic path added: infer the selected anchor, arrange same-group cubes into a physically overlapping chain, enforce project bounds, and publish a post-commit viewport capture
- Phase 4 UV path added: publish all six faces, stage direct or continuous mappings, audit unique coverage and seams, pack islands, normalize texel density, and commit UV changes through the same one-step Undo transaction
- Phase 4 textured fixture accepted end to end in Blockbench: 12 seams repaired to zero, unique coverage increased from 37.5% to 42.72%, and one native Undo restored all 18 face mappings exactly
- Phase 5 image workspace implemented: provider dispatch, named references, preview gallery, safe destinations, nearest-neighbor pixel conversion, real-alpha inspection, and typed texture import/apply through native Undo
- Native keyboard-first assistant panel added with preview-first and direct-apply modes, viewport context, model selection, stop, copy, and Undo controls
- Specimen fixture accepted end to end in Blockbench 5.1.6, including exact one-step Undo restoration
- Clean checkout formatting, lint, test, and build gate established
- License and final product name intentionally undecided

## Development

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for prerequisites, workspace layout, and verification commands.

## License

No public license has been selected yet. The source is visible for review and collaboration, but no permission to copy, modify, or redistribute it is granted until a license is added.

## Planned workspace

The blueprint proposes a TypeScript monorepo with Blockbench plugin, MCP server, launcher, shared contracts, geometry and UV packages, fixtures, documentation, scripts, and tests. That structure will be introduced as the corresponding implementation work begins.
