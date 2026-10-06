#!/usr/bin/env node
// Inworld voice lab: a small stdio MCP server for the part of building a voice
// app that happens by ear. find_voices searches the catalog from a description,
// design_voice creates one when nothing fits, compare_voices renders the same
// line in several voices, check_speech_text fixes text before synthesis, and
// measure_latency times streaming TTS from this machine.
//
// Clips are listed one per line as "A: <id> → <file.mp3>". The plugin's mod
// draws play buttons from those lines in Claude Code; MCP Apps hosts get a
// player card; anywhere else the agent plays the files with the OS player.
//
// Dependency-free on purpose: newline-delimited JSON-RPC over stdio, Node 18+.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSpeechText } from "./speech-text.mjs";
import { createBench } from "./bench.mjs";

const UI_URI = "ui://inworld/voice-compare";
const UI_MIME = "text/html;profile=mcp-app";
const UI_EXTENSION = "io.modelcontextprotocol/ui";
const API_BASE = (process.env.INWORLD_API_BASE || "https://api.inworld.ai").replace(/\/+$/, "");
const HERE = dirname(fileURLToPath(import.meta.url));
const LABELS = ["A", "B", "C", "D", "E", "F", "G", "H"];

const SIGNUP = "https://platform.inworld.ai/signup";

let hostSupportsUi = false;

// Key: the plugin setting, then INWORLD_API_KEY from the environment.
async function apiKey() {
  return process.env.INWORLD_PLUGIN_API_KEY?.trim() || process.env.INWORLD_API_KEY?.trim() || "";
}

// Set by the Claude Code plugin, whose mod draws play buttons under the result.
const MOD_BUTTONS = process.env.INWORLD_VOICE_LAB_BUTTONS === "1";

const MODEL_NOTE = "inworld-tts-2 (default; supports steering tags) or inworld-tts-2-flash (fastest; no steering).";
const CATEGORIES = ["companions", "enterprise", "education_training", "developer_assistants", "healthcare", "interactive_media"];

