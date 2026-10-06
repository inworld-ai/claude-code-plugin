---
name: speakable-text
description: |
  Make text sound right when Inworld TTS speaks it: spell out booking
  references, order numbers and other alphanumeric IDs with <verbatim> tags,
  strip markdown from LLM replies, fix pronunciation with inline IPA, add pauses,
  and use steering tags correctly. Also updates the app's LLM prompt so its
  output is speakable at the source. Use when TTS mispronounces something, reads
  symbols or IDs wrongly, or before shipping a voice feature.
argument-hint: "[file, prompt, or text that will be spoken]"
allowed-tools: Read, Edit, Grep, Glob, mcp__plugin_inworld_voice-lab__check_speech_text, mcp__plugin_inworld_voice-lab__compare_voices
---

# Speakable text

Most "the voice sounds wrong" bugs are text bugs: an LLM reply with
`**bold**`, a confirmation code read as a word, a `[whisper]` that never ends.
Fix them where the text is produced, and let the user hear the difference.

## Step 1 — Find what gets spoken

Grep for the TTS call sites (`tts/v1/voice`, `synthesize`, `voiceId`) and trace
the `text` argument back to its source:

- **LLM output**: the system prompt is the place to fix.
- **Templates**: confirmation messages, IVR prompts, notifications. Look for
  interpolated IDs (`${bookingRef}`, `{order_id}`, phone numbers, plates).
- **Static copy**: greetings, errors.

## Step 2 — Check it

Call `check_speech_text` on each template or a sample reply, with the
`model_id` and `text_normalization` setting the app uses. Pass `listen_voice`
(the app's voice) so the user hears the original (A) and the fixed version (B).
It works without an API key, except for listening.

## Step 3 — Fix at the source

Apply what the checker found, in the code:

| Problem | Fix |
|---|---|
| IDs, codes, plates, serials read as words or big numbers | Wrap the interpolated value: `` `Your reference is <verbatim>${ref}</verbatim>.` `` Needs text normalization on or unset; most reliable on inworld-tts-2 |
| Markdown, emoji, lists in LLM replies | Tell the LLM to answer in plain spoken sentences, and strip formatting before TTS as a backstop |
| A word mispronounced (brand, place, name) | Replace that one word with English IPA in slashes: `/kriːt/`. One word per pair of slashes. SSML `<phoneme>` is not supported |
| Needs a pause | `<break time="500ms" />`; at most 20 per request, 10 s each |
| Delivery (whisper, excited, sad) | `[say excitedly]` before the text, `[reset]` where it should stop. inworld-tts-2 only; Flash ignores instructions but keeps non-verbals like `[laugh]` |
| Ambiguous dates (`05/06/2025`) | Write them as spoken: "June fifth" |
| Lowest latency needed | `applyTextNormalization: "OFF"` and have the LLM write numbers and symbols out in words. Verbatim tags are dropped when normalization is off |

For LLM-generated speech, add rules like these to the system prompt (adapt to
the persona):

```
You are speaking out loud. Reply in plain spoken sentences: no markdown,
lists, emoji or URLs. Wrap any code, reference number, ID, plate or serial
in <verbatim></verbatim> so it is read character by character.
Write dates, times and amounts the way you would say them.
```

## Step 4 — Confirm by ear

Re-run `check_speech_text` with `listen_voice` on the fixed template and ask the
user whether B sounds right. For a pronunciation fix, use `compare_voices` with
two spellings of the line in the same voice.
