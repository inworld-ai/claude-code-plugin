// Model benchmarking through Inworld's router: one key reaches 100+ LLMs, so a
// developer can compare them on their own prompt and measure what a voice app
// actually feels like, time to the first spoken audio (LLM first sentence + TTS).

// From inworld.ai/models (the public catalog page), checked 2026-10-04. The
// router API has no labels or retirement dates, so these are curated here;
// Inworld-hosted models are detected from the `inworld` provider instead.
const POPULAR = new Set([
  "inworld/models/GLM-5.3-Flash",
  "inworld/models/gemma-4-31b-it",
  "inworld/models/gemma-4-26b-a4b-it",
  "inworld/models/deepseek-v4.1-flash",
]);
const RETIRING = {
  "google-vertex/gemini-2.5-flash-lite": "2026-10-20",
  "openai/gpt-4.1-nano": "2026-10-23",
  "openai/gpt-4.1-nano-2025-04-14": "2026-10-23",
  "openai/gpt-3.5-turbo": "2026-10-23",
  "anthropic/claude-sonnet-4-5-20250929": "2026-11-30",
  "openai/gpt-5-mini": "2026-12-11",
  "openai/gpt-5-nano": "2026-12-11",
};
const DEFAULT_MODELS = [
  "inworld/models/GLM-5.3-Flash",
  "inworld/models/gemma-4-26b-a4b-it",
  "inworld/models/deepseek-v4-flash-0731",
  "openai/gpt-6-luna:fast",
  "google-ai-studio/gemini-2.5-flash-lite",
];
const hosted = (id) => id.startsWith("inworld/");
const retiring = (id) => RETIRING[id];

const SENTENCE_END = /[.!?…](?=\s|$)|\n/;
const MIN_FIRST_CHUNK = 12; // don't send "Hi." alone

