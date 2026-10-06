---
name: benchmark-models
description: |
  Compare LLMs for the user's voice app through Inworld's router (100+ models,
  one key, OpenAI-compatible): time to first token, to the first spoken audio
  through Inworld TTS, cost per 1,000 replies, and how each reply sounds in the
  app's voice. Includes the same model on different providers. Use when the
  user is choosing or switching the LLM behind a voice agent, asks which model
  is fastest or cheapest, or wants to benchmark models.
argument-hint: "[models to compare, or what matters: speed, cost, quality]"
allowed-tools: Read, Edit, Grep, Glob, mcp__plugin_inworld_voice-lab__list_llm_models, mcp__plugin_inworld_voice-lab__benchmark_models
---

# Benchmark models

Leaderboards don't answer "which model should my voice agent use". The answer
depends on the app's own system prompt, the turns users actually say, and how
fast the reply starts *speaking*. Measure that, on their prompt, from their
machine.

## Step 1 — Get a realistic test

From the codebase, pull:

- **The system prompt** the app sends (grep for `system`, `messages`,
  `chat.completions`). Pass it as `system`; long prompts change latency.
- **A real user turn**: from tests, fixtures, logs or the product brief. Ask for
  one only if there's nothing to go on.
- **The current model and voice**, so the current setup is one of the rows.

## Step 2 — Pick candidates

Call `list_llm_models` (filter by `query`, `needs_tools: true` if the agent
calls tools). Choose 3–6 rows that make a real comparison:

- the app's current model
- Inworld-hosted models (`inworld/...`, filter with `inworld_hosted_only`):
  they run on Inworld's own realtime inference stack. GLM 5.3 Flash,
  Gemma 4 and DeepSeek V4 Flash 0731 (the cheapest) are the usual picks for voice
- 1–2 other fast, cheap models (Flash / Lite / Luna / small open models)
- the same open model on two providers (e.g. `groq/...` vs `deepinfra/...`):
  the router makes this a one-line change and the gap is often large
- `auto`, if they're open to letting the router choose

Always use full `provider/model` ids from the list. Skip models marked
retiring, and don't recommend moving an app onto one; if the app's *current*
model is retiring, say so and when.

## Step 3 — Run it

Call `benchmark_models` with `system`, `prompt`, `models`, the app's `voice`,
and `tts_model` (`inworld-tts-2-flash` unless they rely on steering). Defaults:
3 runs, lowest reasoning effort, since hidden reasoning adds latency to a
spoken reply.

Present the table, then say what it means:

- **First audio** is the number users feel: time from request to the voice
  starting. Under ~500 ms feels conversational; over ~1 s feels slow.
- Cost per 1,000 replies, at this prompt length.
- Anything the notes flag: reasoning tokens, empty replies, errors.

Then the replies: point out anything wrong (made-up facts, appointment times
or prices the prompt never gave, markdown, rambling). The user listens with
the play buttons; ask which sounds best.

## Step 4 — Switch

Changing models on the router is one string: the `model` in the app's
`/v1/chat/completions` call. Put it in config. If they're coming from another
provider's SDK, point the OpenAI client's base URL at `https://api.inworld.ai/v1`
with the Inworld key (see `/inworld:migrate`). Suggest re-running the benchmark
after prompt changes, since prompts move both latency and quality.
