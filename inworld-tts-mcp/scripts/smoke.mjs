#!/usr/bin/env node
// Boots the vendored server exactly the way the plugin does (plain node, no
// node_modules, INWORLD_MCP_TOOLSET=runtime) and asserts the tool surface is
// exactly the 10 contract tools the skills reference. Runs twice:
//   1. build/index.js with a fake key — the vendored contract.
//   2. scripts/start.mjs with no key and an empty HOME — the plugin entry point
//      must still boot, so search_docs works before the user has signed up.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

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

const root = resolve(fileURLToPath(import.meta.url), "..", "..");

function check(label, entry, env) {
  return new Promise((done, fail) => {
    const proc = spawn("node", [join(root, entry)], {
      env: {
        PATH: process.env.PATH,
        INWORLD_MCP_TOOLSET: "runtime",
        INWORLD_SESSION_FILE: "/nonexistent/inworld-mcp-smoke-session.json",
        ...env,
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
    let finished = false;
    const finish = (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      proc.kill();
      err ? fail(new Error(`${label}: ${err}`)) : done();
    };
    const timeout = setTimeout(() => finish("timed out waiting for tools/list"), 15000);

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
          return finish(`non-JSON on stdout: ${line.slice(0, 200)}`);
        }
        if (msg.id !== 2) continue;
        const names = msg.result.tools.map((t) => t.name).sort();
        const expected = [...EXPECTED].sort();
        if (JSON.stringify(names) !== JSON.stringify(expected)) {
          return finish(
            `tool surface mismatch\n  expected: ${expected.join(", ")}\n  actual:   ${names.join(", ")}`,
          );
        }
        console.log(`smoke: OK — ${label}: ${names.length} tools, surface matches contract`);
        return finish();
      }
    });

    proc.on("exit", (code) => {
      if (code !== null && code !== 0) finish(`server exited with code ${code}`);
    });
  });
}

const emptyHome = mkdtempSync(join(tmpdir(), "inworld-smoke-home-"));
try {
  await check("vendored server", "build/index.js", {
    // A syntactically valid but fake key — tools/list needs no real auth.
    INWORLD_API_KEY: process.env.INWORLD_API_KEY ?? "c21va2U6c21va2U=",
  });
  await check("plugin entry, no key", "scripts/start.mjs", {
    HOME: emptyHome,
    INWORLD_PLUGIN_API_KEY: "",
  });
} catch (err) {
  console.error(`smoke: ${err.message}`);
  process.exitCode = 1;
} finally {
  rmSync(emptyHome, { recursive: true, force: true });
}
