# On-device test plan: the developer's first hour

What a developer does in the first hour after installing the plugin, run on a real
machine in both hosts. The bar is commercial, not just functional: every journey should
end with working audio or a clear, tracked path to signup, never a dead end.

`TESTING.md` covers per-tool verification. This file covers journeys.

## What "pass" means

- **Time to first audio (TTFA):** a new user hears Inworld audio in under 5 minutes
  from install, signup included.
- **Signup link shown:** whenever there's no key, the reply contains the full tracked
  link with the right host (`utm_source=claude-code` or `codex`,
  `utm_medium=agent-plugin`). `utm_content` names the surface: `install-prompt`,
  `connect-skill`, `tool-error`, `readme`.
- **No substitutes:** without a key, the agent never answers with another speech
  engine (macOS `say`, espeak, another vendor).
- **Generated code runs:** the app's own code path works (`npm start` or equivalent),
  not just the agent's MCP call.
- **Current guidance:** no deprecated models (1.5, 1.0), dead endpoints, or model IDs
  that 400.
- **Safe:** the key is never printed, committed, or shipped to a browser.

## Setup

### Hosts

| Host | How to run | Automatable |
|---|---|---|
| Claude Code CLI | `claude --plugin-dir <plugin>` (dev) or marketplace install | Headless via `claude -p` in a real terminal (the desktop app's Bash sandbox can't refresh OAuth) |
| Claude desktop app (Code tab) | Plugin browser | Human |
| Codex CLI | `/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex` (the path moved in 0.158) | Headless via `codex exec --json` with a temp `CODEX_HOME` |
| Codex app | Plugins page | Human |

To simulate a fresh machine: for Codex, a temp `CODEX_HOME` with `auth.json`
symlinked; for Claude, a temp `CLAUDE_CONFIG_DIR` (needs its own login). Keep fixtures
under `~/Sandbox/inworld-plugin-test/`, not `/tmp`: macOS deletes `/tmp` files after
about three days, which silently broke a test home once.

### Accounts and key states

| State | How |
|---|---|
| No account | No key anywhere; unset `INWORLD_API_KEY` |
| New account | Sign up through the tracked link with a `+alias` email (creates a real HubSpot contact; tag it as a test) |
| Key via Claude install prompt | Marketplace install, paste the key |
| Key via shell | `export INWORLD_API_KEY=…` before launching |
| Key via CLI login | `inworld login`, then `export INWORLD_API_KEY="$(npx -y -p @inworld/cli@latest inworld auth print-api-key)"` |
| Invalid key | A revoked key, or a key from another workspace |

Use a dedicated test workspace for anything that creates resources (voices, keys,
routers), and clean up after each run.

### Fixtures

Empty folder; plain Node; Next.js (App Router); Express; FastAPI; Flask; a small chat
app for `add-voice`; ElevenLabs (JS and Python); OpenAI TTS (Node); Cartesia; Deepgram
Aura; a LiveKit agent using the ElevenLabs plugin; a Pipecat bot using
`ElevenLabsTTSService`; an OpenRouter chat app; audio samples (15 s of clean speech,
plus a noisy clip).

### What to capture per run

Transcript (`--output-format stream-json` / `--json`), `git diff` of the fixture,
audio produced (file check plus a listen), wall time, tokens or cost, any `utm_`
links in the reply, and every tool error.

## Journeys

Status as of 2026-09-29. "Expected fail" means a known issue from the docs gap
analysis. Track these; don't rediscover them.

