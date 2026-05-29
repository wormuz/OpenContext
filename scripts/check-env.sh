#!/bin/bash
# Quick env sanity check for OpenContext dev setup
PASS=0; FAIL=0

ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

echo "=== Node ==="
NODE_VER=$(node -v 2>/dev/null)
NODE_MAJOR=$(echo "$NODE_VER" | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -ge 22 ] 2>/dev/null; then
  ok "node $NODE_VER"
else
  fail "node $NODE_VER — need >=22"
fi

NVM_DEFAULT=$(cat ~/.nvm/alias/default 2>/dev/null)
ACTIVE_PATH=$(which node 2>/dev/null)
if echo "$ACTIVE_PATH" | grep -q "$NVM_DEFAULT"; then
  ok "nvm default ($NVM_DEFAULT) is active"
else
  fail "nvm default is $NVM_DEFAULT but active is $ACTIVE_PATH — run: nvm use default"
fi

echo ""
echo "=== oc CLI ==="
OC_PATH=$(which oc 2>/dev/null)
OC_REAL=$(readlink -f "$OC_PATH" 2>/dev/null)
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_OC="$REPO_DIR/bin/oc.js"
if [ "$OC_REAL" = "$REPO_OC" ]; then
  ok "oc → repo bin/oc.js"
else
  fail "oc → $OC_REAL (expected $REPO_OC)"
  echo "     fix: ln -sf $REPO_OC \$(dirname \$(which node))/oc"
fi

echo ""
echo "=== .node binary sync ==="
SO="$REPO_DIR/crates/opencontext-node/target/release/libopencontext_node.so"
NODE_LOCAL="$REPO_DIR/crates/opencontext-node/opencontext-node.linux-x64-gnu.node"
NODE_REPO="$REPO_DIR/node_modules/@aicontextlab/core-native/opencontext-node.linux-x64-gnu.node"
REF=$(md5sum "$SO" 2>/dev/null | cut -d' ' -f1)
if [ -z "$REF" ]; then
  fail "no compiled .so found — run: cargo build --release --manifest-path crates/opencontext-node/Cargo.toml"
else
  OUT_OF_SYNC=0
  for F in "$NODE_LOCAL" "$NODE_REPO"; do
    H=$(md5sum "$F" 2>/dev/null | cut -d' ' -f1)
    [ "$H" != "$REF" ] && OUT_OF_SYNC=1
  done
  # check all nvm versions that have @aicontextlab/cli installed
  for F in ~/.nvm/versions/node/*/lib/node_modules/@aicontextlab/cli/node_modules/@aicontextlab/core-native-linux-x64-gnu/opencontext-node.linux-x64-gnu.node; do
    [ -f "$F" ] || continue
    H=$(md5sum "$F" 2>/dev/null | cut -d' ' -f1)
    [ "$H" != "$REF" ] && OUT_OF_SYNC=1
  done
  if [ $OUT_OF_SYNC -eq 0 ]; then
    ok ".node in sync everywhere (batch_size patch active)"
  else
    fail ".node out of sync — run: bash scripts/sync-native.sh"
  fi
fi

echo ""
echo "=== sverklo ==="
SVERKLO=$(which sverklo 2>/dev/null)
if [ -z "$SVERKLO" ]; then
  fail "sverklo not found"
else
  SVERKLO_VER=$("$SVERKLO" --version 2>/dev/null)
  if [ $? -eq 0 ]; then
    ok "sverklo $SVERKLO_VER ($SVERKLO)"
  else
    fail "sverklo found at $SVERKLO but fails to run (wrong node version?)"
    echo "     fix: ensure ~/.local/bin/sverklo wrapper uses node >=24"
  fi
fi

echo ""
echo "=== Ollama ==="
OLLAMA_RESP=$(curl -s --max-time 3 http://localhost:11434/api/tags 2>/dev/null)
if echo "$OLLAMA_RESP" | grep -q "nomic-embed-text"; then
  ok "ollama running, nomic-embed-text present"
elif [ -n "$OLLAMA_RESP" ]; then
  fail "ollama running but nomic-embed-text missing — run: ollama pull nomic-embed-text"
else
  fail "ollama not reachable at localhost:11434"
fi

echo ""
if [ $FAIL -eq 0 ]; then
  echo "All checks passed ($PASS/$PASS)"
else
  echo "$FAIL check(s) failed, $PASS passed"
  exit 1
fi
