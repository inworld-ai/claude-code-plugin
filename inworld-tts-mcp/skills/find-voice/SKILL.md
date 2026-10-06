---
name: find-voice
description: |
  Find the right Inworld voice from a description and let the user hear it in
  their own words before any code changes. Searches the voice library, auditions
  the best matches, designs a new voice when nothing fits, and saves the pick.
  Use when the user describes the voice they want ("a calm older British
  narrator", "upbeat support agent"), asks which voice to use, or wants to hear
  or compare voices.
argument-hint: "[what the voice should sound like]"
allowed-tools: Read, Edit, Grep, Glob, mcp__plugin_inworld_voice-lab__find_voices, mcp__plugin_inworld_voice-lab__compare_voices, mcp__plugin_inworld_voice-lab__design_voice, mcp__plugin_inworld_voice-lab__publish_voice
---

# Find a voice

Picking a voice is a listening decision. Get the user to hear real candidates
saying a real line from their app within the first minute, then narrow down.

## Step 1 — Get the brief

From $ARGUMENTS and the conversation, work out:

- **Who is speaking and to whom**: support agent, game character, narrator,
  tutor, companion. Check the codebase for a persona or system prompt.
- **How it should sound**: gender, age, accent, pace, tone, timbre.
- **Language and locale**: en-US, en-GB, es-MX... The accent is part of the locale.
- **A line to audition**: take one from their code (a greeting, a prompt
  template, an error message). A line the voice will actually say is worth more
  than any description.

Ask one question only if you can't infer the use case. Don't interrogate.

## Step 2 — Search and listen

Call `find_voices`:

- Put fixed attributes in the filters: `gender`, `age_group`, `language`,
  `categories` (companions, enterprise, education_training,
  developer_assistants, healthcare, interactive_media).
- Put everything else in `query` in the user's words (warm, raspy, upbeat,
  narrator, Australian).
- Pass `audition_line` so the top four render straight away.

Show the matches as a short list (voiceId, one-line description). In Claude
Code, play buttons appear under the result; elsewhere follow the tool's
instructions for playing the files. Ask which is closest and what's off
("warmer", "slower", "less formal").

## Step 3 — Narrow down

- Close but not right → run `find_voices` again with the feedback folded into
  `query`, or `compare_voices` with specific IDs.
- Tone right, delivery wrong → it may be steering, not the voice. Try
  `compare_voices` with the same voice and a steered line, e.g.
  `[say warmly and a little slower] ...` (inworld-tts-2 only).
- Want to compare against something that doesn't exist yet → `compare_voices`
  with `designs: ["<description>"]` renders a one-off designed voice next to the
  library voices.

## Step 4 — Design one if nothing fits

Call `design_voice` with a specific description (gender and age, accent, pitch
and pace, tone, timbre) and a `script` written in the character's voice, since
the script shapes the voice. Use `language` for accent (en-GB, en-AU). It
returns up to three previews. Once the user picks one, call `publish_voice`
with a display name and a few style tags.

If design says the key can't save voices, the previews were rendered
listen-only. Relay the permission fix from the tool result exactly.

## Step 5 — Wire it in

Put the chosen voiceId in config (env var or constants module) rather than
scattering it through the code, and note the model (`inworld-tts-2` for
steering, `inworld-tts-2-flash` for the lowest latency). If the project isn't
set up for Inworld yet, hand off to `/inworld:setup`.
