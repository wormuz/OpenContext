#!/bin/bash
# Copy freshly built .node to all locations that oc can load from
set -e
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SO="$REPO_DIR/crates/opencontext-node/target/release/libopencontext_node.so"

if [ ! -f "$SO" ]; then
  echo "No .so found. Building..."
  touch "$REPO_DIR/crates/opencontext-core/src/search/config.rs"
  ~/.cargo/bin/cargo build --release --manifest-path "$REPO_DIR/crates/opencontext-node/Cargo.toml"
fi

NODE_LOCAL="$REPO_DIR/crates/opencontext-node/opencontext-node.linux-x64-gnu.node"
NODE_REPO="$REPO_DIR/node_modules/@aicontextlab/core-native/opencontext-node.linux-x64-gnu.node"
cp "$SO" "$NODE_LOCAL"
cp "$SO" "$NODE_REPO"
for F in ~/.nvm/versions/node/*/lib/node_modules/@aicontextlab/cli/node_modules/@aicontextlab/core-native-linux-x64-gnu/opencontext-node.linux-x64-gnu.node; do
  [ -f "$F" ] && cp "$SO" "$F" && echo "  synced: $F"
done

BATCH=$(node --eval "const n = require('$REPO_DIR/node_modules/@aicontextlab/core-native'); console.log(n.loadSearchConfig().embedding.batch_size)")
echo "done — batch_size: $BATCH"
