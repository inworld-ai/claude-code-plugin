---
name: add-streaming-tts
description: |
  Wire Inworld's streaming TTS API into the user's project for sub-200ms time-to-first-audio.
  The endpoint streams audio chunks back via chunked HTTP (or WebSocket) as the model generates,
  so playback can start before synthesis completes. Use for chat agents, voice assistants,
  game narration, anywhere latency matters and batch synthesize_speech feels too slow.
argument-hint: "[http|websocket]"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, Agent, mcp__plugin_inworld_inworld__list_voices, mcp__plugin_inworld_inworld__synthesize_speech
---

# Add Streaming TTS Skill

Inworld exposes streaming TTS two ways:

| Transport | Endpoint | When to use |
|---|---|---|
| Chunked HTTP | `POST https://api.inworld.ai/tts/v1/voice:stream` | Server-side or anywhere fetch+streams work. Simpler. |
| WebSocket    | `wss://api.inworld.ai/v1/tts/synthesize:websocket` | Lowest latency, bidirectional, allows mid-stream cancellation. |

The plugin's MCP `synthesize_speech` tool uses the non-streaming endpoint and writes a complete
file at the end. For chat agents that need playback to start before synthesis finishes, you want
the streaming variants in your own code.

## Step 1 — Pick the transport

From $ARGUMENTS or by asking:
- `http` → chunked HTTP. Default. Works everywhere. Easy to debug.
- `websocket` → WebSocket. Best for interactive UIs where you might want to interrupt mid-utterance.

Default to `http` unless the user mentions cancellation, barge-in, or sub-100ms TTFA.

## Step 2 — Pick a voice + model

Ask the user, or call `list_voices` and suggest 3–5. Defaults to use:
- `voice_id`: any from list_voices (e.g. `Ashley`)
- `model_id`: `inworld-tts-2` for quality and steering, or `inworld-tts-1.5-mini` for ~120ms latency

Mention steering if not already known — TTS-2 supports `[whisper]`, `[say with rising excitement]`,
inline `[laugh]`, etc.

## Step 3 — Scaffold the chunked-HTTP client (Node)

`src/streaming-tts/client.ts`:

```ts
export interface StreamingTtsOptions {
  apiKey: string;
  text: string;
  voiceId: string;
  modelId?: "inworld-tts-2" | "inworld-tts-1.5-max" | "inworld-tts-1.5-mini";
  audioEncoding?: "MP3" | "LINEAR16" | "OGG_OPUS";
  sampleRateHertz?: number;
  speakingRate?: number;
  deliveryMode?: "STABLE" | "BALANCED" | "CREATIVE";
  onAudioChunk?: (audio: Buffer) => void;          // raw audio bytes per chunk
  onTimestamp?: (info: unknown) => void;            // word/character timing per chunk
}

export async function streamSynthesize(opts: StreamingTtsOptions): Promise<void> {
  const body: Record<string, unknown> = {
    text: opts.text,
    voiceId: opts.voiceId,
    modelId: opts.modelId ?? "inworld-tts-2",
    audioConfig: {
      audioEncoding: opts.audioEncoding ?? "MP3",
      sampleRateHertz: opts.sampleRateHertz ?? 48000,
      speakingRate: opts.speakingRate ?? 1.0,
    },
    timestampType: "WORD",
  };
  if (opts.deliveryMode && (opts.modelId ?? "inworld-tts-2") === "inworld-tts-2") {
    body.deliveryMode = opts.deliveryMode;
  }

  const res = await fetch("https://api.inworld.ai/tts/v1/voice:stream", {
    method: "POST",
    headers: {
      Authorization: `Basic ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Inworld streaming TTS failed: ${res.status} ${await res.text()}`);
  }

  // Response is a stream of newline-delimited JSON objects.
  // Each object has shape: { result: { audioContent: base64, usage, timestampInfo? } }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let obj: any;
      try { obj = JSON.parse(line); } catch { continue; }
      const audioB64 = obj?.result?.audioContent;
      if (audioB64) opts.onAudioChunk?.(Buffer.from(audioB64, "base64"));
      const ts = obj?.result?.timestampInfo;
      if (ts) opts.onTimestamp?.(ts);
    }
  }
}
```

