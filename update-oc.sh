#!/bin/bash
#
# OpenContext Updater for Linux
# Pulls latest changes and rebuilds native bindings
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== OpenContext Updater ==="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check dependencies
check_deps() {
    local missing=()

    command -v git >/dev/null 2>&1 || missing+=("git")
    command -v node >/dev/null 2>&1 || missing+=("node")
    command -v npm >/dev/null 2>&1 || missing+=("npm")
    command -v cargo >/dev/null 2>&1 || missing+=("cargo (rust)")
    command -v protoc >/dev/null 2>&1 || missing+=("protoc (protobuf-compiler)")

    if [ ${#missing[@]} -ne 0 ]; then
        echo -e "${RED}Missing dependencies: ${missing[*]}${NC}"
        echo "Install them before running this script."
        exit 1
    fi
}

# Pull latest changes
pull_updates() {
    echo -e "${YELLOW}[1/5] Pulling latest changes...${NC}"

    # Stash local changes if any
    if ! git diff --quiet; then
        echo "  Stashing local changes..."
        git stash
        STASHED=1
    fi

    git pull --rebase origin main

    if [ "$STASHED" = "1" ]; then
        echo "  Restoring stashed changes..."
        git stash pop || true
    fi

    echo -e "${GREEN}  Done${NC}"
}

# Install root dependencies
install_root_deps() {
    echo -e "${YELLOW}[2/5] Installing root dependencies...${NC}"
    npm install
    echo -e "${GREEN}  Done${NC}"
}

# Build native module
build_native() {
    echo -e "${YELLOW}[3/5] Building native module (this may take a few minutes)...${NC}"
    cd "$SCRIPT_DIR/crates/opencontext-node"
    npm install
    npm run build
    cd "$SCRIPT_DIR"
    echo -e "${GREEN}  Done${NC}"
}

# Link native module globally
link_native() {
    echo -e "${YELLOW}[4/5] Linking native module...${NC}"
    cd "$SCRIPT_DIR/crates/opencontext-node"
    npm link
    cd "$SCRIPT_DIR"
    echo -e "${GREEN}  Done${NC}"
}

# Link to global CLI
link_to_cli() {
    echo -e "${YELLOW}[5/5] Linking to global CLI...${NC}"

    # Find global node_modules
    local GLOBAL_CLI
    GLOBAL_CLI="$(npm root -g)/@aicontextlab/cli"

    if [ -d "$GLOBAL_CLI" ]; then
        cd "$GLOBAL_CLI"
        npm link @aicontextlab/core-native
        cd "$SCRIPT_DIR"
        echo -e "${GREEN}  Done${NC}"
    else
        echo -e "${YELLOW}  Global CLI not installed. Installing...${NC}"
        npm install -g @aicontextlab/cli
        GLOBAL_CLI="$(npm root -g)/@aicontextlab/cli"
        cd "$GLOBAL_CLI"
        npm link @aicontextlab/core-native
        cd "$SCRIPT_DIR"
        echo -e "${GREEN}  Done${NC}"
    fi
}

# Verify installation
verify() {
    echo ""
    echo -e "${YELLOW}Verifying installation...${NC}"

    if oc --help >/dev/null 2>&1; then
        echo -e "${GREEN}Success! 'oc' command is working.${NC}"
        echo ""
        oc --help | head -5
    else
        echo -e "${RED}Error: 'oc' command failed${NC}"
        exit 1
    fi
}

# Main
main() {
    check_deps
    echo ""
    pull_updates
    install_root_deps
    build_native
    link_native
    link_to_cli
    verify

    echo ""
    echo -e "${GREEN}=== Update complete ===${NC}"
}

main "$@"
