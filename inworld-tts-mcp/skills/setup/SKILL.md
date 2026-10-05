---
name: setup
description: |
  Wire Inworld AI speech APIs into the current project end-to-end.
  Detects the user's stack, adds the right dependencies and env vars, scaffolds a
  reusable client module for TTS-2 / STT, and generates a working example so the
  user can hear or transcribe audio within a minute.
  Use when the user wants to add Inworld voice features to a project for the first time.
argument-hint: "[tts|stt|both]"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, Agent, mcp__plugin_inworld_inworld__list_voices, mcp__plugin_inworld_inworld__synthesize_speech, mcp__plugin_inworld_inworld__transcribe_audio
---

# Inworld Setup Skill

Wire Inworld's speech APIs into the user's project. The Claude Code plugin already
handles auth — the API key flows from `userConfig` into the MCP server's
`INWORLD_API_KEY` env var. The user does NOT need to re-paste it.

## Step 1 — Detect the stack

Look at the project root and read the most informative file you find:
- `package.json` → Node.js / TypeScript. Note frameworks: Next.js, Remix, Express, Fastify, NestJS, Vite, React.
- `pyproject.toml` / `requirements.txt` → Python. Note frameworks: FastAPI, Flask, Django.
- `go.mod` → Go.
- `Cargo.toml` → Rust.
- `Gemfile` → Ruby/Rails.

Pick the integration style that matches: server-side route, client component with mic, CLI script.

## Step 2 — Scope (from $ARGUMENTS)

- `tts` → Text-to-Speech only
- `stt` → Speech-to-Text only
- `both` / empty → Both

If the user wants Realtime voice-agent conversations (bidirectional streaming),
tell them to run `/inworld:add-realtime` instead — that's a different transport
and gets its own skill.

If the user wants live STT (captions, dictation, voice notes, meeting
transcription — streaming mic → text without a full LLM+TTS loop), tell them
to run `/inworld:add-streaming-stt` instead. The batch STT helper this skill
scaffolds is for "I have an audio file, transcribe it" use cases, not live mic.

## Step 3 — Scaffold the client module

Write a single helper file that the rest of the app imports. Keep it short.

### Node.js / TypeScript

Path: `src/lib/inworld.ts` (or `lib/inworld.ts` if there's no `src/`).

```ts
const INWORLD_API_BASE = "https://api.inworld.ai";

function authHeaders() {
  const key = process.env.INWORLD_API_KEY;
  if (!key) throw new Error("INWORLD_API_KEY is not set");
  return {
    Authorization: `Basic ${key}`,
    "Content-Type": "application/json",
  };
}

export interface SynthesizeOptions {
  text: string;
  voiceId: string;
  modelId?: "inworld-tts-2" | "inworld-tts-2-flash" | "inworld-tts-1.5-max" | "inworld-tts-1.5-mini";
  audioEncoding?: "MP3" | "LINEAR16" | "WAV" | "OGG_OPUS" | "FLAC";
  sampleRateHertz?: number;
  speakingRate?: number;
  deliveryMode?: "STABLE" | "BALANCED" | "CREATIVE";
}

export async function synthesize(opts: SynthesizeOptions): Promise<Buffer> {
  const body: Record<string, unknown> = {
    text: opts.text,
    voiceId: opts.voiceId,
    modelId: opts.modelId ?? "inworld-tts-2",
    audioConfig: {
      audioEncoding: opts.audioEncoding ?? "MP3",
      sampleRateHertz: opts.sampleRateHertz ?? 48000,
      speakingRate: opts.speakingRate ?? 1.0,
    },
  };
  if (opts.deliveryMode && (opts.modelId ?? "inworld-tts-2") === "inworld-tts-2") {
    body.deliveryMode = opts.deliveryMode;
  }

  const res = await fetch(`${INWORLD_API_BASE}/tts/v1/voice`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Inworld TTS failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { audioContent: string };
  return Buffer.from(data.audioContent, "base64");
}

export async function transcribe(audio: Buffer, opts?: { language?: string }): Promise<string> {
  const res = await fetch(`${INWORLD_API_BASE}/stt/v1/transcribe`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      transcribeConfig: {
        modelId: "groq/whisper-large-v3",
        audioEncoding: "AUTO_DETECT",
        sampleRateHertz: 16000,
        numberOfChannels: 1,
        ...(opts?.language ? { language: opts.language } : {}),
      },
      audioData: { content: audio.toString("base64") },
    }),
  });
  if (!res.ok) throw new Error(`Inworld STT failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { transcription: { transcript: string } };
  return data.transcription.transcript;
}
```

For Next.js, also create `app/api/tts/route.ts` (or `pages/api/tts.ts`) that wraps
`synthesize` and streams the buffer back as `audio/mpeg`.

### Python

Path: `src/inworld.py` (or top-level `inworld.py`).

```python
import base64
import os
import httpx

