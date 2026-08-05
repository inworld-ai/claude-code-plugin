#!/usr/bin/env node
// Boots the vendored server exactly the way the plugin does (plain node, no
// node_modules, API key + INWORLD_MCP_TOOLSET=runtime) and asserts the tool
// surface is exactly the 10 contract tools the skills reference.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const EXPECTED = [
  "chat_completion",
  "chat_completion_with_audio",
  "clone_voice",
  "design_voice",
  "list_routers",
  "list_voices",
  "publish_voice",
  "search_docs",
  "synthesize_speech",
  "transcribe_audio",
];

const serverPath = resolve(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "build",
  "index.js",
);

const proc = spawn("node", [serverPath], {
  env: {
    PATH: process.env.PATH,
    // A syntactically valid but fake key — tools/list needs no real auth.
    INWORLD_API_KEY: process.env.INWORLD_API_KEY ?? "c21va2U6c21va2U=",
    INWORLD_MCP_TOOLSET: "runtime",
    INWORLD_SESSION_FILE: "/nonexistent/inworld-mcp-smoke-session.json",
  },
});

const send = (msg) => proc.stdin.write(JSON.stringify(msg) + "\n");
send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0" },
  },
});
send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });

let buffer = "";
const timeout = setTimeout(() => {
  console.error("smoke: timed out waiting for tools/list");
  proc.kill();
  process.exit(1);
}, 15000);

proc.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  const lines = buffer.split("\n");
  // Last element is a partial line until its newline arrives in a later chunk.
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      console.error("smoke: non-JSON on stdout:", line.slice(0, 200));
      proc.kill();
      process.exit(1);
    }
    if (msg.id === 2) {
      clearTimeout(timeout);
      const names = msg.result.tools.map((t) => t.name).sort();
      const expected = [...EXPECTED].sort();
      if (JSON.stringify(names) !== JSON.stringify(expected)) {
        console.error("smoke: tool surface mismatch");
        console.error("  expected:", expected.join(", "));
        console.error("  actual:  ", names.join(", "));
        proc.kill();
        process.exit(1);
      }
      console.log(`smoke: OK — ${names.length} tools, surface matches contract`);
      proc.kill();
      process.exit(0);
    }
  }
});

proc.on("exit", (code) => {
  if (code !== null && code !== 0) {
    console.error(`smoke: server exited with code ${code}`);
    process.exit(1);
  }
});
