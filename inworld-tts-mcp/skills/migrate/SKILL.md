---
name: migrate
description: |
  Migrate an existing text-to-speech integration to Inworld: finds ElevenLabs, OpenAI
  TTS / Realtime, Cartesia, Deepgram Aura, Google Cloud TTS, Azure Speech, or Amazon
  Polly calls in the codebase, swaps them for Inworld TTS-2 behind a provider switch,
  maps voices and audio settings, and verifies with a side-by-side sample.
  Use when the user wants to switch TTS providers, replace or compare ElevenLabs (or
  another vendor) with Inworld, cut TTS cost or latency in an app that already speaks,
  or port cloned voices to Inworld.
argument-hint: "[provider or path]"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, Agent, mcp__plugin_inworld_inworld__list_voices, mcp__plugin_inworld_inworld__synthesize_speech, mcp__plugin_inworld_inworld__clone_voice, mcp__plugin_inworld_inworld__search_docs
---

# Migrate to Inworld TTS

Swap an app's existing TTS provider for Inworld without breaking it: keep the old path
behind a switch, move call sites one at a time, and prove parity with audio the user
can listen to.

## Step 1 — Inventory the current integration

Search the codebase (respect `$ARGUMENTS` if it names a provider or a path). Useful
patterns:

| Provider | Look for |
|---|---|
| ElevenLabs | `api.elevenlabs.io`, `xi-api-key`, `@elevenlabs/elevenlabs-js`, `elevenlabs` (npm/PyPI), `textToSpeech.convert`, `text_to_speech.convert`, `/stream-input` |
| OpenAI TTS | `audio.speech.create`, `/v1/audio/speech`, `gpt-4o-mini-tts`, `tts-1` |
| OpenAI Realtime | `/v1/realtime`, `gpt-realtime`, `session.update`, `@openai/agents-realtime` |
| Cartesia | `api.cartesia.ai`, `Cartesia-Version`, `@cartesia/cartesia-js`, `cartesia` (PyPI), `sonic-` |
| Deepgram Aura | `api.deepgram.com/v1/speak`, `aura-`, `speak.rest`, `speak.live` |
| Google / Azure / AWS | `texttospeech.googleapis.com`, `@google-cloud/text-to-speech`, `microsoft-cognitiveservices-speech-sdk`, `SpeechSynthesizer`, `@aws-sdk/client-polly`, `SynthesizeSpeechCommand` |
| Voice frameworks | `livekit.plugins.elevenlabs` / `cartesia` / `deepgram`, Pipecat `ElevenLabsTTSService` / `CartesiaTTSService`, Vapi or Twilio ConversationRelay voice settings |

For each call site, record: file and function, provider, mode (one-shot, HTTP stream,
WebSocket), voice, model, output format and sample rate, extras used (timestamps,
SSML, pronunciation dictionaries, voice settings), and where the key comes from.

Show the user this table and confirm the scope before editing anything. If nothing is
found, say so and offer the `setup` skill instead.

## Step 2 — Connect and pick voices