const TOOLS = [
  {
    name: "find_voices",
    title: "Find Inworld voices from a description",
    description:
      "Search Inworld's voice library from what the user is looking for (\"calm older British man for a meditation app\", " +
      "\"upbeat young support agent\"). Translate the description into the structured filters (gender, age_group, " +
      "language, categories) and pass the rest as `query`, which ranks voices by their tags and descriptions. Returns " +
      "the best matches with descriptions. Pass `audition_line` to also render the top matches speaking that line so " +
      "the user can listen right away. If nothing fits, use design_voice with the same description.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What the voice should sound like, in the user's words (tone, timbre, accent, use case)." },
        gender: { type: "string", enum: ["male", "female", "neutral"] },
        age_group: { type: "string", enum: ["young", "middle_aged", "elderly"] },
        language: { type: "string", description: "Locale or language, e.g. en-US, en-GB, es, ja." },
        categories: { type: "array", items: { type: "string", enum: CATEGORIES } },
        include_own: { type: "boolean", description: "Include the workspace's own cloned and designed voices (default true)." },
        include_community: { type: "boolean", description: "Include community voices shared by other workspaces (default false)." },
        limit: { type: "integer", minimum: 1, maximum: 20, description: "Number of matches to return (default 8)." },
        audition_line: { type: "string", description: "Optional line (ideally from the user's app) to render in the top matches (up to 4)." },
        model_id: { type: "string", description: MODEL_NOTE },
      },
    },
  },
  {
    name: "compare_voices",
    title: "Compare Inworld voices",
    description:
      "Render the same line in 2–4 voices (labelled A, B, C, D) so the user can listen and pick one. Voices can be " +
      "library voice IDs (`voices`) or one-off voice descriptions (`designs`, rendered with ad-hoc voice design, " +
      "inworld-tts-2 only, nothing saved). In Claude Code play buttons appear under the result; in MCP Apps hosts a " +
      "player card; otherwise it returns MP3 paths to play with the OS audio player (afplay on macOS). Use when the " +
      "user wants to hear, audition, or choose between voices.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Line to speak, ideally from the user's own app. Max 500 characters." },
        voices: {
          type: "array",
          items: { type: "string" },
          maxItems: 4,
          description: "Inworld voice IDs, case-sensitive (e.g. Ashley, Dennis, Clive). Defaults to Ashley, Dennis, Clive when no designs are given.",
        },
        designs: {
          type: "array",
          items: { type: "string" },
          maxItems: 4,
          description: "Voice descriptions to try without saving, e.g. \"a warm, raspy grandmother with a slight Irish lilt\" (7–1024 characters each).",
        },
        model_id: { type: "string", description: MODEL_NOTE },
        delivery_mode: { type: "string", enum: ["STABLE", "BALANCED", "CREATIVE"], description: "inworld-tts-2 only. STABLE = consistent, CREATIVE = more emotional range. Default BALANCED." },
      },
      required: ["text"],
    },
    _meta: { ui: { resourceUri: UI_URI }, "ui/resourceUri": UI_URI },
  },
  {
    name: "design_voice",
    title: "Design a new Inworld voice",
    description:
      "Create a new voice from a description when no library voice fits. Returns up to 3 preview voices (A, B, C) " +
      "speaking `script`, with play buttons in Claude Code. Previews are drafts: after the user picks one, call " +
      "publish_voice to save it to their library and get a voiceId for their code. A good description covers gender " +
      "and age, accent, pitch and pace, tone, and timbre; write the script in the character's own words, since it " +
      "shapes the voice.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "English description of the voice, 30–1000 characters." },
        script: { type: "string", description: "What the previews say, in character; 1–30 s of audio (~50–400 characters)." },
        language: { type: "string", description: "Locale; the accent is part of it (en-GB for British, en-AU for Australian). Default: auto-detect." },
        samples: { type: "integer", minimum: 1, maximum: 3, description: "Number of previews (default 3)." },
        structured: { type: "boolean", description: "true if `description` is already a structured profile of `key: value` lines (dialect, gender, age, emotion, tone, pitch, volume, speed, clarity, fluency, personality, texture, environment), used as-is." },
      },
      required: ["description", "script"],
    },
  },
  {
    name: "publish_voice",
    title: "Save a designed voice",
    description: "Publish a design_voice preview to the user's voice library so its voiceId works in synthesis. Only after the user has picked it.",
    inputSchema: {
      type: "object",
      properties: {
        voice_id: { type: "string", description: "The preview's voice ID from design_voice." },
        display_name: { type: "string" },
        description: { type: "string" },
        tags: { type: "array", items: { type: "string" }, description: "Style and use-case tags (e.g. warm, narrator). Not gender or age." },
      },
      required: ["voice_id", "display_name"],
    },
  },
  {
    name: "check_speech_text",
    title: "Check text before speaking it",
    description:
      "Check text that will be sent to Inworld TTS (a prompt template, an LLM reply, UI copy) and return a fixed copy: " +
      "wraps booking references, order numbers, plates and other alphanumeric IDs in <verbatim> so they are spelled " +
      "out, strips markdown and emoji, and flags steering tags the chosen model ignores, steering that runs on longer " +
      "than intended, invalid <break> tags, unsupported SSML, multi-word IPA, and ambiguous dates. Works without an " +
      "API key. Pass `listen_voice` to render the original and fixed text as A and B so the user can hear the difference.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        model_id: { type: "string", description: MODEL_NOTE },
        text_normalization: { type: "string", enum: ["default", "on", "off"], description: "The applyTextNormalization setting the app uses (default unset)." },
        listen_voice: { type: "string", description: "Optional voice ID: render original (A) and fixed (B) for an A/B listen." },
      },
      required: ["text"],
    },
  },
  {
    name: "measure_latency",
    title: "Measure TTS latency from here",
    description:
      "Time Inworld streaming TTS from this machine: time to first audio and total time, over several runs, for each " +
      "model (and optionally with text normalization off). Use when the user is choosing a model, debugging a slow " +
      "voice agent, or wants numbers for their own network. Results include the network round trip, so they run " +
      "higher than Inworld's server-side P90 (inworld-tts-2-flash 20 ms, inworld-tts-2 100 ms).",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "A typical first sentence the app speaks (default: a short greeting)." },
        voice: { type: "string", description: "Voice ID (default Ashley)." },
        models: { type: "array", items: { type: "string" }, description: "Default [inworld-tts-2-flash, inworld-tts-2]." },
        runs: { type: "integer", minimum: 1, maximum: 10, description: "Timed runs per configuration after one warm-up (default 5)." },
        compare_normalization: { type: "boolean", description: "Also time each model with applyTextNormalization OFF." },
      },
    },
  },
  {
    name: "list_llm_models",
    title: "List LLMs on Inworld's router",
    description:
      "List the LLMs available through Inworld's router (one API key, OpenAI-compatible /v1/chat/completions) with " +
      "price per 1M tokens, context length, and tool-calling and reasoning support, cheapest first. Use to pick " +
      "candidates for benchmark_models or when the user asks which models they can use.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Filter by id or creator, e.g. \"claude\", \"gemini flash\", \"deepseek\"." },
        needs_tools: { type: "boolean", description: "Only models with function calling." },
        inworld_hosted_only: { type: "boolean", description: "Only models Inworld serves on its own realtime inference stack." },
        include_free: { type: "boolean", description: "Include rate-limited :free variants (hidden by default)." },
        limit: { type: "integer", minimum: 1, maximum: 120 },
      },
    },
  },
  {
    name: "benchmark_models",
    title: "Benchmark LLMs for a voice app",
    description:
      "Run the user's own prompt through several LLMs on Inworld's router and compare them the way a voice app " +
      "experiences them: time to first token, to the first complete sentence, and to the first audio when that " +
      "sentence is streamed into Inworld TTS, plus full-reply time, tokens/s and cost per 1,000 replies. Then " +
      "renders each model's reply in the same voice so the user can judge quality by ear (play buttons in Claude " +
      "Code). Use when the user is choosing or switching an LLM for a voice agent, or asks which model is fastest " +
      "or cheapest for their use case.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "A real user turn from the app." },
        system: { type: "string", description: "The app's system prompt, if it has one (it changes latency and replies)." },
        models: { type: "array", items: { type: "string" }, maxItems: 8, description: "Router ids as provider/model from list_llm_models (e.g. groq/openai/gpt-oss-120b), or \"auto\". The same model on two providers is a fair comparison. Defaults to Inworld-hosted GLM 5.3 Flash, Gemma 4 26B and DeepSeek V4 Flash 0731, plus gpt-6-luna:fast and Gemini 2.5 Flash-Lite." },
        runs: { type: "integer", minimum: 1, maximum: 5, description: "Runs per model; medians are reported (default 3)." },
        voice: { type: "string", description: "Voice for the audio stage and the listening clips (default Ashley; empty string skips audio)." },
        tts_model: { type: "string", description: "inworld-tts-2-flash (default, lowest latency) or inworld-tts-2." },
        max_tokens: { type: "integer", description: "Default 200." },
        reasoning: { type: "string", enum: ["lowest", "default"], description: "lowest (default) sets each model's lowest reasoning effort, as a voice app usually should." },
        listen: { type: "boolean", description: "Render each reply in the voice (default true)." },
      },
      required: ["prompt"],
    },
  },
];

