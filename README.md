# Inworld AI — Claude Code Plugin

Comprehensive Inworld integration for any project, wired up by Claude Code in seconds.

- **TTS-2** — 100+ languages, natural-language steering (`[whisper]`, `[say with rising excitement]`, `[laugh]`), `delivery_mode`, word & character timestamps
- **Streaming TTS** — sub-200ms time-to-first-audio via chunked HTTP or WebSocket
- **STT (batch)** — multi-provider transcription (Whisper, Inworld STT-1) with optional voice profile (age/gender/accent/emotion)
- **STT (streaming)** — live mic → transcript over WebSocket, interim + final results
- **Realtime voice agents** — bidirectional speech-to-speech over WebSocket / WebRTC / Twilio, with optional Router-backed LLM
- **Voice cloning** — create a custom voice from as little as 5 seconds of audio
- **Voice design** — generate voices from a text description (no audio sample required)
- **LLM Router** — OpenAI-compatible chat completions with traffic-split routing, fallback, and A/B testing
- **LLM + TTS combined** — one call: chat completion that returns audio directly

## Install

```
/plugin marketplace add inworld-ai/claude-code-plugin
/plugin install inworld
```

Claude Code will prompt for your Inworld API key. Get one at [platform.inworld.ai/api-keys](https://platform.inworld.ai/api-keys) — paste the Base64-encoded value as-is.

## Slash commands

| Command | What it does |
|---|---|
| `/inworld:setup [tts\|stt\|both]` | Detects your stack (Next.js, Express, FastAPI, Flask, plain Node/Python, etc.) and scaffolds a `lib/inworld.{ts,py}` helper module with TTS-2 + STT clients, adds `INWORLD_API_KEY` to `.env.example`, picks a voice, runs a Hello-from-Inworld test. |
| `/inworld:add-voice [where]` | Wires voice output into one specific feature. Browses voices, demos them with and without steering, then edits the relevant route or component. |
| `/inworld:add-realtime [browser\|server\|twilio]` | Scaffolds a working Realtime client — WebSocket for server / Twilio, WebRTC for browser. Includes backend token minting, mic capture, audio playback, `session.update` wiring. Includes an OpenAI Realtime migration cheat sheet if you're already on that. |
| `/inworld:add-streaming-tts [http\|websocket]` | Scaffolds a streaming TTS client for sub-200ms time-to-first-audio. Chunked HTTP for simplicity, WebSocket for cancellation + barge-in support. |
| `/inworld:add-streaming-stt [browser\|server]` | Scaffolds a live mic → transcript streaming STT client. For captions, dictation, voice notes, meeting transcription, voice commands. Browser uses AudioWorklet; server uses SoX. |

## MCP tools

The plugin's MCP server exposes 9 tools that Claude can call directly:

| Tool | What it does |
|---|---|
| `list_voices` | Browse Inworld voices. Filters: `language`, `description_match` (keyword search of the voice description, e.g. `['warm']` — the reliable filter), `tags` (server-side tags, often empty today), `custom_only`. |
| `synthesize_speech` | TTS-2 by default. Inline steering, `delivery_mode`, `WORD` or `CHARACTER` timestamps. |
| `transcribe_audio` | Batch STT (file → text). Optional voice profile (age, gender, accent, emotion). |
| `clone_voice` | Clone a voice from one or more audio samples. Returns a new `voiceId`. |
| `design_voice` | Generate up to 3 preview voices from a text description. |
| `publish_voice` | Persist a designed voice to your library after picking the preview you like. |
| `chat_completion` | OpenAI-compatible call to any provider model (`openai/gpt-4o-mini`, `anthropic/claude-3-5-sonnet`, etc.) or to an Inworld Router (`inworld/<name>`). |
| `chat_completion_with_audio` | LLM + TTS in one call — chat reply returned as audio plus transcript. Faster than chat → synth because TTS pipelines while the LLM is still generating. |
| `list_routers` | List your configured Inworld Routers. |

Realtime, streaming TTS, and streaming STT are intentionally **not** MCP tools — bidirectional streaming audio belongs in your app, not in Claude's MCP transport. The corresponding skills write that code into your project.

## TTS-2 quick reference

**Steering** — inline in the text:

```
[whisper] meet me at the docks
[say with rising excitement] we did it!
[laugh] that was a close one
[speak slowly and with concern] are you sure you want to continue?
```

**Delivery mode** — overall consistency: `STABLE`, `BALANCED` (default), `EXPRESSIVE`.

**Pauses** — SSML break tags:

```
Welcome. <break time="500ms"/> Let me help you with that.
```

**Custom pronunciation** — IPA phonemes for stubborn proper nouns:

```
Visit <phoneme alphabet="ipa" ph="ˈnaɪkiː">Nike</phoneme>'s site.
```

**Long text** — 2,000 character limit per synthesize call; split at sentence boundaries client-side for longer copy.

## Models

| Model | Languages | Latency | Best for |
|---|---|---|---|
| `inworld-tts-2` (default) | 100+ | — | Quality, steering, multilingual |
| `inworld-tts-1.5-max` | 15 | <200 ms | Latency + quality balance |
| `inworld-tts-1.5-mini` | 15 | ~120 ms | Lowest latency |

STT streaming additionally supports `assemblyai/universal-streaming-multilingual`, `assemblyai/universal-streaming-english`, `assemblyai/u3-rt-pro`, `assemblyai/whisper-rt`, `soniox/stt-rt-v4`.

## Local development

```
cd inworld-tts-mcp
npm install
npm run build
```

The built `build/index.js` is committed so end-users don't need a build step.

## License

MIT
