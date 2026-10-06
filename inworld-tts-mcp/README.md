# Inworld AI for Claude Code

Lets Claude Code add Inworld voice features to your app: text-to-speech, speech-to-text, voice cloning and design, and realtime voice agents. It gives Claude ten tools for working with Inworld directly, plus seven skills that write working integration code into your project.

## What you can ask for

Once it's installed, ask Claude Code for things like:

- **"Add a read-aloud button to our blog posts."** Claude previews voices with you, then wires up the API route and the button.
- **"Transcribe our support-call recordings with speaker labels."** Claude writes a batch job using Inworld STT.
- **"Build a voice agent for our booking flow."** Claude scaffolds a realtime voice client with secure browser auth.
- **"Design a voice for our game's narrator."** Claude generates previews you can listen to, then saves the one you pick.
- **"Why does my TTS call return 401?"** Claude checks Inworld's docs and your code, then fixes it.

Without the plugin, Claude has to guess at Inworld's APIs. With it, Claude calls Inworld directly while you work, so you hear real samples before anything is wired in, and the code it writes follows Inworld's documented patterns.

## What's included

- **TTS-2**: 200+ languages and natural-language steering (`[whisper]`, `[say with rising excitement]`), plus **TTS-2 Flash** for the lowest latency
- **Speech-to-text**: Inworld STT-1 in 30 languages: short clips, long recordings with speaker diarization, and live streaming, with optional voice profiling (age, emotion, pitch, vocal style, accent) and custom vocabulary
- **Voices**: instant voice cloning (best with 15–30 seconds of clean audio) and voice design; the skills also guide you to Professional Voice Cloning (beta) for production voices
- **Realtime voice agents**
- **The Inworld LLM Router**

## Requirements

- Claude Code (terminal, IDE extension, or the desktop app's Code tab). The voice tools run as a local MCP server, so they don't load in claude.ai chat or Cowork.
- An Inworld account and API key from [platform.inworld.ai/api-keys](https://platform.inworld.ai/api-keys). Claude Code prompts for the key when you enable the plugin and stores it as a sensitive value.
- Node.js 20 or later on your `PATH`. The MCP server runs locally with `node`.

## Install

```
/plugin marketplace add inworld-ai/claude-code-plugin
/plugin install inworld
```

## Skills

| Command | What it does |
|---|---|
| `/inworld:setup` | Detects your stack and scaffolds an Inworld TTS/STT helper module, an `.env.example` entry, and a test call. |
| `/inworld:add-voice` | Adds spoken output to one feature in your app, after previewing voices. |
| `/inworld:add-realtime` | Scaffolds a Realtime voice-agent client: WebSocket, WebRTC, or Twilio. |
| `/inworld:add-streaming-tts` | Scaffolds a low-latency streaming TTS client. |
| `/inworld:add-transcription` | Scaffolds transcription of recorded audio: short clips, or long recordings as async jobs with speaker diarization. |
| `/inworld:add-streaming-stt` | Scaffolds a live microphone-to-transcript client. |
| `/inworld:troubleshoot` | Diagnoses Inworld API errors using Inworld's official docs and support knowledge base. |

The skills edit files only in your current project, and Claude Code asks you before each change.

## MCP tools

`list_voices`, `synthesize_speech`, `transcribe_audio`, `clone_voice`, `design_voice`, `publish_voice`, `chat_completion`, `chat_completion_with_audio`, `list_routers`, `search_docs`.

## What this plugin runs, sends, and stores

**What runs locally.** The plugin starts one local MCP server over stdio with `node build/index.js`. That file is the MCP server from Inworld's open-source [`@inworld/cli`](https://github.com/inworld-ai/inworld-cli), bundled into a single file so you don't need a build step. Because it is a bundle, it is a large file. `scripts/vendor.sh` shows how it is produced, and `scripts/smoke.mjs` checks the tool contract. Neither script runs during normal use.

**Where your data goes.** Requests go only to Inworld, over HTTPS:

- `api.inworld.ai` receives the input of each tool call:
  - text to synthesize
  - audio files you ask it to transcribe or clone
  - voice descriptions
  - chat messages for the LLM Router

  These requests are authenticated with your API key. LLM calls are routed by Inworld to the model provider you choose, such as `openai/...` or `anthropic/...`.
- `search_docs` sends your search query to Inworld's documentation search endpoint (`api.inworld.ai/api/v1/inworld-assistant`).

The plugin sends no telemetry or analytics. It contacts no other services.

**Credentials.**
- The plugin uses the API key you enter at install time. The key is passed to the server as the `INWORLD_API_KEY` environment variable.
- If that variable is empty, the server falls back to credentials saved by the Inworld CLI (`inworld login`) on the same machine:
  - the CLI's config store (`inworld-cli`)
  - the server's own session file at `~/.config/inworld-mcp/session.json`

  Expired CLI sessions are refreshed through Google's Firebase token service (`securetoken.googleapis.com`), which Inworld uses for sign-in.
- The plugin reads no other local credentials.

**What it stores.** The plugin keeps no data of its own. Audio you synthesize is written only to the output path you or Claude choose. Cloned and published voices are saved in your Inworld account. Inworld's handling of API data is covered by the [Inworld privacy policy](https://inworld.ai/privacy).

## Support

- Docs: [docs.inworld.ai](https://docs.inworld.ai)
- Issues: [github.com/inworld-ai/claude-code-plugin/issues](https://github.com/inworld-ai/claude-code-plugin/issues)

## License

MIT
