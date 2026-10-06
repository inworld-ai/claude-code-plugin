---
name: add-llm
description: |
  Put the app's LLM calls on Inworld's LLM Router: one API key and one
  OpenAI- or Anthropic-compatible endpoint for 100+ models (OpenAI, Anthropic,
  Google, DeepSeek, Mistral, xAI and Inworld-hosted models), with fallbacks and
  provider routing. Moves existing OpenAI, Anthropic, OpenRouter, LiteLLM, Vercel
  AI SDK or LangChain calls by swapping the base URL and key and mapping model
  ids. Use when the user wants to add an LLM, switch or compare LLM providers,
  move off OpenRouter, add fallbacks, or cut LLM cost or latency.
argument-hint: "[provider or file to migrate, or what the LLM is for]"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, mcp__plugin_inworld_voice-lab__resolve_models, mcp__plugin_inworld_voice-lab__list_llm_models, mcp__plugin_inworld_voice-lab__benchmark_models, mcp__plugin_inworld_voice-lab__test_router, mcp__plugin_inworld_inworld__list_voices
---

# Add or move LLM calls to Inworld's router

The router speaks the OpenAI Chat Completions, OpenAI Responses and Anthropic
Messages formats, so most apps move with a base URL, a key and model ids, and
keep their SDK. Make the change behind config so it can be rolled back.

## Step 0 — Connection

Call `list_voices` with `{"language": "en"}`. If it reports a missing or invalid
key, run the Inworld `connect` skill first. The same key works for TTS, STT and
the router.

## Step 1 — Find the LLM calls

Grep for the client and where it's configured:

| Stack | Look for |
|---|---|
| OpenAI SDK | `new OpenAI(`, `OpenAI(`, `api.openai.com`, `OPENAI_API_KEY` |
| Anthropic SDK | `new Anthropic(`, `anthropic.Anthropic(`, `ANTHROPIC_API_KEY` |
| OpenRouter | `openrouter.ai/api/v1`, `OPENROUTER_API_KEY`, `@openrouter/sdk`, `HTTP-Referer`, `X-Title` |
| Vercel AI SDK | `createOpenAI(`, `@ai-sdk/openai`, `@ai-sdk/anthropic` |
| LangChain | `ChatOpenAI(`, `ChatAnthropic(` |
| LiteLLM / raw HTTP | `litellm.completion(`, `fetch(` to `/chat/completions` or `/v1/messages` |

List every model id in use and what each call does (chat, tools, JSON output,
streaming, vision, embeddings). Note anything the router doesn't serve:
`/v1/models`, embeddings, batches, files and image endpoints stay on their
current provider.

## Step 2 — Map the models

Call `resolve_models` with the ids from the code. Exact and same-model matches
can be used directly; confirm "closest" and "same family, newer" picks with the
user. If they're open to switching models, offer `/inworld:benchmark-models` on
the app's real prompt: it shows cost and latency side by side, including
Inworld-hosted models and the same model on different providers.

Use full `provider/model` ids. A bare model name (`deepseek-v4-flash`) also works
and lets the router choose the fastest provider.

## Step 3 — Swap the client

Read the key from `INWORLD_API_KEY` (server side only; the copied Base64 value,
not re-encoded) and keep the model in config, e.g. `LLM_MODEL`. Add an
`LLM_PROVIDER` switch if the user wants an easy rollback.

**OpenAI SDK** (also LiteLLM's `openai/` route and raw HTTP):

```ts
const client = new OpenAI({
  baseURL: "https://api.inworld.ai/v1",
  apiKey: process.env.INWORLD_API_KEY,
  defaultHeaders: { Authorization: `Basic ${process.env.INWORLD_API_KEY}` },
});
```

```python
client = OpenAI(
    base_url="https://api.inworld.ai/v1",
    api_key=os.environ["INWORLD_API_KEY"],
    default_headers={"Authorization": f"Basic {os.environ['INWORLD_API_KEY']}"},
)
```

**Anthropic SDK**: base URL without `/v1`; the key goes in the Basic header
(the router doesn't read `x-api-key`):

```ts
const client = new Anthropic({
  baseURL: "https://api.inworld.ai",
  apiKey: null,
  authToken: process.env.INWORLD_API_KEY,
  defaultHeaders: { Authorization: `Basic ${process.env.INWORLD_API_KEY}` },
});
```

```python
client = anthropic.Anthropic(
    base_url="https://api.inworld.ai",
    api_key=None,
    auth_token=os.environ["INWORLD_API_KEY"],
    default_headers={"Authorization": f"Basic {os.environ['INWORLD_API_KEY']}", "X-Api-Key": anthropic.omit},
)
```

The `model` can then be any router model, not only Claude.

**OpenRouter**: the request format carries over.
- Base URL `https://openrouter.ai/api/v1` → `https://api.inworld.ai/v1`; key
  `OPENROUTER_API_KEY` → `INWORLD_API_KEY` with the Basic header above.
- Model slugs → `resolve_models` (OpenRouter's `anthropic/claude-...` ids differ).
- `models: [...]` fallbacks and `provider: { order: [...] }` work as they are.
  `route: "fallback"` isn't needed. Drop `HTTP-Referer`, `X-Title`,
  `transforms` and `usage: { include: true }` (usage is always returned).
- Reasoning: use `reasoning_effort` (`none` … `xhigh`).
- `@openrouter/sdk` `callModel`: replace with the OpenAI SDK as above.

**Vercel AI SDK**: `createOpenAI({ baseURL: "https://api.inworld.ai/v1",
apiKey, headers: { Authorization: \`Basic ${apiKey}\` } })` and use its
chat-completions model (`provider.chat(model)`).

**LangChain**: `ChatOpenAI({ model, apiKey, configuration: { baseURL:
"https://api.inworld.ai/v1", defaultHeaders: { Authorization: \`Basic ${apiKey}\` } } })`.

## Step 4 — Make it resilient

Offer request-level options (no router config needed):

- **Fallbacks**: `models: ["fallback/model-a", "fallback/model-b"]`, tried in order
  when the primary fails.
- **Time-to-first-token fallback** for voice and chat UX:
  `fallback: { ttft_timeout: "800ms" }` (minimum `300ms`) moves on when the first
  token is slow.
- **Auto**: `model: "auto"` with `sort: ["price"]` or `["latency"]`, optionally
  limited with `models` / `ignore`.

In the OpenAI SDK these are extra body fields: pass them in the request object
in Node (cast if TypeScript complains), or via `extra_body={...}` in Python.
For A/B tests, per-tier routing or central prompt templates, use the
Inworld `configure-router` skill instead.

If the app turns LLM replies into speech, mention voice responses: add
`audio: { voice, model: "inworld-tts-2" }` to the chat completion and the
router returns the reply already spoken (one call, streamed).

## Step 5 — Verify

Run the app's own test or a one-off script through the new client. Call
`test_router` with the app's model (and `extra` for any fallbacks) to show which
model served the request and how long it took. Tell the user where the model id
lives in config, and that usage and cost appear in Inworld Portal.
