---
name: add-voice
description: |
  Add Inworld TTS-2 voice output to a specific feature in the user's codebase.
  Browses available voices, plays samples (including with steering applied),
  and wires the chosen voice into the right route, component, or function.
  Use when the user wants voice output in one specific place — not a full project setup.
argument-hint: "[where to add voice, e.g. 'chat responses' or 'error toasts']"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, Agent, mcp__inworld__list_voices, mcp__inworld__synthesize_speech
---

# Add Voice Skill

Wire Inworld TTS-2 into a specific feature. Assumes the user has run `/inworld:setup`
at least once (i.e. a client helper exists). If not, run `setup` first.

## Step 1 — Locate the target

From $ARGUMENTS, figure out *what* should speak. If unclear, ask the user one
focused question — don't guess.

Then grep for the feature (e.g. `chat`, `notification`, `toast`) and read the
file. Note the existing patterns: how do other side effects happen? Where would
audio plug in cleanly?

## Step 2 — Curate voices

Call `list_voices` (filter by language if relevant). Don't dump the full list —
pick 5–8 that suit the use case:

- Professional / business → clear, neutral voices
- Games / entertainment → expressive, character voices
- Accessibility → calm, well-articulated voices
- Children / education → warm, friendly voices

For each, show: voiceId, displayName, one-line description.

## Step 3 — Demo with steering

Generate two samples with `synthesize_speech` using `model_id=inworld-tts-2`:
1. The chosen voice speaking a feature-appropriate line *plain*.
2. The same voice with a bracketed steering instruction relevant to context.

Examples of steering that pay off:
- Chat agent → `[say warmly]`
- Error toast → `[say with concern]`
- Game victory → `[say with rising excitement]`
- Stealth hint → `[whisper]`
- Comedic beat → `[laugh] that was a close one!`

**Pause controls.** SSML `<break>` tags work inline for explicit pauses:
`Welcome. <break time="500ms"/> Let me help you with that.`

**Custom pronunciation.** For proper nouns and technical terms that get mispronounced,
inline IPA phoneme notation lets you spell it out:
`Visit <phoneme alphabet="ipa" ph="ˈnaɪkiː">Nike</phoneme>'s site.`
Use this sparingly — usually only needed for product names and acronyms.

Tell the user the file paths so they can play both. Ask which they want.

## Step 4 — Integrate

Edit the target file to call the helper from `lib/inworld.ts` (or equivalent).
Match existing patterns — async/await, error handling, logging style.

Common shapes:

- **REST endpoint**: Add a route that takes `{ text }`, returns `audio/mpeg`.
- **React component**: Add a button that fetches the route and plays via
  `new Audio(URL.createObjectURL(blob))`. If the page already has an audio
  player, hook into that instead.
- **Server-side trigger**: Call `synthesize`, save to a CDN/blob store, return
  the URL.
- **CLI / background job**: Save to a local file, log the path.

If the user picked a steering style in step 3, bake it into the helper call so
every utterance uses it.

## Step 5 — Verify

Offer to start the dev server (or run the script) and walk through the trigger
together. If they can't run it now, leave a one-line note in the response on
how to test manually.
