---
name: connect
description: |
  Connect the coding agent to an Inworld account: sign up for free, create an API
  key, and make it available to the Inworld plugin and to the user's app.
  Run this before replying whenever an Inworld tool fails with "No Inworld API key
  available", "API key does not exist or was deleted", or a 401/403 from
  api.inworld.ai; it has the signup link the user needs. Also use when the user asks
  how to sign up for Inworld or get an API key, or before scaffolding Inworld code for
  a user who has no key yet.
argument-hint: "[check]"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, mcp__plugin_inworld_inworld__list_voices, mcp__plugin_inworld_inworld__search_docs
---

# Connect to Inworld

The plugin's MCP server starts without a key, so `search_docs` works before signup.
Every other tool needs an Inworld API key. The server looks for one in this order:

1. The plugin's own API key setting (Claude Code prompts for it at install).
2. `INWORLD_API_KEY` in the environment the agent was launched from.
3. The Inworld CLI's file-based credential store. On macOS and Windows the CLI saves
   to the OS keychain instead, which the plugin's server can't read yet, so don't rely
   on this; use Path B below to export the key.

## Step 1 — Check the current state

Call `list_voices` with `{"language": "en"}` and read the result:

- A voice list → already connected. Say so in one line and go back to the user's task.
- `No Inworld API key available` → no key anywhere. Go to Step 2.
- `API key does not exist or was deleted` / 401 / 403 → a key is set but invalid
  (revoked, wrong workspace, or re-encoded). Go to Step 2 and have them create a new one.

If `$ARGUMENTS` is `check`, report the state and stop.

Never print a key value. Never ask the user to paste a key into chat; if they do anyway,
don't repeat it back, and only write it to a gitignored `.env`.

While there's no key, don't satisfy the request with a different speech engine (the
OS `say` command, espeak, another vendor's API): the user asked for Inworld, and a
substitute voice hides the fact that they aren't connected. Say what's missing, give
the signup path, and offer what works now: `search_docs` answers Inworld questions,
and code can be written with `INWORLD_API_KEY` read from the environment.

## Step 2 — Get a key

Tell the user, in two or three lines: Inworld's free On-Demand plan includes up to
70 minutes of TTS and 400 minutes of STT. Paid plans start at $25/month and include
that amount in credits. Then offer both paths and let them choose.

**Path A — browser (about a minute).**

1. Sign up at https://platform.inworld.ai/signup.

   Always write the link in your reply, even if you also offer to open it: in
   remote, headless, or desktop-app sessions the user may never see a browser you
   launch.
   Offer to open it (`open` on macOS, `xdg-open` on Linux) rather than opening it unasked.
2. Create a key at https://platform.inworld.ai/api-keys. Copy the Base64 value as is;
   do not re-encode it.
3. Make it available to the agent: have the user add
   `export INWORLD_API_KEY="<key>"` to the shell profile that launches the agent, then
   start a new agent session (MCP servers read their environment at startup).

**Path B — Inworld CLI.** The user runs these in their own terminal, because login
prints a URL and waits for them to finish in the browser. The `-p … inworld` form is
required: the package ships two commands, so `npx @inworld/cli` alone fails.

```
npx -y -p @inworld/cli@latest inworld login
npx -y -p @inworld/cli@latest inworld workspace add-key --name coding-agent
npx -y -p @inworld/cli@latest inworld workspace select-key
export INWORLD_API_KEY="$(npx -y -p @inworld/cli@latest inworld auth print-api-key)"
```

Skip `add-key` if the workspace already has a key. New keys are not selected
automatically, hence `select-key`. Then start a new agent session from that shell. To
make it permanent, save the key in their shell profile as in Path A rather than running
`npx` on every shell start. A key set in the plugin option still takes precedence; if
it holds a stale key, clear it.

## Step 3 — Give the user's app its own key

The plugin's key lets the agent call Inworld. The user's application needs the key in
its own runtime environment:

- Add `INWORLD_API_KEY=` (empty) to `.env.example`.
- If the user wants it in `.env`, have them paste the value there themselves, and make
  sure `.env` is in `.gitignore`.
- Keep the key server-side. Browsers and mobile clients should get short-lived tokens
  minted by the backend; run `search_docs` for "one-time tokens" if the app needs that.

## Step 4 — Verify

Call `list_voices` again. On success, report "Connected — N voices available" and
continue with whatever the user was doing (usually the `setup` skill).