Typical usage — pipe directly to a player or HTTP response:

```ts
// Node: pipe to system audio via SoX / ffplay
import { spawn } from "node:child_process";
const player = spawn("ffplay", ["-autoexit", "-nodisp", "-loglevel", "quiet", "-"], {
  stdio: ["pipe", "ignore", "ignore"],
});
await streamSynthesize({
  apiKey: process.env.INWORLD_API_KEY!,
  text: "[say with rising excitement] We did it!",
  voiceId: "Ashley",
  onAudioChunk: (chunk) => player.stdin.write(chunk),
});
player.stdin.end();
```

```ts
// Server: stream MP3 chunks back to a browser <audio src> over fetch
// route.ts (Next.js):
export async function POST(req: Request) {
  const { text, voice } = await req.json();
  return new Response(new ReadableStream({
    async start(controller) {
      await streamSynthesize({
        apiKey: process.env.INWORLD_API_KEY!,
        text, voiceId: voice,
        onAudioChunk: (chunk) => controller.enqueue(chunk),
      });
      controller.close();
    },
  }), { headers: { "Content-Type": "audio/mpeg" } });
}
```

## Step 4 — Or scaffold the WebSocket client (Node)

`src/streaming-tts/ws-client.ts`:

```ts
import WebSocket from "ws";

export interface WsTtsOptions {
  apiKey: string;
  voiceId: string;
  modelId?: string;
  onAudioChunk?: (audio: Buffer) => void;
  onDone?: () => void;
  onError?: (err: unknown) => void;
}

export class StreamingTtsWs {
  private ws: WebSocket;
  constructor(private opts: WsTtsOptions) {
    this.ws = new WebSocket(
      "wss://api.inworld.ai/v1/tts/synthesize:websocket",
      { headers: { Authorization: `Basic ${opts.apiKey}` } }
    );
    this.ws.on("message", (raw) => this.handle(JSON.parse(raw.toString())));
    this.ws.on("error", (e) => opts.onError?.(e));
  }

  private handle(msg: any) {
    if (msg?.result?.audioContent) {
      this.opts.onAudioChunk?.(Buffer.from(msg.result.audioContent, "base64"));
    }
    if (msg?.result?.isFinal) this.opts.onDone?.();
  }

  /** Synthesize a chunk of text. Can be called multiple times in one session for streaming text input (e.g. piping LLM output token-by-token). */
  speak(text: string) {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      text,
      voiceId: this.opts.voiceId,
      modelId: this.opts.modelId ?? "inworld-tts-2",
      audioConfig: { audioEncoding: "MP3", sampleRateHertz: 48000 },
    }));
  }

  /** Cancel any in-flight synthesis (e.g. on user barge-in). */
  cancel() {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ cancel: {} }));
    }
  }

  close() { this.ws.close(); }
}
```

The WebSocket variant shines when you're piping an LLM stream into TTS in real time — feed each
sentence as it's produced, and the audio starts playing before the LLM finishes.

## Step 5 — Browser playback notes

For browser playback of streaming MP3, the simplest path is to set an `<audio>` element's `src`
to a backend route that proxies through `streamSynthesize` (as shown above). Browsers handle
the streaming MP3 naturally — audio starts playing as bytes arrive.

For PCM, you need to feed chunks into a `MediaSource` or `AudioWorklet`. More work; only worth
it if you need sub-100ms latency the MP3 path can't hit.

## Step 6 — Verify

Tell the user:
1. `export INWORLD_API_KEY=…` (or `.env`).
2. Pick a voice with `list_voices`.
3. Run the example with a short test phrase.
4. They should hear audio start within ~200ms (or ~120ms with `inworld-tts-1.5-mini`).

If audio is choppy: confirm chunks are being flushed to the player as they arrive (no buffering
all chunks first). If silence: check `Content-Type` of the response, confirm `audioContent`
field is present in each chunk.
