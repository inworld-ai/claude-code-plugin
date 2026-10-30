#!/usr/bin/env bash
# Build/vendor the CLI MCP server; never edit build/index.js by hand.
# Usage:
#   scripts/vendor.sh                       # rebuild pinned vendor-source.json
#   scripts/vendor.sh /path/to/inworld-cli   # build a clean local CLI checkout
#   scripts/vendor.sh 1.5.0                  # vendor an explicit npm release
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-}"
REPOSITORY="https://github.com/inworld-ai/inworld-cli.git"
REVISION=""
EXPECTED_SHA=""
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ -z "$SRC" ]; then
  PIN="$PLUGIN_ROOT/vendor-source.json"
  SOURCE_TYPE="$(node -p 'require(process.argv[1]).source' "$PIN")"
  EXPECTED_SHA="$(node -p 'require(process.argv[1]).artifactSha256' "$PIN")"
  if [ "$SOURCE_TYPE" = git ]; then
    REVISION="$(node -p 'require(process.argv[1]).revision' "$PIN")"
    SRC="$TMP/inworld-cli"
    git init -q "$SRC"
    git -C "$SRC" remote add origin "$REPOSITORY"
    git -C "$SRC" fetch --depth=1 origin "$REVISION"
    git -C "$SRC" checkout --detach FETCH_HEAD
    (cd "$SRC" && npm ci --ignore-scripts)
  else
    SRC="$(node -p 'require(process.argv[1]).version' "$PIN")"
  fi
fi

if [ -d "$SRC" ]; then
  SRC="$(cd "$SRC" && pwd)"
  if [ -n "$(git -C "$SRC" status --porcelain)" ]; then
    echo 'CLI checkout must be clean so the recorded commit reproduces the bundle.' >&2
    exit 1
  fi
  REVISION="$(git -C "$SRC" rev-parse HEAD)"
  (cd "$SRC" && npm run build)
  ARTIFACT="$SRC/packages/cli/dist/cli/inworld-mcp.js"
  VERSION="$(node -p 'require(process.argv[1]).version' "$SRC/packages/cli/package.json")"
  SOURCE_TYPE=git
else
  TARBALL="$(npm pack "@inworld/cli@$SRC" --pack-destination "$TMP" 2>/dev/null | tail -1)"
  tar -xzf "$TMP/$TARBALL" -C "$TMP"
  ARTIFACT="$TMP/package/dist/cli/inworld-mcp.js"
  VERSION="$(node -p 'require(process.argv[1]).version' "$TMP/package/package.json")"
  SOURCE_TYPE=npm
fi

node --input-type=module - "$ARTIFACT" "$PLUGIN_ROOT" "$SOURCE_TYPE" "$VERSION" "$REPOSITORY" "$REVISION" "$EXPECTED_SHA" <<'JS'
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const [artifact, root, source, version, repository, revision, expected] = process.argv.slice(2);
const contents = readFileSync(artifact);
const artifactSha256 = createHash('sha256').update(contents).digest('hex');
if (expected && artifactSha256 !== expected) {
  throw new Error(`Rebuilt artifact differs from pinned SHA-256: ${artifactSha256}`);
}
const provenance = { package: '@inworld/cli', version, source, repository,
  ...(revision ? { revision } : {}), artifactSha256 };
mkdirSync(join(root, 'build'), { recursive: true });
writeFileSync(join(root, 'build/index.js'), contents, { mode: 0o755 });
writeFileSync(join(root, 'vendor-source.json'), JSON.stringify(provenance, null, 2) + '\n');
console.log(`Vendored @inworld/cli ${version} (${revision || 'npm'})`);
JS

chmod 755 "$PLUGIN_ROOT/build/index.js"
node "$PLUGIN_ROOT/scripts/smoke.mjs"