const bench = createBench({ apiBase: API_BASE });

const noKeyError = () => ({
  isError: true,
  content: [{
    type: "text",
    text:
      "No Inworld API key available: the user hasn't connected an Inworld account yet. Give them " +
      `this signup link in your reply: ${SIGNUP} . Then they create a ` +
      "key at https://platform.inworld.ai/api-keys and export INWORLD_API_KEY before starting a new " +
      "agent session. Don't substitute another speech engine in the meantime.",
  }],
});

async function api(path, key, { method = "GET", body, query } = {}) {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Basic ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Inworld ${method} ${path} → ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

const audioConfig = { audioEncoding: "MP3", sampleRateHertz: 24000, bitRate: 64000 };

async function synthesize(key, { text, voiceId, design, modelId, deliveryMode }) {
  const body = { text, modelId, audioConfig };
  if (design) body.voiceDesign = { designPrompt: design };
  else body.voiceId = voiceId;
  if (deliveryMode && !/flash/.test(modelId)) body.deliveryMode = deliveryMode;
  return (await api("/tts/v1/voice", key, { method: "POST", body })).audioContent;
}

async function newClipDir() {
  const dir = join(tmpdir(), "inworld-voice-lab", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(dir, { recursive: true });
  return dir;
}

const safeName = (s) => s.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 60);

async function saveClip(dir, label, id, audio) {
  const file = join(dir, `voice-${label}-${safeName(id)}.mp3`);
  await writeFile(file, Buffer.from(audio, "base64"));
  return file;
}

// The text result every listening tool shares; the mod parses the clip lines.
function listenResult(clips, intro, outro, extra = {}) {
  const lines = clips.map((c) => `${c.label}: ${c.id} → ${c.file}`).join("\n");
  const how = MOD_BUTTONS
    ? "Play buttons for each clip are shown to the user right under this result, so don't play the files yourself unless they ask."
    : hostSupportsUi
    ? "The player card is shown to the user."
    : "This host can't show a player, so play each file for the user in order, announcing its label first " +
      "(macOS: afplay <file>; Linux: paplay or ffplay -nodisp -autoexit <file>).";
  return {
    content: [{ type: "text", text: `${intro} ${how}\n${lines}\n${outro}` }],
    // Audio only goes into structuredContent for hosts that render the card, so
    // text-only hosts never put base64 audio into the model's context.
    structuredContent: {
      ...extra,
      clips: clips.map(({ label, id, file, audio, note }) =>
        hostSupportsUi
          ? { label, voiceId: id, file, note, mimeType: "audio/mpeg", audio }
          : { label, voiceId: id, file, note }),
    },
  };
}

async function compareVoices(args, key) {
  const text = String(args.text ?? "").trim().slice(0, 500);
  if (!text) return { isError: true, content: [{ type: "text", text: "compare_voices needs some text to speak." }] };
  const designs = (Array.isArray(args.designs) ? args.designs : []).map((d) => String(d).trim()).filter(Boolean);
  let voices = Array.isArray(args.voices) ? args.voices.filter(Boolean) : [];
  if (!voices.length && !designs.length) voices = ["Ashley", "Dennis", "Clive"];
  const modelId = args.model_id || "inworld-tts-2";
  if (designs.length && /flash/.test(modelId)) {
    return { isError: true, content: [{ type: "text", text: "Voice descriptions (designs) need inworld-tts-2; Flash doesn't support ad-hoc voice design." }] };
  }
  const jobs = [...voices.map((v) => ({ voiceId: v })), ...designs.map((d) => ({ design: d }))].slice(0, 4);

  const dir = await newClipDir();
  const clips = await Promise.all(
    jobs.map(async (job, i) => {
      const label = LABELS[i];
      const id = job.voiceId ?? `design-${label}`;
      const audio = await synthesize(key, { text, ...job, modelId, deliveryMode: args.delivery_mode });
      return { label, id, audio, file: await saveClip(dir, label, id, audio), note: job.design };
    }),
  );
  const designNotes = clips.filter((c) => c.note).map((c) => `${c.id} = "${c.note}"`).join("; ");
  return listenResult(
    clips,
    `Rendered "${text}" in ${clips.length} voices with ${modelId}.`,
    "Ask which one they prefer. If they pick a library voice, use that voiceId in their project." +
      (designNotes
        ? ` Designed voices (${designNotes}) are one-offs: to keep one, run design_voice with that description and publish the preview they like.`
        : ""),
    { text, model: modelId },
  );
}

const STOP = new Set("a an and the with for of to in on voice voices sounding sounds like that who is very bit slightly".split(" "));

async function findVoices(args, key) {
  const filters = [];
  if (args.gender) filters.push(`gender="${args.gender}"`);
  if (args.age_group) filters.push(`age_group="${args.age_group}"`);
  if (args.language) filters.push(`lang_code="${String(args.language).replace(/"/g, "")}"`);
  for (const c of args.categories ?? []) filters.push(`categories:"${c}"`);
  if (args.include_own === false) filters.push(`owned="false"`);
  if (args.include_community) filters.push(`community="true"`);

  let voices;
  try {
    ({ voices = [] } = await api("/voices/v1/voices", key, {
      query: { filter: filters.join(" AND "), pageSize: "2000" },
    }));
  } catch (e) {
    // Keys without the Voices API scope (403) still reach the older TTS list,
    // which only filters by language; apply the rest from its tags.
    if (!/→ 403/.test(e.message)) throw e;
    const lang = args.language ? String(args.language).slice(0, 2).toLowerCase() : "";
    ({ voices = [] } = await api("/tts/v1/voices", key, { query: { filter: lang ? `language=${lang}` : "" } }));
    const gender = { male: /\b(male|man|boy|guy|gentleman)\b/, female: /\b(female|woman|girl|lady)\b/, neutral: /\b(neutral|androgynous)\b/ }[args.gender];
    const age = { young: /young/, middle_aged: /middle/, elderly: /elder|old|senior/ }[args.age_group];
    voices = voices
      .map((v) => ({ ...v, owned: v.isCustom, languageCode: v.languages?.[0] }))
      .filter((v) => !gender || gender.test(`${(v.tags ?? []).join(" ")} ${v.description ?? ""}`.toLowerCase()))
      .filter((v) => !age || age.test(`${(v.tags ?? []).join(" ")} ${v.description ?? ""}`.toLowerCase()))
      .filter((v) => args.include_own !== false || !v.isCustom);
  }

  const words = String(args.query ?? "").toLowerCase().split(/[^a-z0-9-]+/).filter((w) => w.length > 2 && !STOP.has(w));
  const scored = voices.map((v) => {
    const tagWords = (v.tags ?? []).flatMap((t) => t.toLowerCase().split(/[^a-z0-9-]+/));
    const descWords = `${v.displayName ?? ""} ${v.description ?? ""}`.toLowerCase().split(/[^a-z0-9-]+/);
    let score = 0;
    for (const w of words) {
      // Loose stem so narrator ~ narration, calm ~ calming, energetic ~ energy.
      const stem = w.slice(0, Math.max(4, w.length - 3));
      if (tagWords.some((t) => t.startsWith(stem))) score += 3;
      else if (descWords.some((t) => t.startsWith(stem))) score += 2;
    }
    if (v.owned && score > 0) score += 0.5; // prefer their own voices among real matches
    return { v, score };
  });
  scored.sort((a, b) => b.score - a.score || String(a.v.displayName).localeCompare(String(b.v.displayName)));
  const limit = Math.min(Math.max(args.limit ?? 8, 1), 20);
  const top = scored.slice(0, limit);

  const rows = top.map(({ v }) => {
    const meta = [v.gender, v.ageGroup?.replace("_", " "), v.languageCode, v.source !== "SYSTEM" ? v.source : ""].filter(Boolean).join(", ");
    const tags = v.tags?.length ? ` [${v.tags.join(", ")}]` : "";
    return `- ${v.voiceId}${v.displayName && v.displayName !== v.voiceId ? ` (${v.displayName})` : ""} — ${meta}${tags}${v.description ? `: ${v.description}` : ""}`;
  });
  const header =
    `${voices.length} voices match the filters${filters.length ? ` (${filters.join(" AND ")})` : ""}` +
    (words.length ? `; ranked by "${words.join(" ")}"` : "") + ".";
  const tail = top.length && top[0].score === 0 && words.length
    ? "\nNo voice's tags or description matched the query words, so these are only filter matches. Offer design_voice with the user's description."
    : "\nIf none of these fit, design_voice can create one from the same description.";

  if (!args.audition_line || !top.length) {
    return { content: [{ type: "text", text: `${header}\n${rows.join("\n")}${tail}` }] };
  }
  const audition = await compareVoices(
    { text: args.audition_line, voices: top.slice(0, 4).map(({ v }) => v.voiceId), model_id: args.model_id },
    key,
  );
  audition.content[0].text = `${header}\n${rows.join("\n")}\n\nAudition of the top ${Math.min(4, top.length)}:\n${audition.content[0].text}`;
  // Some hosts give the model structuredContent instead of the text, so the
  // matches go there too.
  audition.structuredContent.matches = top.map(({ v }) => ({
    voiceId: v.voiceId, displayName: v.displayName, gender: v.gender, ageGroup: v.ageGroup,
    languageCode: v.languageCode, tags: v.tags, description: v.description,
  }));
  return audition;
}

async function designVoice(args, key) {
  const description = String(args.description ?? "").trim();
  const script = String(args.script ?? "").trim();
  if (description.length < 7 || !script) {
    return { isError: true, content: [{ type: "text", text: "design_voice needs a description (ideally 30+ characters: gender, age, accent, pitch, pace, tone, timbre) and a script." }] };
  }
  const body = {
    designPrompt: description.slice(0, 1000),
    previewText: script,
    voiceDesignConfig: { numberOfSamples: Math.min(Math.max(args.samples ?? 3, 1), 3) },
  };
  if (args.language) body.languageCode = args.language;
  if (args.structured) body.designPromptMode = "DESIGN_PROMPT_MODE_VERBATIM";
  let previewVoices;
  try {
    ({ previewVoices = [] } = await api("/voices/v1/voices:design", key, { method: "POST", body }));
  } catch (e) {
    if (!/→ 403/.test(e.message) || args.structured) throw e;
    return designAdHoc(args, description, script, body.voiceDesignConfig.numberOfSamples, key);
  }
  if (!previewVoices.length) return { isError: true, content: [{ type: "text", text: "Voice design returned no previews; try a more specific description." }] };

  const dir = await newClipDir();
  const clips = await Promise.all(
    previewVoices.slice(0, 3).map(async (p, i) => ({
      label: LABELS[i],
      id: p.voiceId,
      audio: p.previewAudio,
      file: await saveClip(dir, LABELS[i], p.voiceId, p.previewAudio),
    })),
  );
  return listenResult(
    clips,
    `Designed ${clips.length} preview voices from "${description.slice(0, 120)}${description.length > 120 ? "…" : ""}".`,
    "These are drafts. Ask which one they want, then call publish_voice with its ID and a name. If none are " +
      "right, adjust the description (age, accent, pitch, pace, tone, timbre) or the script and design again.",
    { description, script },
  );
}

const WRITE_FIX =
  "Turn on Voice API write permission for the key in https://platform.inworld.ai/api-keys, or mint one from the " +
  "terminal with `npx -y -p @inworld/cli@latest inworld workspace add-key --name voice-lab --write`, then select it " +
  "with `inworld workspace select-key` and restart the agent session.";

// Keys without Voice API write permission can't create draft voices, but ad-hoc
// voice design on the TTS endpoint still lets the user hear candidates.
async function designAdHoc(args, description, script, samples, key) {
  const dir = await newClipDir();
  const clips = await Promise.all(
    LABELS.slice(0, samples).map(async (label) => {
      const id = `design-${label}`;
      const audio = await synthesize(key, { text: script, design: description, modelId: "inworld-tts-2" });
      return { label, id, audio, file: await saveClip(dir, label, id, audio) };
    }),
  );
  return listenResult(
    clips,
    `This API key can't save voices, so these ${clips.length} previews were rendered with ad-hoc voice design ` +
      "(listen-only; each one is a fresh take on the description).",
    `To save the one the user likes, they need a key with Voice API write permission. ${WRITE_FIX} Then run ` +
      "design_voice again and publish the preview they pick.",
    { description, script, saved: false },
  );
}

async function publishVoice(args, key) {
  const id = String(args.voice_id ?? "").trim();
  const body = { displayName: args.display_name };
  if (args.description) body.description = args.description;
  if (args.tags?.length) body.tags = args.tags;
  let v;
  try {
    v = await api(`/voices/v1/voices/${encodeURIComponent(id)}:publish`, key, { method: "POST", body });
  } catch (e) {
    if (/→ 403/.test(e.message)) return { isError: true, content: [{ type: "text", text: `This API key can't save voices. ${WRITE_FIX}` }] };
    throw e;
  }
  return {
    content: [{
      type: "text",
      text: `Saved "${v.displayName ?? args.display_name}" to the voice library. Use voiceId ${v.voiceId ?? id} in the project's TTS calls (keep it in config, not hard-coded in several places).`,
    }],
    structuredContent: v,
  };
}

async function checkText(args) {
  const model = args.model_id || "inworld-tts-2";
  const r = checkSpeechText(args.text, { model, normalization: args.text_normalization ?? "default" });
  const issues = r.issues.length
    ? r.issues.map((i) => `- ${i.severity.toUpperCase()} ${i.rule}: ${i.message}`).join("\n")
    : "- No problems found.";
  const report = `${issues}\n\n${r.changed ? `Fixed text:\n${r.text}` : "Text is unchanged."}`;
  const hint =
    "\n\nIf this text comes from an LLM, fix it at the source: tell the LLM to answer in plain spoken sentences " +
    "(no markdown or emoji) and to wrap IDs, codes and reference numbers in <verbatim></verbatim>.";

  if (!args.listen_voice || !r.changed) return { content: [{ type: "text", text: report + hint }], structuredContent: r };
  const key = await apiKey();
  if (!key) return noKeyError();
  const voiceId = args.listen_voice;
  const dir = await newClipDir();
  const versions = [
    { label: "A", id: "original", text: String(args.text).slice(0, 500) },
    { label: "B", id: "fixed", text: r.text.slice(0, 500) },
  ];
  const clips = await Promise.all(
    versions.map(async (c) => {
      const audio = await synthesize(key, { text: c.text, voiceId, modelId: model });
      return { ...c, audio, file: await saveClip(dir, c.label, `${c.id}-${voiceId}`, audio) };
    }),
  );
  const out = listenResult(clips, `${report}\n\nRendered both versions in ${voiceId}.`, "Ask whether the fixed version sounds right." + hint, r);
  return out;
}

function pct(sorted, p) {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function timeOnce(key, body) {
  const t0 = performance.now();
  const res = await fetch(`${API_BASE}/tts/v1/voice:stream`, {
    method: "POST",
    headers: { Authorization: `Basic ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`stream ${res.status} ${(await res.text()).slice(0, 200)}`);
  let first = NaN;
  let buf = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    if (Number.isNaN(first)) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while (Number.isNaN(first) && (nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        try {
          const msg = JSON.parse(line);
          if (msg.error) throw new Error(JSON.stringify(msg.error).slice(0, 200));
          if (msg.result?.audioContent) first = performance.now() - t0;
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
  }
  return { first, total: performance.now() - t0 };
}

async function measureLatency(args, key) {
  const text = String(args.text || "Hi there! Thanks for calling. How can I help you today?").slice(0, 500);
  const voiceId = args.voice || "Ashley";
  const models = args.models?.length ? args.models : ["inworld-tts-2-flash", "inworld-tts-2"];
  const runs = Math.min(Math.max(args.runs ?? 5, 1), 10);
  const configs = models.flatMap((modelId) => [
    { modelId, norm: "default" },
    ...(args.compare_normalization ? [{ modelId, norm: "OFF" }] : []),
  ]);

  const rows = [];
  for (const c of configs) {
    const body = { text, voiceId, modelId: c.modelId, audioConfig: { audioEncoding: "PCM", sampleRateHertz: 24000 } };
    if (c.norm === "OFF") body.applyTextNormalization = "OFF";
    try {
      await timeOnce(key, body); // warm-up: TLS handshake and connection reuse
      const samples = [];
      for (let i = 0; i < runs; i++) samples.push(await timeOnce(key, body));
      const first = samples.map((s) => s.first).filter(Number.isFinite).sort((a, b) => a - b);
      const total = samples.map((s) => s.total).sort((a, b) => a - b);
      rows.push({ ...c, runs, firstP50: pct(first, 50), firstP90: pct(first, 90), totalP50: pct(total, 50) });
    } catch (e) {
      rows.push({ ...c, error: String(e.message ?? e) });
    }
  }

  const ms = (n) => (Number.isFinite(n) ? `${Math.round(n)} ms` : "n/a");
  const table = [
    "| model | normalization | first audio p50 | first audio p90 | total p50 |",
    "|---|---|---|---|---|",
    ...rows.map((r) =>
      r.error
        ? `| ${r.modelId} | ${r.norm} | error: ${r.error} | | |`
        : `| ${r.modelId} | ${r.norm} | ${ms(r.firstP50)} | ${ms(r.firstP90)} | ${ms(r.totalP50)} |`),
  ].join("\n");
  return {
    content: [{
      type: "text",
      text:
        `Streaming TTS from this machine to ${API_BASE}, ${runs} runs each after a warm-up, voice ${voiceId}, ` +
        `${text.length} characters.\n\n${table}\n\n` +
        "These include the network round trip from here; Inworld's server-side P90 time to first audio is 20 ms " +
        "for inworld-tts-2-flash and 100 ms for inworld-tts-2. To cut latency in the app: stream (WebSocket is " +
        "fastest), send the LLM's output sentence by sentence, reuse connections (keep-alive), don't wait for " +
        "contextCreated on WebSocket, set timestampTransportStrategy ASYNC if using timestamps, turn normalization " +
        "OFF only if the app writes numbers and symbols out itself, and run the backend close to the API " +
        "(EU and India regions exist for Enterprise).",
    }],
    structuredContent: { text, voiceId, apiBase: API_BASE, results: rows },
  };
}

const HANDLERS = {
  find_voices: findVoices,
  compare_voices: compareVoices,
  design_voice: designVoice,
  publish_voice: publishVoice,
  measure_latency: measureLatency,
  list_llm_models: (args, key) => bench.listModels(args, key),
  benchmark_models: (args, key) =>
    bench.benchmark(args, key, { synthesize, newClipDir, saveClip, listenResult, labels: LABELS }),
};

async function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize": {
      const caps = params?.capabilities ?? {};
      hostSupportsUi = Boolean(caps.extensions?.[UI_EXTENSION] || caps.experimental?.[UI_EXTENSION]);
      return {
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {}, resources: {}, extensions: { [UI_EXTENSION]: {} } },
        serverInfo: { name: "inworld-voice-lab", version: "0.2.0" },
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const name = params?.name;
      const args = params?.arguments ?? {};
      try {
        if (name === "check_speech_text") return await checkText(args);
        const handler = HANDLERS[name];
        if (!handler) throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
        const key = await apiKey();
        if (!key) return noKeyError();
        return await handler(args, key);
      } catch (e) {
        if (e.code === -32602) throw e;
        return { isError: true, content: [{ type: "text", text: String(e?.message ?? e) }] };
      }
    }
    case "resources/list":
      return { resources: [{ uri: UI_URI, name: "voice_compare", title: "Voice comparison", mimeType: UI_MIME }] };
    case "resources/read":
      if (params?.uri === UI_URI) {
        const html = await readFile(join(HERE, "voice-compare.html"), "utf8");
        return { contents: [{ uri: UI_URI, mimeType: UI_MIME, text: html, _meta: { ui: { prefersBorder: true } } }] };
      }
      throw Object.assign(new Error(`Unknown resource: ${params?.uri}`), { code: -32002 });
    default:
      if (id === undefined) return undefined; // notification
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    Promise.resolve(handle(msg)).then(
      (result) => {
        if (msg.id !== undefined && result !== undefined) send({ jsonrpc: "2.0", id: msg.id, result });
      },
      (err) => {
        if (msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, error: { code: err.code ?? -32603, message: err.message } });
      },
    );
  }
});
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