Call `list_voices` with `{"language": "en"}` (or the app's language). If it reports a
missing key, run the `connect` skill first.

For each voice in use, propose one or two Inworld voices: use `description_match` with
words from the old voice's character (e.g. `["warm", "narrator"]`), and play the
candidates by synthesizing the app's own copy with `synthesize_speech`. For cloned or
branded voices:

- ElevenLabs clones: the open-source batch tool `inworld-ai/voice-migration-tool` copies
  them across (it runs locally with both API keys). See `search_docs` "ElevenLabs
  migration".
- Anything else: `clone_voice` takes 3–30 s of clean reference audio.

## Step 3 — Add the Inworld path behind a switch

Add a provider switch (e.g. `TTS_PROVIDER=inworld|elevenlabs`, default unchanged until
the user flips it) and an Inworld implementation with the same function signature as
the old one, so callers don't change. Keep `INWORLD_API_KEY` server-side, add it to
`.env.example`, and never delete the old provider's code unless the user asks.

### OpenAI TTS → base-URL swap

Inworld serves OpenAI's `POST /v1/audio/speech`, so the SDK stays:

- `baseURL` / `base_url` → `https://api.inworld.ai/v1`, `apiKey` → the Inworld key.
- `model` → `inworld-tts-2` (quality, steering) or `inworld-tts-2-flash` (latency, cost;
  no steering).
  OpenAI model names return 400.
- `voice` → an Inworld voice ID (case-sensitive). OpenAI names like `alloy` return 404.
- `response_format`: `mp3`, `opus`, `flac`, `wav`, `pcm` work; `aac` does not.
- `speed` 0.5–1.5; `instructions` works on `inworld-tts-2`; `input` up to 4,000 chars.

If the same OpenAI client also makes chat calls, create a second client for speech
rather than repointing the shared one. (The same base URL also serves Inworld's
OpenAI-compatible LLM Router; moving chat traffic is a separate decision.)

### OpenAI Realtime → Inworld Realtime

Same event protocol with a different endpoint and session config. Use the `add-realtime`
skill's migration section and `search_docs` "OpenAI Realtime migration".

### Everything else → Inworld REST

| Mode | Inworld endpoint |
|---|---|
| One-shot (≤2,000 chars) | `POST https://api.inworld.ai/tts/v1/voice` → base64 `audioContent` |
| HTTP stream (≤4,000 chars) | `POST https://api.inworld.ai/tts/v1/voice:stream` → NDJSON `{"result":{"audioContent"}}` |
| WebSocket, text streamed in | `wss://api.inworld.ai/tts/v1/voice:streamBidirectional` (context-based: `create`, `send_text`, `flush_context`, `close_context`) |

Auth is `Authorization: Basic <INWORLD_API_KEY>`. The `setup` skill has the one-shot
client and the `add-streaming-tts` skill has the stream and WebSocket clients; reuse
them rather than writing new ones.

Field mapping:

| Old | Inworld |
|---|---|
| `text` / `transcript` / `input` | `text` |
| voice ID (ElevenLabs `voice_id`, Cartesia `voice.id`, the voice part of a Deepgram `aura-2-<voice>-en` model) | `voiceId` |
| fast models (ElevenLabs Flash/Turbo, Cartesia Sonic Turbo, Aura) | `modelId: "inworld-tts-2-flash"` |
| quality models (ElevenLabs Multilingual / v3, Cartesia Sonic) | `modelId: "inworld-tts-2"` |
| `mp3_44100_128`-style formats | `audioConfig: {audioEncoding: "MP3", sampleRateHertz: 44100}` (16–48 kHz) |
| raw 16-bit PCM (`pcm_16000`, `pcm_s16le`, `linear16`) | `audioEncoding: "PCM"` (no header) or `"WAV"` (header), same rate, 8–48 kHz |
| μ-law / A-law 8 kHz telephony | `audioEncoding: "MULAW"` / `"ALAW"`, `sampleRateHertz: 8000` |
| speed | `audioConfig.speakingRate` (0.5–1.5) |
| stability-style voice settings | `deliveryMode`: `STABLE`, `BALANCED` (default), `CREATIVE` — an approximation; tell the user it is a judgment call |
| word / character timestamps | `timestampType: "WORD"` or `"CHARACTER"` |
| pronunciation dictionaries, SSML `<phoneme>` | inline English IPA between slashes, one word at a time: `/kriːt/` (`<phoneme>` is not supported) |
| SSML `<break>` | inline `<break time="500ms"/>` |
| style / emotion prompts | TTS-2 steering tags inline, e.g. `[say warmly]`, `[whisper]` (`inworld-tts-2` only; if the app needs both speed and style, test both models) |

Anything without a clear equivalent (ElevenLabs `previous_text`/`next_text` stitching,
other SSML tags such as `<prosody>` or `<emphasis>`, per-request seeds): check
`search_docs` before assuming. If there's still no equivalent, list it for the user
instead of silently dropping it.

### Voice frameworks

Don't hand-roll HTTP inside LiveKit or Pipecat. Both ship Inworld integrations (a
LiveKit Agents plugin and Pipecat's built-in `InworldTTSService`). Run `search_docs`
"LiveKit" or "Pipecat" for the current package and class names, then swap the TTS
constructor only. For Vapi and Twilio ConversationRelay, the change is the TTS provider
or voice setting; `search_docs` has the exact fields.

## Step 4 — Verify side by side

1. With `synthesize_speech`, render two or three real strings from the app (a greeting,
   a number- or name-heavy line, the longest typical line) in the chosen Inworld voice
   and save them next to the old provider's output if the user can produce it.
2. Run the app's own path with `TTS_PROVIDER=inworld` and confirm the audio plays in
   the format the consumer expects: sample rate, container, and mono.
3. For streaming paths, measure time to first audio chunk on both providers from the
   same machine and report both numbers, labelled as measured locally.

## Step 5 — Hand off

Summarize: files changed, the switch name and how to flip it, voice mapping, anything
you couldn't map, and how to roll back (flip the switch). For pricing, run
`search_docs` "pricing" or point to https://inworld.ai/pricing; don't quote numbers
from memory.
