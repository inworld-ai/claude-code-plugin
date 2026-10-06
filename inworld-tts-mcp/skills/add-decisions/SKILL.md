---
name: add-decisions
description: |
  Replace fragile LLM judgment calls in the user's code (classify this, is this
  urgent, which team, does this break policy, how relevant is this) with
  Inworld's Decisions API, which returns probabilities instead of text: yes/no
  (noul), one of several options (choice), or a level on a scale (score). Use
  when code parses yes/no or a label out of an LLM reply, routes or gates on a
  model's opinion, or the user wants classification, routing, moderation-style
  checks or scoring with a confidence they can threshold.
argument-hint: "[the judgment to automate, or a file]"
allowed-tools: Read, Edit, Write, Glob, Grep, mcp__plugin_inworld_voice-lab__ask_decision
---

# Add decisions

The Decisions API (`POST https://api.inworld.ai/alpha/decisions`, preview,
model `typesafe/jev-latest`) answers named, typed questions about a `state` with
probabilities. The model judges; the user's code decides what to do with the
numbers. Only input tokens are billed. It's a preview: the path and shape may
change, so keep the call in one module.

## Step 1 — Find the judgment calls

Look for LLM calls whose output is parsed into a branch: "answer yes or no",
"respond with one of", JSON labels, regex on a model reply, sentiment or
intent prompts, `if "urgent" in reply`. Also look for hand-written keyword
classifiers that miss cases. Each is a candidate when the answer is bounded and
needs judgment rather than computation.

Leave alone anything that needs generated text, exact computation or a lookup.

## Step 2 — Pick the question type

| Need | Type | Returns |
|---|---|---|
| Does a condition hold? | `noul` | `noul`: probability of yes |
| Which one of a fixed set? | `choice` with `criteria: { option: "what it covers" }` | `choice`, `probabilities`, `confidence` |
| How much, on ordered levels? | `score` with ordered `criteria` | `score`, `probabilities`, `confidence` |

Several questions can go in one request; they're answered independently.

## Step 3 — Build the state and questions

- `state`: only what the questions need, in named fields (the message, the
  customer's plan, the policy text). Filter and fetch in code first.
- `instructions`: the judgment in one or two sentences, including what does and
  doesn't count.
- `criteria`: clear, non-overlapping descriptions for each option or level.

## Step 4 — Probe before writing code

Call `ask_decision` with real examples: clear cases, an ambiguous one, a
no-match one. Read the probabilities with the user and agree thresholds
(e.g. escalate when `is_urgent >= 0.8`, ask for clarification when choice
`confidence < 0.6`).

## Step 5 — Write it into the app

One module with the request, named threshold constants next to it, and the
branch in code:

```ts
const URGENT = 0.8;

export async function triage(message: string) {
  const res = await fetch("https://api.inworld.ai/alpha/decisions", {
    method: "POST",
    headers: { Authorization: `Basic ${process.env.INWORLD_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "typesafe/jev-latest",
      state: { message },
      questions: {
        is_urgent: { type: "noul", instructions: "Does the customer need help today?" },
        team: {
          type: "choice",
          instructions: "Which team should handle this?",
          criteria: { billing: "Payments, invoices, refunds", technical: "Bugs, outages, integrations", sales: "Pricing, upgrades" },
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`decisions ${res.status}`);
  const { answers } = await res.json();
  return { urgent: answers.is_urgent.noul >= URGENT, team: answers.team.choice, confidence: answers.team.confidence };
}
```

Keep a fallback for errors (the old path, or a safe default), and log the raw
probabilities so thresholds can be tuned later.
