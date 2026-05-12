# Inworld TTS MCP Server - MVP Plan

## Overview
Build a TypeScript MCP server that wraps Inworld AI's TTS API, giving Claude Code (and other MCP clients) direct access to text-to-speech synthesis and voice listing.

## Project Structure
```
inworld-tts-mcp/
├── package.json
├── tsconfig.json
├── src/
│   └── index.ts          # MCP server with all tools
├── build/                 # Compiled output
└── README.md              # Setup instructions
```

## Tools to Implement

### 1. `list_voices`
- Calls `GET https://api.inworld.ai/tts/v1/voices`
- Optional `language` filter param (e.g. "en")
- Returns voice IDs, display names, descriptions, tags

### 2. `synthesize_speech`
- Calls `POST https://api.inworld.ai/tts/v1/voice`
- Parameters:
  - `text` (required, max 2000 chars)
  - `voice_id` (required, e.g. "Ashley")
  - `model_id` (optional, default "inworld-tts-1.5-max")
  - `audio_encoding` (optional, default "MP3")
  - `sample_rate` (optional, default 48000)
  - `speaking_rate` (optional, 0.5-1.5)
  - `output_file` (required - where to save the audio)
- Decodes base64 audio response, writes to file
- Returns file path, usage info, and word timestamps

## Authentication
- Reads `INWORLD_API_KEY` from environment
- Uses `Authorization: Basic <key>` header
- Key is the base64-encoded value from Inworld's portal (used as-is)

## Tech Stack
- TypeScript with `@modelcontextprotocol/sdk` + `zod@3`
- Node.js native `fetch` (no extra HTTP deps)
- STDIO transport (standard for Claude Code MCP servers)

## Steps

1. **Scaffold project** - Create directory, package.json, tsconfig.json
2. **Install dependencies** - `@modelcontextprotocol/sdk`, `zod@3`, TypeScript
3. **Implement `src/index.ts`** - Server setup, both tools, auth, file output
4. **Build and test** - Compile TypeScript, verify it starts
5. **Add Claude Code config** - MCP server entry in `.claude/settings.local.json`
