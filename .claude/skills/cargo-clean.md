# cargo-clean

Clean Rust target directories in this project (frees ~15-20G after a full build).

Targets:
- `crates/opencontext-node/target`
- `crates/opencontext-core/target`
- `src-tauri/target`

## Instructions

Run all three `cargo clean` in parallel and report freed space:

```bash
~/.cargo/bin/cargo clean --manifest-path crates/opencontext-node/Cargo.toml &
~/.cargo/bin/cargo clean --manifest-path crates/opencontext-core/Cargo.toml &
~/.cargo/bin/cargo clean --manifest-path src-tauri/Cargo.toml &
wait
```

Then show disk usage of the project folder after cleanup with `du -sh .`.
