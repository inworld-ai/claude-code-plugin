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
audio cannot live inside Claude's MCP process. This skill writes a streaming
client into the user's app.

## Step 1 — Pick the transport

From $ARGUMENTS or by asking:

| Transport | When | Audio capture |
|---|---|---|
| `browser` | Web app — live captions, dictation, in-browser voice notes | Web Audio API + MediaRecorder/AudioWorklet |
| `server`  | Node/Python backend, desktop CLI, Twilio, Discord bot | SoX, `node-record-lpcm16`, or any PCM source |

**Auth note:** Browser clients must NOT ship the raw Inworld API key. Mint a
short-lived bearer token on your backend (see [add-realtime](../add-realtime/SKILL.md)
Step 3 for the token-mint pattern — same flow applies here). For `server`
transport, use the Basic API key directly.

## Step 2 — Pick a model

Ask the user, or default to `inworld/inworld-stt-1`. The streaming endpoint
supports these models (LINEAR16 PCM only):

| Model | Best for |
|---|---|
| `inworld/inworld-stt-1` | Default. Multi-language, in-house. |
| `assemblyai/universal-streaming-multilingual` | 100+ languages, AssemblyAI's flagship. |
| `assemblyai/universal-streaming-english` | English-only, lower latency. |
| `assemblyai/u3-rt-pro` | AssemblyAI realtime-pro. |
| `assemblyai/whisper-rt` | Whisper-quality, realtime latency. |
| `soniox/stt-rt-v4` | Soniox v4. |

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

Two pieces: a backend token-mint endpoint (reuse the pattern from the
`add-realtime` skill, Step 3) and a browser module.

`src/streaming-stt/browser-client.ts`:

```ts
export interface BrowserSttOptions {
  tokenEndpoint: string;           // your backend route that returns { token }
  modelId?: string;
  language?: string;
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
}

export async function startStreamingStt(opts: BrowserSttOptions) {
  const { token } = await fetch(opts.tokenEndpoint, { method: "POST" }).then((r) => r.json());

  const ws = new WebSocket(
    `wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional`,
    // Browser WebSocket can't set Authorization header directly — see note below.
  );
  // See workaround note below for browser auth.

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

**Browser auth note:** the browser WebSocket API does not support custom headers.
Two options, depending on the user's backend:

1. **Proxy through your backend.** Open the WS connection to your own server,
   which proxies to Inworld with the Basic API key. Simpler, but adds a hop.
2. **Mint a bearer token your server signs**, then pass it via the
   `Sec-WebSocket-Protocol` subprotocol header (the browser allows that as the
   second WebSocket constructor argument). Confirm with Inworld whether the STT
   streaming endpoint accepts subprotocol-based auth — the Realtime endpoint
   does; STT may require the proxy approach.

Default to the proxy when unsure. Mention this tradeoff to the user.

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
- For AssemblyAI models, some users have reported intermittent failures; if so,
  fall back to `inworld/inworld-stt-1`.
