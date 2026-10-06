# Inworld AI — plugin for Claude Code and Codex

Official Inworld AI plugin for Claude Code and Codex: the top-rated TTS-2 model with natural-language steering across 200+ languages, hundreds of professional voices plus instant voice cloning and design, STT with voice profiling, Realtime voice agents, and the LLM Router. Claude Code wires it into any project in seconds.

- **TTS-2** — 200+ languages and locales, natural-language steering (`[whisper]`, `[say with rising excitement]`, `[laugh]`), `delivery_mode`, word & character timestamps
- **TTS-2 Flash** — Inworld's fastest, lowest-cost model: ~20 ms time to first audio, same languages as TTS-2
- **Streaming TTS** — audio starts playing while it's still being generated, via chunked HTTP or WebSocket (~100 ms server-side time to first audio with TTS-2)
- **STT** — Inworld STT-1 in 30 languages, with optional Voice Profile (age, emotion, pitch, vocal style, accent) and custom vocabulary for names and jargon
- **Long-recording transcription** — async jobs for meetings, interviews, and podcasts (up to 512 MB), with speaker diarization ("who said what") and word timestamps
- **Streaming STT** — live mic → transcript over WebSocket, interim + final results, tunable or manual turn detection
- **Realtime voice agents** — bidirectional speech-to-speech over WebSocket / WebRTC / Twilio, with optional Router-backed LLM
- **Instant voice cloning** — a custom voice from a short sample in seconds; use 15–30 seconds of clean audio for the best similarity
- **Professional voice cloning (beta)** — a fine-tuned clone that's more similar and stable, trained on 10+ minutes of audio; created in the Inworld Portal or with the PVC API
- **Voice design** — generate voices from a text description (no audio sample required)
- **LLM Router** — OpenAI-compatible chat completions with traffic-split routing, fallback, and A/B testing
- **Migration** — move an existing ElevenLabs, OpenAI, Cartesia, Deepgram, Google, Azure, or Polly integration to Inworld behind a switch

## Install

**Claude Code**

```
/plugin marketplace add inworld-ai/claude-code-plugin
/plugin install inworld@inworld
```

