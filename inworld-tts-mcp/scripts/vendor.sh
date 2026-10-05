#!/usr/bin/env bash
# Vendors the MCP server from @inworld/cli into build/index.js.
#
# The plugin no longer has its own server implementation — the single source
# of truth is the in-tree MCP server of https://github.com/inworld-ai/inworld-cli
# (packages/cli/src/mcp/), built and shipped as the `inworld-mcp` bin. The
# plugin pins the exact 10-tool surface via INWORLD_MCP_TOOLSET=runtime in
# .mcp.json.
#
# Usage:
#   scripts/vendor.sh                 # vendor CLI_VERSION (pinned below) from npm
#   scripts/vendor.sh 1.3.1           # vendor a specific version from npm
#   scripts/vendor.sh /path/to/inworld-cli   # vendor from a local checkout's build
set -euo pipefail

CLI_VERSION="1.3.1"

cd "$(dirname "$0")/.."

SRC="${1:-$CLI_VERSION}"

if [ -d "$SRC" ]; then
  ARTIFACT="$SRC/packages/cli/dist/cli/inworld-mcp.js"
  [ -f "$ARTIFACT" ] || { echo "No built artifact at $ARTIFACT — run 'npm run build' in the CLI repo first." >&2; exit 1; }
  cp "$ARTIFACT" build/index.js
  echo "Vendored from local checkout: $ARTIFACT"
else
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  TARBALL="$(npm pack "@inworld/cli@$SRC" --pack-destination "$TMP" 2>/dev/null | tail -1)"
  tar -xzf "$TMP/$TARBALL" -C "$TMP"
  cp "$TMP/package/dist/cli/inworld-mcp.js" build/index.js
  echo "Vendored @inworld/cli@$SRC"
fi

chmod 755 build/index.js

# Smoke test: server must boot standalone and expose exactly the 10 contract tools.
node scripts/smoke.mjs