INWORLD_API_BASE = "https://api.inworld.ai"

def _headers() -> dict:
    key = os.environ["INWORLD_API_KEY"]
    return {"Authorization": f"Basic {key}", "Content-Type": "application/json"}

def synthesize(
    text: str,
    voice_id: str,
    *,
    model_id: str = "inworld-tts-2",
    audio_encoding: str = "MP3",
    sample_rate: int = 48000,
    speaking_rate: float = 1.0,
    delivery_mode: str | None = None,
) -> bytes:
    body: dict = {
        "text": text,
        "voiceId": voice_id,
        "modelId": model_id,
        "audioConfig": {
            "audioEncoding": audio_encoding,
            "sampleRateHertz": sample_rate,
            "speakingRate": speaking_rate,
        },
    }
    if delivery_mode and model_id == "inworld-tts-2":
        body["deliveryMode"] = delivery_mode
    r = httpx.post(f"{INWORLD_API_BASE}/tts/v1/voice", json=body, headers=_headers(), timeout=60)
    r.raise_for_status()
    return base64.b64decode(r.json()["audioContent"])

def transcribe(audio: bytes, *, language: str | None = None) -> str:
    cfg: dict = {
        "modelId": "groq/whisper-large-v3",
        "audioEncoding": "AUTO_DETECT",
        "sampleRateHertz": 16000,
        "numberOfChannels": 1,
    }
    if language:
        cfg["language"] = language
    r = httpx.post(
        f"{INWORLD_API_BASE}/stt/v1/transcribe",
        json={"transcribeConfig": cfg, "audioData": {"content": base64.b64encode(audio).decode()}},
        headers=_headers(),
        timeout=120,
    )
    r.raise_for_status()
    return r.json()["transcription"]["transcript"]
```

For FastAPI, add a `/tts` route that returns `Response(content=synthesize(...), media_type="audio/mpeg")`.

## Step 4 — Env vars

Add `INWORLD_API_KEY=` (empty) to `.env.example`. Do not write the real key.
Add `.env` to `.gitignore` if it isn't there.

## Step 5 — Pick a voice

Call `list_voices` and show 5 voices the user might like. Mention that TTS-2
voices respond to bracketed steering: `[whisper]`, `[say with rising excitement]`,
`[laugh]`, etc. If the user needs the lowest latency or cost, mention
`inworld-tts-2-flash`: same languages, ~20ms TTFB vs ~100ms, but no steering
instructions (non-verbal tags like `[laugh]` still work).

Additional text features to mention in the helper module's docstring:
- **Pauses**: SSML `<break time="500ms"/>` inline for explicit timing
- **Custom pronunciation**: `<phoneme alphabet="ipa" ph="ˈnaɪkiː">Nike</phoneme>` for
  proper nouns and acronyms that TTS would otherwise mispronounce
- **Long text**: 2,000 character limit per call. For longer text, split at sentence
  boundaries client-side and concatenate the resulting audio (MP3 concatenation works;
  PCM/WAV needs header handling).

If the user wants to create their own custom voices (instead of just using the public
library), point them at the `clone_voice` MCP tool (clones from 5+ seconds of audio)
or `design_voice` (generates from a text description).

## Step 6 — Prove it works

Use `synthesize_speech` to generate a 3-second test clip (e.g. "Hello from Inworld.")
into a temp file. Tell the user the path. If they asked for STT, offer to
transcribe an audio file they provide.

## Step 7 — Summarize

Tell the user:
1. What file(s) you created.
2. The voice they picked.
3. One next step (e.g. "import `synthesize` from `./lib/inworld` in your chat handler").
