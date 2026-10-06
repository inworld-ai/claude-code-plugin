---
name: configure-router
description: |
  Design, save and test an Inworld LLM Router config: fallbacks across models
  and providers, A/B tests with weighted variants, routing by user tier or
  request content (CEL conditions), auto model selection by price or latency,
  shared prompt templates, prompt compression and caching. The app then calls
  one model id, inworld/<router>, and routing changes without a deploy. Use when
  the user wants fallbacks, an A/B test between models, different models per
  customer tier, central control of models and prompts, or to cut LLM cost.
argument-hint: "[what the routing should do]"
allowed-tools: Read, Edit, Grep, Glob, mcp__plugin_inworld_voice-lab__get_router, mcp__plugin_inworld_voice-lab__save_router, mcp__plugin_inworld_voice-lab__test_router, mcp__plugin_inworld_voice-lab__list_llm_models, mcp__plugin_inworld_voice-lab__resolve_models, mcp__plugin_inworld_voice-lab__benchmark_models
---

# Configure an Inworld router

A router is a named config the app calls as `model: "inworld/<name>"`. Changing
the router changes routing for every request, with no code deploy.

If the app's LLM calls don't go through Inworld yet, run the Inworld `add-llm`
skill first.

## Request-level or a router?

Fallbacks, `auto` with a sort, and provider order also work per request (see
`add-llm`). Use a router when the user wants an A/B split, routing by tier or
content, prompts or generation settings managed centrally, or to change models
without redeploying.

## Step 1 — Design it with the user

How it works: conditional `routes` are checked in order and the first CEL
condition that matches wins, otherwise `defaultRoute` is used. Inside the chosen
route, one variant is picked by `weight` (weights must sum to exactly 100). The
variant sets the model.

Pick the patterns that match the goal (use `list_llm_models` or
`resolve_models` for ids, `benchmark_models` to choose between candidates):

| Goal | Variant / route shape |
|---|---|
| Fallbacks | `model_id: "inworld/models/GLM-5.3-Flash"`, `model_selection: { models: ["google-ai-studio/gemini-2.5-flash-lite"] }` (order listed, or add `sort`) |
| Best provider for one model | bare `model_id: "deepseek-v4-flash"`; optional `model_selection.provider: { order: ["inworld", "deepseek"], allow_fallbacks: true }` |
| Auto pick | `model_id: "auto"`, `model_selection: { models: [...] or ["openai"], ignore: [...], sort: [{ metric: "SORT_METRIC_LATENCY" }, { metric: "SORT_METRIC_PRICE" }] }` (also THROUGHPUT, INTELLIGENCE, MATH, CODING) |
| A/B test | two variants in one route, `weight: 50` each; send `user` on requests so each user always gets the same variant |
| Per tier / region | conditional route with `condition: { cel_expression: "tier == \"premium\"" }`; more specific conditions first |
| By content | CEL on messages, e.g. `messages.last().content.matches("(?i).*(refund|chargeback).*")` |
| One system prompt for all callers | variant `message_templates` (supports `{{variable}}` prompt variables) |
| Generation settings | variant `text_generation_config` (`temperature`, `max_tokens`, `reasoning: { effort: "none" }`, …); it replaces router-level defaults entirely, it doesn't merge |
| Cheaper long prompts | variant `compression: { aggressiveness: 0.7 }`; skip it for JSON, XML or code the model must read exactly |

Caching: providers' implicit prompt caching works automatically, and the router
keeps a conversation on the same provider so cache hits continue. For Anthropic
and Google, mark large static context with `cache_control: { type: "ephemeral",
ttl: "1h" }` on that message part.

Write the full JSON and show it to the user. Run `save_router` with
`dry_run: true` to validate (weights, ids, conditions) before saving.

## Step 2 — Save it

After the user agrees, call `save_router` (it creates the router or updates it
if the name exists; check the current config first with `get_router` when
updating). If it reports the key can't write routers, relay the fix it gives and
offer the JSON for Portal instead.

## Step 3 — Point the app at it

Set the app's model to `inworld/<name>` (in config). For conditional routes the
app must send the metadata the CEL reads, as a literal `extra_body` field in the
JSON body:

```ts
await client.chat.completions.create({
  model: "inworld/support-voice",
  messages,
  user: userId,                                      // sticky A/B variant
  // @ts-expect-error router-specific field
  extra_body: { metadata: { tier: user.tier, region } },
});
```

```python
client.chat.completions.create(
    model="inworld/support-voice",
    messages=messages,
    user=user_id,
    # The OpenAI SDK merges extra_body into the request, so nest the router's
    # own extra_body inside it.
    extra_body={"extra_body": {"metadata": {"tier": user.tier, "region": region}}},
)
```

Metadata is typed: send numbers as numbers if the CEL compares numbers.

## Step 4 — Test it

Call `test_router` with the router name:
- several `runs` to see an A/B split (more runs → closer to the weights),
- `metadata` matching each condition to see each route, and one without to hit
  the default,
- `user` to confirm the same user keeps the same variant.

Report which model served each case. For measuring an A/B test's impact on
product metrics, point the user to the router's BigQuery and Mixpanel exports
(docs.inworld.ai/router/data-integrations/overview).