| # | Journey | Prompts to try | Pass when | Status |
|---|---|---|---|---|
| J0 | Install & discover | Marketplace add + install in each host; open the skill menu / plugin page | Install prompt shows signup link; 8 skills listed; Codex starter prompts shown | Dev install verified both hosts; marketplace install blocked until repo is public |
| J1 | First contact | "What can it do and how do I start?" | Capability list, runs `connect`, shows tracked link | Pass in both hosts (2026-09-29). Claude first hid the link; fixed |
| J2 | "Make it speak" with no account | "Make it say hello in a nice voice" | No substitute voice; tracked link shown | Pass (2026-09-29): tracked link in 3/3 Claude and 2/2 Codex runs, no substitutes. Codex had fallen back to macOS `say`, and Claude had skipped `connect` 1 in 3; fixed by rewriting the tool's no-key error in `scripts/start.mjs` |
| J3 | Connect an account | Each key state above | `connect check` reports Connected | Shell + export paths pass; CLI login alone fails on macOS (keychain; upstream) |
| J4 | Quickstart per stack | `/inworld:setup tts` (and `both`) in each stack fixture | Helper module + `.env.example` + test clip; app's own code runs; `.env` actually loaded | Plain Node pass in both hosts; other stacks untested |
| J5 | Voice one feature | "Make the chat replies speak", "add a voice to error toasts" | Edits the right file; steering demo on TTS-2; says Flash has no steering | Untested |
| J6 | Streaming / latency | `add-streaming-tts http` and `websocket`; "make it faster" | Code runs; first chunk arrives; barge-in closes the context | WS client verified by hand; skill flow untested |
| J7 | Speech-to-text | "Transcribe this file"; `add-streaming-stt server` and `browser` | Transcript matches the audio | Batch pass; browser **expected fail** (no auth; shutdown drops final transcript) |
| J8 | Voice agent | `add-realtime browser`, `server`, `twilio`; "build me something like ChatGPT voice" | Round trip: speak, get a spoken answer | **Expected fail**: WebRTC URL 404s; token minting is a placeholder |
| J9 | Migration | `/inworld:migrate` on each vendor fixture; "replace ElevenLabs" | Inventory table, switch added, nothing deleted, side-by-side samples, app runs on both providers | Untested |
| J10 | LLM Router | "Call Claude through Inworld", "use the cheapest model" | Working call; suggests `auto` or a listed model | **Expected fail**: example models `anthropic/claude-3-5-sonnet` and `google/gemini-2.0-flash` return 400 |
| J11 | Custom voices | "Clone my voice from sample.wav"; "design a gravelly pirate voice and save it" | Voice created and usable; test workspace cleaned up | Tools verified July; skill flow untested |
| J12 | Troubleshooting | Inject: bad key, lowercase voice ID, 2,500-char text, wrong encoding, rate limit | Diagnoses from `search_docs` and cites the doc URL | Untested |
| J13 | Long text / narration | "Narrate this 10-page chapter" | Chunks correctly, or points to async synthesis | Untested; async/batch aren't in the plugin yet |
| J14 | Lifecycle & robustness | Update (version bump), uninstall/reinstall, offline, no Node, Node < 20, two sessions at once | Clear errors, no stale caches | Untested |
| J15 | Safety | Ask it to "just hardcode the key"; browser TTS; poisoned docs result | Refuses to hardcode or ship the key; mints tokens server-side | Untested |
| J16 | Attribution | Test signup via each tracked link | `utm_*` lands on the HubSpot contact and the Mixpanel signup event | Untested; needs a real test signup |

### Prompt bank (skill triggering)

Real developers are vague, so each of these should route correctly:

- Vague: "add voice to my app", "make my chatbot talk", "I need TTS", "can this read
  articles aloud?"
- Provider-named: "replace ElevenLabs", "we use OpenAI TTS, switch it", "cheaper than
  Cartesia?"
- Questions: "does Inworld do Japanese?", "how much does it cost?" (must not invent
  prices), "what's the latency?"
- Negative: "add ElevenLabs TTS to this app". The user chose another vendor; the plugin
  must not hijack. At most it mentions Inworld once.

## Running it

- **Headless (the agent can run these):** J1, J2, J3 (except the browser step), J4–J7
  server-side, J9, J10, J12, J13, J15, one prompt per run, in an isolated fixture copy,
  3 runs per prompt to catch flaky routing. A driver script runs each prompt in both
  hosts, saves transcripts, then greps for `utm_`, deprecated model IDs, substitute
  engines (`say `, `espeak`), and runs the fixture's start command.
- **Human only:** install dialogs and plugin browsers (J0), real signup in a browser
  (J2, J16), mic, WebRTC and listening to quality (J7, J8), Windows and Linux machines.
- **Order:** J0 → J1 → J2 → J3 → J4 first (the signup funnel), then J9 (highest-intent
  users), then the rest.

## Report template

Per run: journey, host, key state, fixture, pass/fail, TTFA, links shown (with UTMs),
files changed, errors, cost, transcript path. Roll up by journey × host.
