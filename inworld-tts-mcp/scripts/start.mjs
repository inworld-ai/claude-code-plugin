#!/usr/bin/env node
// Entry point for the plugin's MCP server in both Claude Code and Codex.
// Resolves the API key, then hands off to the vendored server in build/.
//
// Key precedence: the plugin setting (Claude Code userConfig, passed in as
// INWORLD_PLUGIN_API_KEY), then INWORLD_API_KEY from the user's shell, then the
// Inworld CLI's file-based credential store, which the server reads on every call.
// The bundle can't load the CLI's native keychain module, so a key the CLI saved
// to the macOS or Windows keychain isn't visible here. The plugin setting arrives
// as an empty string when the user skipped it at install, so it must not
// overwrite a key exported in the shell.
const fromPlugin = process.env.INWORLD_PLUGIN_API_KEY?.trim();
if (fromPlugin) process.env.INWORLD_API_KEY = fromPlugin;
delete process.env.INWORLD_PLUGIN_API_KEY;

// Without any credential the server exits at startup, which takes down
// search_docs too — the one tool that works before signup. Booting anyway lets
// key-requiring tools fail per call instead, and the skills turn that failure
// into the signup path.
process.env.INWORLD_SKIP_AUTH ??= "1";

await import("../build/index.js");
