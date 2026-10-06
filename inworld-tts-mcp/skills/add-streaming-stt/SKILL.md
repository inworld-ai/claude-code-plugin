---
name: add-streaming-stt
description: |
  Wire Inworld's streaming Speech-to-Text WebSocket API into the user's project.
  Scaffolds a working client that streams microphone audio (or any PCM source)
  and receives interim + final transcripts in real time. Use for live captions,
  dictation, voice notes, meeting transcription, voice commands — any feature
  that needs live mic → text without the full LLM+TTS Realtime loop.
argument-hint: "[browser|server]"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, Agent
---

# Add Streaming STT Skill

Inworld's streaming STT is a WebSocket at
`wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional`. Client sends a
config message + base64-encoded PCM16 chunks; server sends back transcript
results with `isFinal: true|false`. Lower-latency than batch STT, and unlike
the full Realtime API it does *not* require an LLM — just audio in, text out.

The plugin's MCP server only exposes batch STT (`transcribe_audio`) — streaming
audio cannot live inside the agent's MCP process. This skill writes a streaming
client into the user's app.

## Step 1 — Pick the transport

From $ARGUMENTS or by asking:

| Transport | When | Audio capture |
|---|---|---|
| `browser` | Web app — live captions, dictation, in-browser voice notes | Web Audio API + MediaRecorder/AudioWorklet |
| `server`  | Node/Python backend, desktop CLI, Twilio, Discord bot | SoX, `node-record-lpcm16`, or any PCM source |

**Auth note:** Browser clients must NOT ship the raw Inworld API key. Your
backend mints a single-use **one-time token** per connection (Step 4) and the
browser passes it in the `bearer_` WebSocket subprotocol. For `server`
transport, use the Basic API key directly.

## Step 2 — Pick a model

Use `inworld/inworld-stt-1`, Inworld's own STT model: 30 languages, optional
Voice Profile (age, emotion, pitch, vocal style, accent), and configurable
turn-taking. The streaming endpoint accepts LINEAR16 PCM only. If the user knows
the spoken language, pass it as `language` — a hint improves accuracy,
especially on short utterances.

**Optional features**: ask which the feature needs, then add them to the
`transcribeConfig` in the first WebSocket message:

| Feature | Config | Notes |
|---|---|---|
| Speaker diarization | `enableSpeakerDiarization: true`, `includeWordTimestamps: true` | Each entry in `result.transcription.wordTimestamps` gets a `speaker` number (scoped to this stream). Use for meetings and calls. |
| Custom vocabulary | `prompts: ["Inworld", "TTS-2", ...]` | Names, product terms, jargon. A soft bias, not a keyword lock. |
| Voice Profile | `voiceProfileConfig: { enableVoiceProfile: true }` | Age, emotion, pitch, vocal style, accent labels with confidences. |
| Tuned turn detection | `endOfTurnConfidenceThreshold` (default 0.4) and `inworldSttV1Config: { minEndOfTurnSilenceWhenConfident, maxTurnSilence }` (ms, 20–5000) | Raise the threshold or silences for slow speakers or noisy rooms. Keep the min silence ≤ the max. |
| Manual turns (push-to-talk) | `inworldSttV1Config: { vadThreshold: 0 }` | Server stops splitting turns. Send `endTurn` at each boundary; a turn is capped at ~30 s. |

The stream also emits `speechStarted` / `speechStopped` events, which are useful
for barge-in, "listening…" indicators, or custom turn logic. For recordings rather
than live audio, use `/inworld:add-transcription`.

## Step 3 — Scaffold the Node / server client

`src/streaming-stt/client.ts`:

