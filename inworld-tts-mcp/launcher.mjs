#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile(
    new URL(".claude-plugin/plugin.json", import.meta.url),
    "utf8",
  ),
);

// Set identity before the shared CLI bundle initializes its request headers.
// Read the release version from the plugin manifest so it cannot drift.
process.env.INWORLD_CLIENT_APP = "inworld-claude-code-plugin";
process.env.INWORLD_CLIENT_APP_VERSION = manifest.version;
process.env.INWORLD_MCP_TOOLSET = "runtime";

await import("./build/index.js");
