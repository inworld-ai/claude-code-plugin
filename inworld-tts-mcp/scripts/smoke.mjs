#!/usr/bin/env node
// Exercise the configured plugin launcher and its bundled HTTP requests using
// a loopback API and fake credentials. No paid API calls or node_modules needed.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const manifest = await readJson(join(root, ".claude-plugin/plugin.json"));
const config = (await readJson(join(root, ".mcp.json"))).mcpServers.inworld;
const expectedTools = [
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
].sort();
const directory = await mkdtemp(join(tmpdir(), "inworld-plugin-smoke-"));
const requests = [];
const mockApi = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  requests.push({
    path: req.url,
    audio: Boolean(body.audio),
    method: req.method,
    headers: req.headers,
  });
  let response;
  switch (req.url) {
    case "/tts/v1/voice":
      response = {
        audioContent: "AA==",
        usage: { modelId: "inworld-tts-2", processedCharactersCount: 5 },
      };
      break;
    case "/stt/v1/transcribe":
      response = { transcription: { transcript: "hello", isFinal: true } };
      break;
    case "/v1/chat/completions":
      response = {
        model: body.model,
        choices: [
          {
            message: {
              content: "hello",
              ...(body.audio
                ? { audio: { data: "AA==", transcript: "hello" } }
                : {}),
            },
            finish_reason: "stop",
          },
        ],
      };
      break;
    default:
      res.writeHead(404).end();
      return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(response));
});

let proc;
let stderr = "";
const pending = new Map();
const failPending = (error) => {
  for (const { reject } of pending.values()) reject(error);
  pending.clear();
};

try {
  mockApi.listen(0, "127.0.0.1");
  await once(mockApi, "listening");
  const base = `http://127.0.0.1:${mockApi.address().port}`;
  const inputFile = join(directory, "input.wav");
  await writeFile(inputFile, Buffer.from([0, 0]));
  proc = spawn(
    process.execPath,
    config.args.map((arg) => arg.replaceAll("${CLAUDE_PLUGIN_ROOT}", root)),
    {
      env: {
        PATH: process.env.PATH,
        ...config.env,
        INWORLD_API_KEY: "c21va2U6c21va2U=",
        INWORLD_API_BASE: base,
        INWORLD_SEARCH_BASE: base,
        INWORLD_SESSION_FILE: join(directory, "missing-session.json"),
        // The plugin launcher must own its identity, independent of its host.
        INWORLD_CLIENT_APP: "parent-shell",
        INWORLD_CLIENT_APP_VERSION: "99.0.0",
      },
    },
  );
  proc.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  proc.on("error", failPending);
  proc.on("exit", (code, signal) =>
    failPending(new Error(`server exited: ${code ?? signal}; ${stderr}`)),
  );
  createInterface({ input: proc.stdout }).on("line", (line) => {
    try {
      const message = JSON.parse(line);
      const waiting = pending.get(message.id);
      if (!waiting) return;
      pending.delete(message.id);
      if (message.error)
        waiting.reject(new Error(JSON.stringify(message.error)));
      else waiting.resolve(message.result);
    } catch (error) {
      failPending(error);
    }
  });
  let nextId = 0;
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out; ${stderr}`));
      }, 15000);
      pending.set(id, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      proc.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  await rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0" },
  });
  proc.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
      "\n",
  );
  const tools = await rpc("tools/list", {});
  assert.deepEqual(tools.tools.map(({ name }) => name).sort(), expectedTools);
  const cases = [
    [
      "synthesize_speech",
      {
        text: "hello",
        voice_id: "Ashley",
        output_file: join(directory, "tts.mp3"),
      },
    ],
    ["transcribe_audio", { input_file: inputFile }],
    [
      "chat_completion",
      {
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "hello" }],
      },
    ],
    [
      "chat_completion_with_audio",
      {
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "hello" }],
        voice: "Ashley",
        output_file: join(directory, "reply.wav"),
      },
    ],
  ];
  for (const [name, args] of cases) {
    const result = await rpc("tools/call", { name, arguments: args });
    assert.ok(!result.isError, `${name}: ${JSON.stringify(result)}`);
  }
  assert.deepEqual(
    [...new Set(requests.map(({ path, audio }) => `${path}:${audio}`))].sort(),
    [
      "/tts/v1/voice:false",
      "/stt/v1/transcribe:false",
      "/v1/chat/completions:false",
      "/v1/chat/completions:true",
    ].sort(),
  );
  for (const request of requests) {
    const header = request.headers["x-user-agent"];
    assert.ok(header, `${request.path} is missing x-user-agent`);
    const identity = Object.fromEntries(
      header.split(" ").map((token) => {
        const slash = token.indexOf("/");
        return [token.slice(0, slash), token.slice(slash + 1)];
      }),
    );
    assert.equal(identity.app, "inworld-claude-code-plugin");
    assert.equal(identity["app-version"], manifest.version);
    assert.equal(identity.sdk, "cli");
    const source = await readJson(join(root, "vendor-source.json"));
    assert.equal(identity["sdk-version"], source.version);
    assert.notEqual(identity["sdk-version"], identity["app-version"]);
    assert.equal(request.headers.authorization, "Basic c21va2U6c21va2U=");
    assert.equal(request.method, "POST");
  }
  const source = await readJson(join(root, "vendor-source.json"));
  assert.equal(
    createHash("sha256")
      .update(await readFile(join(root, "build/index.js")))
      .digest("hex"),
    source.artifactSha256,
  );
  const pkg = await readJson(join(root, "package.json"));
  const marketplace = await readJson(
    join(root, "../.claude-plugin/marketplace.json"),
  );
  assert.equal(pkg.version, manifest.version);
  assert.equal(
    marketplace.plugins.find(({ name }) => name === manifest.name).version,
    manifest.version,
  );
  assert.equal(
    resolve(root, pkg.bin["inworld-tts-mcp"]),
    config.args[0].replaceAll("${CLAUDE_PLUGIN_ROOT}", root),
  );
  assert.equal(
    pkg.scripts.start,
    `node ${pkg.bin["inworld-tts-mcp"].replace(/^\.\//, "")}`,
  );
  console.log(
    `smoke: OK — ${expectedTools.length} tools; bundled TTS, STT, LLM and LLM+TTS requests identify plugin ${manifest.version} and CLI ${source.version}`,
  );
} finally {
  proc?.kill();
  if (proc && proc.exitCode === null && proc.signalCode === null)
    await once(proc, "exit");
  mockApi.closeAllConnections();
  await new Promise((resolve) => mockApi.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