```ts
import WebSocket from "ws";

export interface StreamingSttOptions {
  apiKey: string;                  // Basic-auth API key (server-side only)
  modelId?: string;                // default: "inworld/inworld-stt-1"
  language?: string;               // e.g. "en-US"; omit for auto-detect
  sampleRateHertz?: number;        // default: 16000
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (err: unknown) => void;
}

export class InworldStreamingStt {
  private ws: WebSocket;
  private closed = false;

  constructor(private opts: StreamingSttOptions) {
    this.ws = new WebSocket(
      "wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional",
      { headers: { Authorization: `Basic ${opts.apiKey}` } }
    );

    this.ws.on("open", () => this.configure());
    this.ws.on("message", (raw) => this.handleEvent(JSON.parse(raw.toString())));
    this.ws.on("error", (e) => opts.onError?.(e));
  }

  private configure() {
    const cfg: Record<string, unknown> = {
      modelId: this.opts.modelId ?? "inworld/inworld-stt-1",
      audioEncoding: "LINEAR16",
      sampleRateHertz: this.opts.sampleRateHertz ?? 16000,
      numberOfChannels: 1,
    };
    if (this.opts.language) cfg.language = this.opts.language;
    this.ws.send(JSON.stringify({ transcribeConfig: cfg }));
  }

  private handleEvent(msg: any) {
    const t = msg?.result?.transcription;
    if (!t) return;
    const text = t.transcript ?? "";
    if (!text) return;
    if (t.isFinal) this.opts.onFinal?.(text);
    else this.opts.onInterim?.(text);
  }

  /** Send a PCM16 mono 16 kHz chunk. ~100 ms chunks recommended (3200 bytes). */
  sendAudio(pcm16: Buffer) {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ audioChunk: { content: pcm16.toString("base64") } }));
  }

  /** Signal end-of-speech; server flushes remaining finals then closes. */
  endTurn() {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ endTurn: {} }));
    this.ws.send(JSON.stringify({ closeStream: {} }));
  }

  close() {
    this.closed = true;
    try { this.ws.close(); } catch {}
  }
}
```

For mic capture, the canonical Inworld example uses SoX (`brew install sox` on
macOS, `apt install sox` on Linux). If the user wants a pure-Node solution,
suggest `node-record-lpcm16` or `mic` instead — both produce a raw PCM stream
that pipes into `client.sendAudio()`.

Example glue:

```ts
import { spawn } from "node:child_process";
import { InworldStreamingStt } from "./client";

const stt = new InworldStreamingStt({
  apiKey: process.env.INWORLD_API_KEY!,
  language: "en-US",
  onInterim: (t) => process.stdout.write(`\r[interim] ${t}    `),
  onFinal:   (t) => console.log(`\n[final]   ${t}`),
});

const sox = spawn("sox", [
  "-q", "-t", "coreaudio", "-d",        // -t alsa on Linux, waveaudio on Windows
  "-r", "16000", "-c", "1",
  "-e", "signed-integer", "-b", "16",
  "-t", "raw", "-",
]);

const CHUNK_BYTES = 3200; // 100 ms @ 16 kHz mono PCM16
let buf = Buffer.alloc(0);
sox.stdout.on("data", (data) => {
  buf = Buffer.concat([buf, data]);
  while (buf.length >= CHUNK_BYTES) {
    stt.sendAudio(buf.subarray(0, CHUNK_BYTES));
    buf = buf.subarray(CHUNK_BYTES);
  }
});

process.on("SIGINT", () => { sox.kill("SIGTERM"); stt.endTurn(); });
```

## Step 4 — Scaffold the browser client

Two pieces: a backend endpoint that mints a one-time token, and a browser module.

`src/server/inworld-token.ts` — mount at `POST /api/inworld-token`. `user` must
come from your existing auth middleware; apply your app's CSRF protection and a
per-user rate limit before calling it:

```ts
// Mints a single-use, short-lived token so the browser never sees the API key.
// Docs: https://docs.inworld.ai/portal/ephemeral-tokens
// Your route sends back { status, headers, body } as-is.
const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function issueInworldToken(user: { id: string } | null) {
  if (!user) return { status: 401 as const, headers: NO_STORE };
  const apiKey = process.env.INWORLD_API_KEY;
  if (!apiKey) throw new Error("INWORLD_API_KEY is not set");
  const upstream = await fetch("https://api.inworld.ai/auth/v1/tokens", {
    method: "POST",
    headers: { Authorization: `Basic ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ single_use: true, ttl: "300s", client_reference_id: user.id }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!upstream.ok) {
    return { status: upstream.status === 429 ? (429 as const) : (502 as const), headers: NO_STORE };
  }
  const { accessToken, expireTime } = await upstream.json();
  // The token is a bearer credential: no-store keeps it out of caches. Never log it.
  return { status: 200 as const, headers: NO_STORE, body: { accessToken, expireTime } };
}
```

Each token authenticates exactly one connection. Mint a fresh one for every
connect, retry, and reconnect. Minting is rate-limited to 60 per minute per API key.

`src/streaming-stt/browser-client.ts`:

```ts
export interface BrowserSttOptions {
  tokenEndpoint: string;           // your backend route that returns { accessToken }
  modelId?: string;
  language?: string;
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (err: Error) => void;               // handshake rejected or connection failed
  onClose?: (code: number, reason: string) => void;
}

