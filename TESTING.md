# Testing Guide

State of verification for the Inworld Claude Code plugin, plus a structured
pass for new testers. Last full verification: **v0.6.2, 2026-07-03** (all 9
MCP tools against the live production API).

## Install (the thing most worth re-testing)

The install path is where environment differences bite. On a machine that has
never had the plugin:

```
# one-time, while the repo is private (Inworld employees):
gh auth setup-git
```

**Claude Code** (any project; run each command on its own line):

```
/plugin marketplace add https://github.com/inworld-ai/claude-code-plugin
/plugin install inworld@inworld
```

- Choose **user scope** when prompted.
- Paste your Inworld API key (Base64, from platform.inworld.ai/api-keys), or skip it and export `INWORLD_API_KEY` in the shell that launches Claude Code.
- **Fully restart Claude Code**: MCP servers only register at session start.
- `/mcp` should list `plugin:inworld:inworld · connected · 10 tools`, with or without an API key.

**Codex** (CLI bundled with the ChatGPT desktop app at
`/Applications/ChatGPT.app/Contents/Resources/codex`, or `codex` on PATH). Codex has
no install-time key prompt, so the key comes from the environment:

```
export INWORLD_API_KEY="<key>"     # in the shell that launches Codex
codex plugin marketplace add https://github.com/inworld-ai/claude-code-plugin
codex plugin add inworld@inworld
codex mcp get inworld     # command node, args scripts/start.mjs, cwd = plugin root
```

- Start a new Codex session after installing or changing the key: MCP servers read their environment at startup.
- In a session, ask for the Inworld voices; a voice list means connected. Without a key, the server still starts and `search_docs` works.

Known trap: plugin installs are cached **by version**. If you ever see stale
behavior after an update, `/plugin uninstall inworld`, `/plugin marketplace
remove inworld`, restart, re-add. (This is why every release bumps the version.)

## Verified matrix (v0.6.2)

| Tool | How verified | Expected |
|---|---|---|
| `list_voices` | Live, multiple filters | JSON `{count, voices[]}`; 600+ voices unfiltered. `description_match: ["warm"]` narrows; `tags` usually matches nothing (API returns empty tags — documented in the tool description) |
| `synthesize_speech` | Live, TTS-2 + steering + `delivery_mode` | Audio file written; word timestamps in response. `[whisper] test` audibly whispers |
| `transcribe_audio` | Live (batch STT) | Transcript text; voice profile (age/emotion/accent) with `inworld/inworld-stt-1` |
| `clone_voice` | Live (11.5s sample) | New `voiceId`, no warnings; voice appears in `list_voices(custom_only: true)` |
| `design_voice` | Live, twice | 1–3 preview voiceIds; optional MP3s written to `preview_output_dir` |
| `publish_voice` | Live (server-side confirmed; response parsing fixed in v0.6.2) | `{voiceId, displayName, status: "published"}`; voice persists in library. **Publish promptly** — design previews expire |
| `chat_completion` | Live (`openai/gpt-4o-mini`) | Text reply + usage stats |
| `chat_completion_with_audio` | Live | WAV written + transcript (PCM16 48kHz mono) |
| `list_routers` | Live | `[]` unless Routers are configured in the portal |

## Quick per-tool smoke prompts

Paste into a session with the plugin installed (phrase as "use the inworld
plugin's X tool" so Claude doesn't fall back to the `@inworld/cli` binary or
raw curl):

1. `Use the inworld plugin's list_voices tool with description_match ["warm"] and language "en"`
2. `Use synthesize_speech: text "[say with rising excitement] It works!", voice Ashley, delivery_mode CREATIVE, save to ./test.mp3` — then listen
3. `Transcribe ./test.mp3 with the inworld transcribe_audio tool`
4. `Use design_voice (a warm British male narrator..., EN_US, preview text "Once upon a time", 1 sample), then IMMEDIATELY publish_voice the returned id with display_name "Delete Me Test"` — approve the second permission prompt quickly; previews expire
5. `Use chat_completion_with_audio: model openai/gpt-4o-mini, voice Ashley, message "Say: audio test", save to ./reply.wav`

**Cleanup:** delete any test voices from the portal voice library afterward.

## Known API quirks (not plugin bugs)

- The API **silently ignores unknown fields and invalid enum values** (HTTP
  200 + audio). A typo'd parameter fails silently, not loudly. Spec-check
  against docs.inworld.ai when adding request fields.
- Voice `tags[]` come back empty; qualities live in `description` text.
- The publish endpoint returns voice fields at the **top level**; clone wraps
  them in `voice`. (Both handled.)
- The stock voice library grows fast (62 → 260 between May and July 2026);
  don't hardcode counts.

## Untested surface — highest-value areas for new testers

- **Skills end-to-end** (`/inworld:setup`, `/inworld:add-voice`,
  `/inworld:add-realtime`, `/inworld:add-streaming-tts`,
  `/inworld:add-streaming-stt`): the scaffolded code has been reviewed against
  official examples but not executed in real projects. Python/FastAPI and
  browser (WebRTC/AudioWorklet) scaffolds especially.
- **Realtime + streaming-STT/TTS client code**: written from the official docs
  and `inworld-api-examples`, not yet run against live WS endpoints.
- **Non-macOS**: everything so far was verified on macOS/arm64.
- **STT with real-world audio**: verified with clean TTS-generated samples;
  noisy mic recordings untested.
- **`INWORLD_API_BASE` override** (v0.6.2): logic unit-tested; not yet used
  against a real non-prod endpoint.
- **Windows paths** in `output_file` / `audio_files` handling.

## Reporting

File issues on this repo, or DM Clint McLean. Include: OS, Claude Code
version (`claude --version`), plugin version (from `/plugin` → Installed),
and the tool call + response.