Claude Code asks for your Inworld API key at install. Paste the Base64 value from [platform.inworld.ai/api-keys](https://platform.inworld.ai/api-keys) as is, or leave it blank and run `/inworld:connect` later.

**Codex** (CLI or app)

```
codex plugin marketplace add inworld-ai/claude-code-plugin
codex plugin add inworld@inworld
```

Or install **Inworld AI** from `/plugins` (CLI) or the **Plugins** page (app). Start a new session afterwards. Codex forwards `INWORLD_API_KEY` from your environment to the plugin.

**No account yet?** [Sign up free](https://platform.inworld.ai/signup). The On-Demand plan includes up to 70 minutes of TTS and 400 minutes of STT. The plugin works before you sign up: docs search needs no key, and the `connect` skill walks you through getting one.

### Where the plugin finds your key

1. The plugin's API key setting (Claude Code install prompt)
2. `INWORLD_API_KEY` in the environment the agent was launched from
3. The Inworld CLI's file-based credential store. On macOS and Windows the CLI stores credentials in the OS keychain, which the bundled server can't read yet, so export the key instead:

   ```
   npx -y -p @inworld/cli@latest inworld login
   export INWORLD_API_KEY="$(npx -y -p @inworld/cli@latest inworld auth print-api-key)"
   ```

## Skills

In Claude Code, run these as `/inworld:<skill>`. Codex lists them under the plugin and also invokes them from plain requests.

| Skill | What it does |
|---|---|
| `/inworld:setup [tts\|stt\|both]` | Detects your stack (Next.js, Express, FastAPI, Flask, plain Node/Python, etc.) and scaffolds a `lib/inworld.{ts,py}` helper module with TTS-2 + STT clients, adds `INWORLD_API_KEY` to `.env.example`, picks a voice, runs a Hello-from-Inworld test. |
| `/inworld:connect [check]` | Checks whether the agent can reach Inworld; if not, walks through free signup and getting the key to the agent (env var or CLI login) and to your app. |
| `/inworld:migrate [provider\|path]` | Finds existing ElevenLabs / OpenAI / Cartesia / Deepgram / cloud TTS calls, swaps them to Inworld behind a `TTS_PROVIDER` switch, maps voices and formats, and verifies with side-by-side samples. |
| `/inworld:find-voice [description]` | Describe the voice you want; it searches the library, plays the best matches saying a line from your app, designs a new voice if nothing fits, and saves the pick to config. |
| `/inworld:add-voice [where]` | Wires voice output into one specific feature. Browses voices, demos them with and without steering, then edits the relevant route or component. |
| `/inworld:speakable-text [file\|prompt]` | Finds the text your app speaks and fixes what will sound wrong: `<verbatim>` for booking refs and IDs, markdown in LLM replies, IPA pronunciation, pauses, steering scope. Updates the LLM prompt and plays before/after. |
| `/inworld:benchmark-models [models]` | Runs your system prompt and a real user turn through several LLMs on Inworld's router (including Inworld-hosted models and the same model on different providers) and compares time to first spoken audio, cost per 1k replies and how each reply sounds in your voice. |
| `/inworld:latency [flow]` | Measures time to first audio from your machine per model, then reviews your pipeline for streaming, LLM-to-TTS hand-off, keep-alive, WebSocket and region fixes. |
| `/inworld:add-realtime [browser\|server\|twilio]` | Scaffolds a working Realtime client — WebSocket for server / Twilio, WebRTC for browser. Includes backend token minting, mic capture, audio playback, `session.update` wiring. Includes an OpenAI Realtime migration cheat sheet if you're already on that. |
| `/inworld:add-streaming-tts [http\|websocket]` | Scaffolds a streaming TTS client for sub-200ms time-to-first-audio. Chunked HTTP for simplicity, WebSocket for cancellation + barge-in support. |
| `/inworld:add-transcription [short\|long] [diarization]` | Scaffolds transcription of recorded audio with Inworld STT-1: synchronous for short clips, async jobs for long recordings, with speaker diarization, word timestamps, Voice Profile, and custom vocabulary. |
| `/inworld:add-streaming-stt [browser\|server]` | Scaffolds a live mic → transcript streaming STT client. For captions, dictation, voice notes, meeting transcription, voice commands. Browser uses AudioWorklet; server uses SoX. |
| `/inworld:troubleshoot [error or problem]` | Diagnoses Inworld API errors and how-do-I questions using Inworld's official docs and support knowledge base (via `search_docs`), checks known sharp edges, reproduces with the MCP tools, and only then escalates to support — with a well-formed report. |

## MCP tools

The plugin's MCP server exposes 10 tools the agent can call directly:

| Tool | What it does |
|---|---|
| `list_voices` | Browse Inworld voices. Filters: `language`, `description_match` (keyword search of the voice description, e.g. `['warm']` — the reliable filter), `tags` (server-side tags, often empty today), `custom_only`. |
| `synthesize_speech` | TTS-2 by default; `inworld-tts-2-flash` for lowest latency. Inline steering, `delivery_mode`, `WORD` or `CHARACTER` timestamps. |
| `transcribe_audio` | Batch STT (file → text) with Inworld STT-1 (`model_id: inworld/inworld-stt-1`). Optional Voice Profile (age, emotion, pitch, vocal style, accent). |
| `clone_voice` | Clone a voice from one or more audio samples. Returns a new `voiceId`. |
| `design_voice` | Generate up to 3 preview voices from a text description. |
| `publish_voice` | Persist a designed voice to your library after picking the preview you like. |
| `chat_completion` | OpenAI-compatible call to any provider model (`openai/gpt-4o-mini`, `anthropic/claude-3-5-sonnet`, etc.) or to an Inworld Router (`inworld/<name>`). |
| `chat_completion_with_audio` | LLM + TTS in one call — chat reply returned as audio plus transcript. Faster than chat → synth because TTS pipelines while the LLM is still generating. |
| `list_routers` | List your configured Inworld Routers. |
| `search_docs` | AI search over Inworld's official knowledge: `docs` (docs portal + API reference), `website` (inworld.ai), `resolutions` (support knowledge base), `ui-actions` (Studio UI catalog). Public endpoint, no API key needed. |

### Voice lab tools

A second, dependency-free MCP server (`voice-lab/server.mjs`) covers the parts of building a voice app you do by ear. Clips play from buttons under the result in Claude Code (via the plugin's mod, early access), in an MCP Apps player card in hosts that support it (Claude Desktop chat, claude.ai, ChatGPT, Cursor), and through the OS audio player elsewhere.

| Tool | What it does |
|---|---|
| `find_voices` | Search the library from a description: structured filters (gender, age, language, use-case category) plus a free-text query ranked against voice tags and descriptions. `audition_line` renders the top four. |
| `compare_voices` | The same line in 2–4 voices, A–D. Mix library voices with one-off voice descriptions (ad-hoc voice design). |
| `design_voice` | Up to 3 previews from a description and an in-character script. Falls back to listen-only previews when the key can't save voices. |
| `publish_voice` | Save the chosen preview to the voice library. |
| `check_speech_text` | Offline checker for text sent to TTS: wraps alphanumeric IDs in `<verbatim>`, strips markdown and emoji, flags steering on Flash, unscoped steering, bad `<break>`s, `<phoneme>`, multi-word IPA, ambiguous dates. Optional before/after listen. |
| `list_llm_models` | The router's LLM catalog with prices per 1M tokens, context, tools and reasoning support. |
| `benchmark_models` | Your prompt through 1–8 router models: first token, first sentence, first audio (LLM streamed into Inworld TTS), full reply, tok/s, $ per 1k replies; then each reply rendered in your voice. |
| `measure_latency` | Times streaming TTS from this machine: first-audio p50/p90 and total, per model, optionally with normalization off. |

Realtime, streaming TTS, and streaming STT are intentionally **not** MCP tools — bidirectional streaming audio belongs in your app, not in the agent's MCP transport. The corresponding skills write that code into your project.

## TTS-2 quick reference

**Steering** — inline in the text:

```
[whisper] meet me at the docks
[say with rising excitement] we did it!
[laugh] that was a close one
[speak slowly and with concern] are you sure you want to continue?
```

**Delivery mode** — overall consistency: `STABLE`, `BALANCED` (default), `CREATIVE`.

**Pauses** — SSML break tags:

```
Welcome. <break time="500ms"/> Let me help you with that.
```

**Custom pronunciation** — replace one word with its English IPA, wrapped in slashes:

```
Your interests are a perfect match for a honeymoon in /kriːt/.
```

**Verbatim** — spell out codes, IDs, and booking references character by character:

```
Your booking reference is <verbatim>AHAA7771Z</verbatim>.
```

**Long text** — 2,000 characters per synthesize call. For longer copy, split at sentence boundaries, or use async synthesis (preview, up to 100,000 characters as one background job). For large libraries of separate lines, batch synthesis (preview) costs 20% less per character.

**OpenAI compatibility** — apps already using OpenAI's text-to-speech can point the OpenAI SDK at `https://api.inworld.ai/v1` and pick an Inworld model and voice.

## Models

| Model | Languages | Latency | Best for |
|---|---|---|---|
| `inworld-tts-2` (default) | 200+ | ~100 ms TTFB | Quality, steering, multilingual |
| `inworld-tts-2-flash` | 200+ (same as TTS-2) | ~20 ms TTFB | Lowest latency and cost; no steering instructions (non-verbal tags like `[laugh]` still work) |
| `inworld-tts-1.5-max` | 15 | <200 ms | Legacy; still accepted |
| `inworld-tts-1.5-mini` | 15 | ~120 ms | Legacy; still accepted |

STT (batch and streaming) uses `inworld/inworld-stt-1`: 30 languages, Voice Profile, and configurable turn-taking for streaming.

## Local development

The MCP server is **vendored from [`@inworld/cli`](https://github.com/inworld-ai/inworld-cli)** (its in-tree `packages/cli/src/mcp/` server, built as the `inworld-mcp` bin) — this repo has no server source of its own. The plugin pins the exact 10-tool surface via `INWORLD_MCP_TOOLSET=runtime` in `.mcp.json`, and the tool names + input schemas are locked by the CLI's `tests/mcp/runtime-tools.test.ts` contract test.

To change server behavior, change it in the CLI repo, then re-vendor:

```
cd inworld-tts-mcp
./scripts/vendor.sh          # pinned npm version (see CLI_VERSION in the script)
./scripts/vendor.sh 1.3.1    # specific npm version
./scripts/vendor.sh ~/code/inworld-cli   # local CLI checkout (must be built)
```

The script copies the artifact into `build/index.js` and runs `scripts/smoke.mjs`, which boots it standalone and asserts the 10-tool contract, then boots the plugin entry point with no key to confirm the server still starts. The vendored `build/index.js` is committed so end-users don't need a build step.

### One plugin, two hosts

`inworld-tts-mcp/` is a single plugin with a manifest per host. The skills, the vendored server, and the `scripts/start.mjs` entry point are shared.

| | Claude Code | Codex |
|---|---|---|
| Marketplace | `.claude-plugin/marketplace.json` | `.agents/plugins/marketplace.json` |
| Plugin manifest | `inworld-tts-mcp/.claude-plugin/plugin.json` | `inworld-tts-mcp/.codex-plugin/plugin.json` |
| MCP config | `inworld-tts-mcp/.mcp.json` (`${CLAUDE_PLUGIN_ROOT}`, `${user_config.api_key}`) | inline `mcpServers` in the Codex manifest (`cwd: "."`, `env_vars` forwards `INWORLD_API_KEY`) |
| Skill UI metadata | frontmatter | `skills/*/agents/openai.yaml` |

Codex doesn't expand `${...}` placeholders and Claude Code doesn't resolve relative MCP paths, which is why the MCP config lives in two places. `scripts/start.mjs` resolves the key (plugin setting, then `INWORLD_API_KEY`, then the CLI credential store) and starts the server even with no key, so `search_docs` works before signup.

Check both before a release:

```
claude plugin validate ./inworld-tts-mcp --strict
claude plugin validate .
python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py ./inworld-tts-mcp   # needs pyyaml
node inworld-tts-mcp/scripts/smoke.mjs
```

To try the Codex build without touching your real Codex config:

```
export CODEX_HOME="$(mktemp -d)"
codex plugin marketplace add "$PWD"
codex plugin add inworld@inworld
codex mcp get inworld
```

### Targeting a non-prod environment

The MCP server defaults to the production API (`https://api.inworld.ai`). To point it at a different environment (internal dev/staging), set `INWORLD_API_BASE` in the environment the agent is launched from:

```sh
export INWORLD_API_BASE="https://your-dev-endpoint.example.com"
```

Trailing slashes are stripped. When unset or empty, production is used.

## License

MIT