export async function startStreamingStt(opts: BrowserSttOptions) {
  const tokenRes = await fetch(opts.tokenEndpoint, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!tokenRes.ok) throw new Error(`Token request failed (${tokenRes.status})`);
  const { accessToken } = await tokenRes.json();

  // Browsers can't set an Authorization header on a WebSocket, so the one-time
  // token goes in the `bearer_` subprotocol. Never put it in the URL.
  const ws = new WebSocket(
    "wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional",
    ["bearer_" + accessToken],
  );
  // A rejected handshake never yields a transcript, so report failures to the caller.
  ws.onerror = () => opts.onError?.(new Error("Inworld STT connection failed"));
  ws.onclose = (e) => opts.onClose?.(e.code, e.reason);

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext({ sampleRate: 16000 });
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([`
    class PCMWorklet extends AudioWorkletProcessor {
      process(inputs) {
        const ch = inputs[0]?.[0];
        if (ch) {
          const pcm = new Int16Array(ch.length);
          for (let i = 0; i < ch.length; i++) {
            const s = Math.max(-1, Math.min(1, ch[i]));
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          this.port.postMessage(pcm.buffer, [pcm.buffer]);
        }
        return true;
      }
    }
    registerProcessor('pcm-worklet', PCMWorklet);
  `], { type: "text/javascript" })));

  const source = ctx.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(ctx, "pcm-worklet");
  source.connect(worklet);

  ws.onopen = () => {
    const cfg: Record<string, unknown> = {
      modelId: opts.modelId ?? "inworld/inworld-stt-1",
      audioEncoding: "LINEAR16",
      sampleRateHertz: 16000,
      numberOfChannels: 1,
    };
    if (opts.language) cfg.language = opts.language;
    ws.send(JSON.stringify({ transcribeConfig: cfg }));
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    const t = msg?.result?.transcription;
    if (!t?.transcript) return;
    if (t.isFinal) opts.onFinal?.(t.transcript);
    else opts.onInterim?.(t.transcript);
  };

  worklet.port.onmessage = (e) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const bytes = new Uint8Array(e.data);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const b64 = btoa(bin);
    ws.send(JSON.stringify({ audioChunk: { content: b64 } }));
  };

  return {
    stop() {
      try { ws.send(JSON.stringify({ endTurn: {} })); } catch {}
      try { ws.send(JSON.stringify({ closeStream: {} })); } catch {}
      worklet.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
      setTimeout(() => ws.close(), 500);
    },
  };
}
```

**Alternative:** if the app already relays audio through its own backend
WebSocket, the backend can connect to Inworld with the Basic API key instead and
skip the token endpoint. A failed handshake never produces a transcript, so
surface `ws.onerror` / `ws.onclose` to the caller instead of waiting forever.

## Step 5 — Hook into the UI

For dictation / live captions, two UI elements are usually enough:

- A "Start / Stop listening" button
- A transcript area that shows interim text in a muted style, then commits each
  final to a paragraph

Wire `onInterim` to update a "current line" element; wire `onFinal` to append
to the transcript and clear the current line.

## Step 6 — Verify

Tell the user:
1. Set `INWORLD_API_KEY` in env (server) or have the token endpoint reachable (browser).
2. Grant mic permission.
3. Speak — they should see `[interim]` text update in real time, then a `[final]`
   commit when they pause.

If nothing comes back:
- Check the WS connection actually opened (status code, browser console).
- Confirm audio chunks are being sent (log chunk size). 0 bytes = mic permission denied or audio context suspended.
- Verify sample rate is 16 kHz mono PCM16 — every other format will be rejected.
- Auth failures in the browser: confirm the token endpoint returned 200 and that
  each connection uses a freshly minted token (a used token is rejected).
