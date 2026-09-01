# Blockbench Codex MCP Studio

A clean-room, Windows-first Blockbench assistant that exposes safe, typed modeling workflows to Codex through the Model Context Protocol (MCP).

The project is currently at the blueprint stage. The immediate goal is the first vertical slice: connect Codex to Blockbench, inspect the active project, capture the viewport, make reversible draft edits, and connect selected geometry while preserving dimensions, groups, bounds, and Undo behavior.

## Source of truth

Read [BLOCKBENCH_CODEX_MCP_MASTER_BLUEPRINT.md](docs/BLOCKBENCH_CODEX_MCP_MASTER_BLUEPRINT.md) before changing product scope or architecture.

## Status

- Repository initialized
- Master blueprint imported
- Phase 0 TypeScript workspace initialized
- Shared result, scene, and draft-operation contracts started
- Geometry safety primitives and a disposable specimen-chamber fixture added
- Authenticated read-only MCP bridge and installable development plugin added
- License and final product name intentionally undecided

## Development

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for prerequisites, workspace layout, and verification commands.

## License

No public license has been selected yet. The source is visible for review and collaboration, but no permission to copy, modify, or redistribute it is granted until a license is added.

## Planned workspace

The blueprint proposes a TypeScript monorepo with Blockbench plugin, MCP server, launcher, shared contracts, geometry and UV packages, fixtures, documentation, scripts, and tests. That structure will be introduced as the corresponding implementation work begins.
