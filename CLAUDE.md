# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Full codebase map**: See [docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md) for detailed architecture, data flows, and navigation guide.

## Project Overview

OpenContext is a personal context/knowledge store for AI assistants. It provides:
- `oc` CLI for managing a global `contexts/` document library
- MCP server for AI tool integration (Cursor, Claude, etc.)
- Desktop app (Tauri) with native UI
- Web UI for browser-based document management

## Build and Development Commands

```bash
# Install dependencies
npm install

# Run tests
npm run test              # Core/search/native Node tests
npm run test:all          # All tests including integration + Rust
npm run test:rust         # Rust tests only (crates/opencontext-core)
npm run test:ui           # UI component tests

# Run single test file
node --test tests/core/specific.test.js

# Development servers
npm run ui:dev            # Vite UI dev server (hot reload)
npm run tauri:dev         # Desktop app development
npm run mcp               # Start MCP server
npm run api:dev           # Local API server

# Production builds
npm run ui:build          # Build Web UI assets
npm run tauri:build       # Build desktop app
npm run tauri:build:mac   # Build universal macOS binary
```

## Architecture

### Layer Structure

```
bin/oc.js           # CLI entry point (commander.js)
    │
    ├── src/core/   # Node.js core logic
    │   ├── store/  # Document/folder operations (wraps native bindings)
    │   ├── search/ # Search indexing and queries
    │   ├── config.js
    │   └── agents.js
    │
    ├── src/mcp/server.js   # MCP server (exposes oc_* tools)
    │
    └── src/ui/     # Vite + React Web UI
        ├── src/    # React components, hooks, routes
        └── server.js
```

### Native Rust Layer

```
crates/
├── opencontext-core/   # Core Rust library (SQLite storage, LanceDB search)
│   └── features: search (optional, adds vector search)
│
└── opencontext-node/   # NAPI bindings for Node.js

src-tauri/              # Tauri desktop app (uses opencontext-core)
```

### Data Flow

1. **Storage**: Documents live in `~/.opencontext/contexts/` with metadata in `opencontext.db` (SQLite)
2. **Native bindings**: Node.js calls Rust via NAPI (`@aicontextlab/core-native`)
3. **MCP tools**: `oc_manifest`, `oc_search`, `oc_list_docs`, etc. exposed for AI assistants
4. **UI**: React app talks to Express API in `src/ui/server.js` or Tauri commands

## Code Conventions

- 2-space indentation for JS/JSON
- `cargo fmt` for Rust (enforced by pre-commit hook)
- React components: PascalCase (e.g., `SearchModal.jsx`)
- Tests: `*.test.js` or `*.test.cjs`, use Node's built-in `node --test`
- Commit messages: Conventional Commits (`feat:`, `fix:`, `chore:`)

## Key Files

- `bin/oc.js` - Main CLI implementation
- `src/mcp/server.js` - MCP server with all AI tool definitions
- `src/core/store-native.js` - Native store wrapper
- `crates/opencontext-core/src/lib.rs` - Core Rust implementation
- `src-tauri/src/main.rs` - Tauri app commands
- `.cursor/commands/` - Cursor slash command definitions

## Environment Variables

- `OPENCONTEXT_ROOT` - Override base directory (default: `~/.opencontext`)
- `OPENCONTEXT_CONTEXTS_ROOT` - Override contexts directory
- `OPENCONTEXT_DB_PATH` - Override SQLite database path
- `OC_STORE_DEBUG` - Enable store debug logging