export function createBench({ apiBase }) {
  let catalog;

  async function models(key) {
    if (catalog) return catalog;
    const res = await fetch(`${apiBase}/llm/v1alpha/models`, { headers: { Authorization: `Basic ${key}` } });
    if (!res.ok) throw new Error(`Inworld GET /llm/v1alpha/models → ${res.status} ${(await res.text()).slice(0, 200)}`);
    catalog = (await res.json()).models ?? [];
    return catalog;
  }

  // The router's canonical id is provider/model (groq/openai/gpt-oss-120b);
  // bare model names only resolve for some models, so always send the full id.
  const idOf = (m) => `${m.provider}/${m.model}`;
  const find = (all, id) => all.find((m) => idOf(m) === id) ?? all.find((m) => m.model === id);
  const resolve = (all, id) => (id === "auto" ? id : find(all, id) ? idOf(find(all, id)) : id);

  // Lowest reasoning effort the model accepts, so hidden reasoning doesn't eat
  // the latency budget (or the max_tokens) of a spoken reply.
  function lowestEffort(m) {
    const levels = m?.spec?.capabilities?.reasoningCapability?.supportedLevels ?? [];
    for (const l of ["EFFORT_NONE", "EFFORT_MINIMAL", "EFFORT_LOW"]) if (levels.includes(l)) return l.slice(7).toLowerCase();
    return undefined;
  }

  async function listModels(args, key) {
    const all = await models(key);
    const q = String(args.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const rows = all
      .filter((m) => m.isSupported !== false && (m.spec?.outputModalities ?? ["text"]).includes("text"))
      .filter((m) => q.every((w) => `${idOf(m)} ${m.modelCreator ?? ""}`.toLowerCase().includes(w)))
      .filter((m) => !args.needs_tools || m.spec?.capabilities?.functionCalling)
      .filter((m) => !args.inworld_hosted_only || m.provider === "inworld")
      .filter((m) => args.include_free || !m.model.endsWith(":free"))
      .map((m) => ({
        id: idOf(m),
        creator: m.modelCreator,
        inPerM: (m.pricing?.promptToken ?? 0) * 1e6,
        outPerM: (m.pricing?.completionToken ?? 0) * 1e6,
        context: m.spec?.contextLength,
        tools: Boolean(m.spec?.capabilities?.functionCalling),
        reasoning: Boolean(m.spec?.capabilities?.reasoning),
        notes: [
          m.provider === "inworld" ? "Inworld-hosted" : "",
          POPULAR.has(idOf(m)) ? "popular" : "",
          retiring(idOf(m)) ? `retiring ${retiring(idOf(m))}` : "",
        ].filter(Boolean).join(", "),
      }))
      .sort((a, b) => a.inPerM + a.outPerM - (b.inPerM + b.outPerM));
    const usd = (n) => `$${n < 1 ? n.toFixed(2) : n.toFixed(n < 10 ? 2 : 0)}`;
    const lines = rows.slice(0, args.limit ?? 40).map((r) =>
      `| ${r.id} | ${usd(r.inPerM)} / ${usd(r.outPerM)} | ${r.context ? Math.round(r.context / 1000) + "k" : ""} | ${r.tools ? "yes" : ""} | ${r.reasoning ? "yes" : ""} | ${r.notes} |`);
    return {
      content: [{
        type: "text",
        text:
          `${rows.length} models on Inworld's router${q.length ? ` matching "${q.join(" ")}"` : ""}, cheapest first ` +
          "(price per 1M input / output tokens). Use the full id (provider/model) as `model` in /v1/chat/completions " +
          "(OpenAI-compatible), or `auto` to let the router pick. The same model on different providers can differ " +
          "a lot in latency, so benchmark_models can compare them. Inworld-hosted models run on Inworld's own " +
          "realtime inference stack; don't recommend models marked retiring for new work. Labels and retirement " +
          "dates are from inworld.ai/models.\n\n| id | $/1M in / out | context | tools | reasoning | notes |\n|---|---|---|---|---|---|\n" +
          lines.join("\n"),
      }],
    };
  }

  async function ttsFirstAudio(key, text, voiceId, modelId) {
    const res = await fetch(`${apiBase}/tts/v1/voice:stream`, {
      method: "POST",
      headers: { Authorization: `Basic ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text, voiceId, modelId, audioConfig: { audioEncoding: "PCM", sampleRateHertz: 24000 } }),
    });
    if (!res.ok) throw new Error(`TTS ${res.status} ${(await res.text()).slice(0, 150)}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return NaN;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        try {
          if (JSON.parse(line).result?.audioContent) {
            reader.cancel().catch(() => {});
            return performance.now();
          }
        } catch {}
      }
    }
  }

  // One run: stream the LLM, hand its first sentence to TTS the moment it's
  // complete (as a voice app should), and time each stage from the request.
  async function runOnce(key, { model, messages, maxTokens, effort, voice, ttsModel }) {
    const body = { model, messages, stream: true, stream_options: { include_usage: true }, max_tokens: maxTokens };
    if (effort) body.reasoning_effort = effort;
    const t0 = performance.now();
    const res = await fetch(`${apiBase}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Basic ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    let firstToken = NaN, firstSentence = NaN, text = "", usage, served, buf = "", tts;
    const dec = new TextDecoder();
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let j;
        try { j = JSON.parse(data); } catch { continue; }
        if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200));
        served ??= j.model;
        if (j.usage) usage = j.usage;
        const delta = j.choices?.[0]?.delta?.content;
        if (!delta) continue;
        if (Number.isNaN(firstToken)) firstToken = performance.now() - t0;
        text += delta;
        if (Number.isNaN(firstSentence) && text.trim().length >= MIN_FIRST_CHUNK) {
          const m = SENTENCE_END.exec(text.slice(MIN_FIRST_CHUNK - 1));
          if (m) {
            firstSentence = performance.now() - t0;
            const sentence = text.slice(0, MIN_FIRST_CHUNK - 1 + m.index + m[0].length).trim();
            if (voice) tts = ttsFirstAudio(key, sentence, voice, ttsModel).catch(() => NaN);
          }
        }
      }
    }
    const total = performance.now() - t0;
    if (Number.isNaN(firstSentence) && text.trim()) {
      firstSentence = total;
      if (voice) tts = ttsFirstAudio(key, text.trim(), voice, ttsModel).catch(() => NaN);
    }
    const audioAt = tts ? await tts : NaN;
    return { firstToken, firstSentence, firstAudio: Number.isFinite(audioAt) ? audioAt - t0 : NaN, total, text: text.trim(), usage, served };
  }

  const median = (xs) => {
    const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
    return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN;
  };

  async function benchmark(args, key, { synthesize, newClipDir, saveClip, listenResult, labels }) {
    const all = await models(key);
    const prompt = String(args.prompt ?? "").trim();
    if (!prompt) return { isError: true, content: [{ type: "text", text: "benchmark_models needs a prompt (ideally a real user turn from the app)." }] };
    const messages = [...(args.system ? [{ role: "system", content: String(args.system) }] : []), { role: "user", content: prompt }];
    const ids = (args.models?.length ? args.models : DEFAULT_MODELS).slice(0, 8);
    const runs = Math.min(Math.max(args.runs ?? 3, 1), 5);
    const voice = args.voice === "" ? undefined : args.voice || "Ashley";
    const ttsModel = args.tts_model || "inworld-tts-2-flash";
    const maxTokens = args.max_tokens ?? 200;

    const rows = [];
    for (const asked of ids) {
      const model = resolve(all, asked);
      const meta = find(all, model);
      const effort = args.reasoning === "default" ? undefined : lowestEffort(meta);
      const samples = [];
      let error;
      for (let i = 0; i < runs; i++) {
        try {
          samples.push(await runOnce(key, { model, messages, maxTokens, effort, voice, ttsModel }));
        } catch (e) {
          error = String(e.message ?? e);
          break;
        }
      }
      const last = samples.at(-1);
      const inTok = median(samples.map((s) => s.usage?.prompt_tokens ?? NaN));
      const outTok = median(samples.map((s) => s.usage?.completion_tokens ?? NaN));
      const cost = meta?.pricing && Number.isFinite(inTok)
        ? inTok * (meta.pricing.promptToken ?? 0) + outTok * (meta.pricing.completionToken ?? 0)
        : NaN;
      const genMs = median(samples.map((s) => s.total - s.firstToken));
      rows.push({
        model, served: last?.served, effort, error, runs: samples.length,
        firstToken: median(samples.map((s) => s.firstToken)),
        firstSentence: median(samples.map((s) => s.firstSentence)),
        firstAudio: median(samples.map((s) => s.firstAudio)),
        total: median(samples.map((s) => s.total)),
        tokPerSec: Number.isFinite(outTok) && genMs > 0 ? (outTok / genMs) * 1000 : NaN,
        costPer1k: cost * 1000,
        reasoningTokens: last?.usage?.completion_tokens_details?.reasoning_tokens,
        reply: last?.text ?? "",
      });
    }

    const ms = (n) => (Number.isFinite(n) ? `${Math.round(n)} ms` : "n/a");
    const ok = rows.filter((r) => !r.error && r.reply);
    const best = (k) => Math.min(...ok.map((r) => r[k]).filter(Number.isFinite));
    const mark = (r, k, s) => (ok.length > 1 && r[k] === best(k) ? `**${s}**` : s);
    const table = [
      `| model | first token | first sentence |${voice ? " first audio |" : ""} full reply | tok/s | $ per 1k replies |`,
      `|---|---|---|${voice ? "---|" : ""}---|---|---|`,
      ...rows.map((r) => r.error
        ? `| ${r.model}${hosted(r.model) ? " (Inworld-hosted)" : ""} | error: ${r.error.slice(0, 120)} | |${voice ? " |" : ""} | | |`
        : `| ${r.model}${hosted(r.model) ? " (Inworld-hosted)" : ""} | ${mark(r, "firstToken", ms(r.firstToken))} | ${ms(r.firstSentence)} |` +
          (voice ? ` ${mark(r, "firstAudio", ms(r.firstAudio))} |` : "") +
          ` ${ms(r.total)} | ${Number.isFinite(r.tokPerSec) ? Math.round(r.tokPerSec) : "n/a"} | ${Number.isFinite(r.costPer1k) ? "$" + r.costPer1k.toFixed(3) : "n/a"} |`),
    ].join("\n");
    const notes = [
      ...rows
        .filter((r) => !r.error && (!r.reply || r.reasoningTokens))
        .map((r) => `- ${r.model}: ${r.reply ? `${r.reasoningTokens} reasoning tokens despite effort=${r.effort ?? "default"}` : "returned no text (check max_tokens or reasoning)"}.`),
      ...rows.filter((r) => retiring(r.model)).map((r) => `- ${r.model} is being retired on ${retiring(r.model)}; don't move an app onto it.`),
    ];
    const replies = ok.map((r) => `- **${r.model}**${r.served && r.served !== r.model ? ` (served by ${r.served})` : ""}: "${r.reply.slice(0, 300)}${r.reply.length > 300 ? "…" : ""}"`);

    const intro =
      `Benchmarked ${rows.length} models through Inworld's router on the user's prompt, ${runs} run(s) each, medians, ` +
      `from this machine. ` +
      (voice ? `"First audio" is the full voice pipeline: the LLM streams, its first sentence goes to ${ttsModel} (${voice}) as soon as it's complete, and the clock stops at the first audio chunk. ` : "") +
      "Reasoning was set to each model's lowest effort (pass reasoning: \"default\" to keep it). Cost uses the router's list prices and the measured token counts.\n\n" +
      `${table}\n\n${notes.length ? `Notes:\n${notes.join("\n")}\n\n` : ""}Replies:\n${replies.join("\n")}`;

    if (!voice || args.listen === false || !ok.length) {
      return { content: [{ type: "text", text: intro }], structuredContent: { prompt, results: rows } };
    }
    // Speak each model's reply in the same voice so quality is judged by ear.
    const dir = await newClipDir();
    const clips = await Promise.all(
      ok.map(async (r, i) => {
        const audio = await synthesize(key, { text: r.reply.slice(0, 500), voiceId: voice, modelId: ttsModel });
        return { label: labels[i], id: r.model, audio, file: await saveClip(dir, labels[i], r.model, audio) };
      }),
    );
    const out = listenResult(
      clips,
      `${intro}\n\nEach reply is rendered in ${voice}.`,
      "Ask which reply sounds best, then weigh it against first-audio latency and cost. To switch, change only the " +
        "model string in the app's chat completion call (same endpoint and key).",
      { prompt, results: rows },
    );
    return out;
  }

  return { listModels, benchmark };
}
