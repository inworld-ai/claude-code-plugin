---
name: latency
description: |
  Measure and reduce voice latency in the user's Inworld integration. Times
  streaming TTS from their machine (time to first audio, per model), then
  reviews their code for the usual causes of a slow voice agent: unary instead
  of streaming, waiting for the whole LLM reply, new connections per request,
  normalization, timestamps, and region. Use when the voice feels slow, when
  choosing between inworld-tts-2 and inworld-tts-2-flash, or before shipping a
  realtime voice feature.
argument-hint: "[optional: the line or flow that feels slow]"
allowed-tools: Read, Edit, Grep, Glob, Bash, mcp__plugin_inworld_voice-lab__measure_latency
---

# Latency

A voice agent feels slow when time-to-first-audio is high. Measure first, then
fix the biggest cause in the code.

## Step 1 — Measure from here

Call `measure_latency` with a line the app really says first (`text`) and the
app's voice. Set `compare_normalization: true` if the app could write numbers
out itself. Show the table. The numbers include the user's network round trip;
Inworld's server-side P90 is 20 ms (Flash) and 100 ms (TTS-2).

Model choice: `inworld-tts-2-flash` is fastest and cheapest but has no steering;
`inworld-tts-2` has steering and the best quality. If the app uses no
`[steering]` tags or instructions, Flash is usually the right call.

## Step 2 — Review the pipeline

Read the TTS and LLM call sites and check, in order of impact:

1. **Streaming.** Unary `/tts/v1/voice` waits for the whole clip. Use HTTP
   streaming (`/tts/v1/voice:stream`, NDJSON) or the WebSocket
   (`/tts/v1/voice:streamBidirectional`), and start playback on the first chunk.
2. **LLM → TTS hand-off.** Waiting for the full LLM reply before calling TTS
   adds the whole generation time. Stream the LLM and send text to TTS sentence
   by sentence (or use the WebSocket and `flush_context` at sentence ends).
3. **Connections.** A new TLS connection per request adds a round trip or more.
   Reuse one HTTP agent/session with keep-alive, or keep one WebSocket open per
   conversation.
4. **WebSocket handshake.** Send `create` and the first `send_text` together;
   don't wait for `contextCreated`.
5. **Timestamps.** If word timestamps are requested over WebSocket, set
   `timestampTransportStrategy: "ASYNC"`.
6. **Normalization.** `applyTextNormalization: "OFF"` saves a little per
   request, but only when the LLM writes numbers, dates and symbols in words.
   It also disables `<verbatim>` tags.
7. **Browser and mobile.** Proxying audio through the backend adds a hop. Mint a
   short-lived token server-side and stream to the client directly.
8. **Distance.** Run the backend near the API; EU (`api.eu.inworld.ai`) and
   India (`api.in.inworld.ai`) regions exist for Enterprise.

## Step 3 — Fix and re-measure

Make the highest-impact change, then add timing around the real call
(request start → first audio chunk) so the user sees the improvement in their
own app, not only in the tool. For full speech-to-speech agents, hand off to
`/inworld:add-realtime`.
