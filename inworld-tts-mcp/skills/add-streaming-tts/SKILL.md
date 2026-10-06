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
| WebSocket    | `wss://api.inworld.ai/tts/v1/voice:streamBidirectional` | Lowest latency, persistent connection, stream text in and cancel mid-utterance. |

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
- `model_id`: `inworld-tts-2` (default) for quality and steering (~100ms server-side TTFB), or
  `inworld-tts-2-flash` when latency or cost is the deciding factor (~20ms TTFB, same languages,
  no steering instructions — non-verbal tags like `[laugh]` still work)

Mention steering if not already known — TTS-2 supports `[whisper]`, `[say with rising excitement]`,
inline `[laugh]`, etc.

## Step 3 — Scaffold the chunked-HTTP client (Node)

`src/streaming-tts/client.ts`:

```ts
export interface StreamingTtsOptions {
  apiKey: string;
  text: string;
  voiceId: string;
  modelId?: "inworld-tts-2" | "inworld-tts-2-flash" | "inworld-tts-1.5-max" | "inworld-tts-1.5-mini";
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

The protocol is context-based: `create` a context with the voice and audio settings,
stream text into it with `send_text`, `flush_context` to force synthesis of what's
buffered, and `close_context` when the utterance is done (or on barge-in). Messages are
processed in order, so there's no need to wait for `contextCreated` before sending text.

```ts
import WebSocket from "ws";

export interface WsTtsOptions {
  apiKey: string;
  voiceId: string;
  modelId?: "inworld-tts-2" | "inworld-tts-2-flash";
  audioEncoding?: "MP3" | "LINEAR16" | "OGG_OPUS";
  sampleRateHertz?: number;
  onAudioChunk?: (audio: Buffer, contextId: string) => void;
  onContextClosed?: (contextId: string) => void;
  onError?: (err: unknown) => void;
}

export class StreamingTtsWs {
  private ws: WebSocket;
  private ready: Promise<void>;
  private seq = 0;

  constructor(private opts: WsTtsOptions) {
    this.ws = new WebSocket("wss://api.inworld.ai/tts/v1/voice:streamBidirectional", {
      headers: { Authorization: `Basic ${opts.apiKey}` },
    });
    this.ready = new Promise((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
    this.ws.on("message", (raw) => this.handle(JSON.parse(raw.toString())));
    this.ws.on("error", (e) => opts.onError?.(e));
  }

  private handle(msg: any) {
    if (msg?.error) return this.opts.onError?.(msg.error);
    const r = msg?.result;
    if (!r) return;
    const ctx = r.contextId ?? msg.contextId;
    const b64 = r.audioChunk?.audioContent ?? r.audioContent;
    if (b64) this.opts.onAudioChunk?.(Buffer.from(b64, "base64"), ctx);
    if (r.contextClosed) this.opts.onContextClosed?.(ctx);
  }

  private async send(msg: object) {
    await this.ready;
    this.ws.send(JSON.stringify(msg));
  }

  /** Open a new utterance context. Returns its id. */
  async open(): Promise<string> {
    const contextId = `ctx-${++this.seq}`;
    await this.send({
      context_id: contextId,
      create: {
        voice_id: this.opts.voiceId,
        model_id: this.opts.modelId ?? "inworld-tts-2",
        audio_config: {
          audio_encoding: this.opts.audioEncoding ?? "MP3",
          sample_rate_hertz: this.opts.sampleRateHertz ?? 48000,
        },
      },
    });
    return contextId;
  }

  /** Append text (up to 2,000 chars per message) — e.g. each sentence of an LLM stream. */
  speak(contextId: string, text: string, flush = false) {
    return this.send({
      context_id: contextId,
      send_text: flush ? { text, flush_context: {} } : { text },
    });
  }

  /** Synthesize whatever is buffered now. */
  flush(contextId: string) {
    return this.send({ context_id: contextId, flush_context: {} });
  }

  /** Finish the utterance, or stop it early on barge-in, then open() a new one. */
  closeContext(contextId: string) {
    return this.send({ context_id: contextId, close_context: {} });
  }

  close() { this.ws.close(); }
}
```

Text accumulates server-side until a flush, until `buffer_char_threshold` (1,000
characters by default) is reached, or until `max_buffer_delay_ms` elapses — so flush at
sentence boundaries when piping an LLM stream. Browsers can't set the `Authorization`
header: mint a one-time token on the backend and pass it as the `bearer_<token>`
WebSocket subprotocol (`search_docs` "one-time tokens"). Official reference
implementations: `inworld-ai/inworld-api-examples` → `tts/js/example_websocket.js` and
`tts/python/example_websocket.py`.

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
4. They should hear audio start within ~200ms including network (faster with `inworld-tts-2-flash`).

If audio is choppy: confirm chunks are being flushed to the player as they arrive (no buffering
all chunks first). If silence: check `Content-Type` of the response, confirm `audioContent`
field is present in each chunk.
