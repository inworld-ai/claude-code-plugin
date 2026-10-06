// LLM Router tools: map model ids from other providers onto the router's,
// read and save router configs, test which variant serves a request, and run
// decision questions. API-key based (the bundled CLI's router tools need an
// `inworld login` session instead).

const WRITE_FIX =
  "Turn on Router API write permission for the key in https://platform.inworld.ai/api-keys, or mint one from " +
  "the terminal with `npx -y -p @inworld/cli@latest inworld workspace add-key --name router --write`, select it " +
  "with `inworld workspace select-key`, and restart the agent session. Routers can also be created in Portal " +
  "(https://platform.inworld.ai) from the same JSON.";
const UPDATE_MASK = "display_name,defaults,routes,default_route";

export function createRouterTools({ apiBase, models }) {
  async function call(key, method, path, body) {
    const res = await fetch(apiBase + path, {
      method,
      headers: { Authorization: `Basic ${key}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 300) }; }
    return { status: res.status, ok: res.ok, json };
  }

  const routerId = (name) => String(name ?? "").trim().replace(/^inworld\//, "").replace(/^routers\//, "");

  // --- resolve_models -----------------------------------------------------

  const GENERIC = new Set(["chat", "instruct", "turbo", "free", "preview", "latest", "model", "beta", "online", "exp"]);

  const norm = (s) =>
    String(s).toLowerCase()
      .replace(/^(openrouter\/)/, "")
      .replace(/:(free|beta|nitro|floor|online|extended|thinking)$/, "")
      .replace(/-\d{8}$|-\d{4}-\d{2}-\d{2}$/, "")
      .replace(/[^a-z0-9]+/g, "");

  // Other providers' slugs (OpenRouter "anthropic/claude-3.5-sonnet", OpenAI
  // "gpt-4o-mini", Anthropic "claude-sonnet-4-5-20250929") don't always match
  // the router's provider/model ids; find the closest live ones.
  async function resolveModels(args, key) {
    const all = (await models(key)).filter((m) => m.isSupported !== false);
    const rows = [];
    for (const asked of (args.models ?? []).slice(0, 30)) {
      const a = String(asked).trim();
      const base = a.includes("/") ? a.split("/").slice(1).join("/") : a;
      const exact = all.filter((m) => `${m.provider}/${m.model}` === a);
      const sameModel = all.filter((m) => m.model === a || m.model === base || m.model.split("/").pop() === base.split("/").pop());
      const fuzzy = all
        .map((m) => {
          const n = norm(m.model.split("/").pop()), q = norm(base.split("/").pop());
          const score = n === q ? 3 : n.startsWith(q) || q.startsWith(n) ? 2 : n.includes(q) || q.includes(n) ? 1 : 0;
          return { m, score };
        })
        .filter((x) => x.score > 0)
        .sort((x, y) => y.score - x.score)
        .map((x) => x.m);
      let hits = [...new Map([...exact, ...sameModel, ...fuzzy].map((m) => [`${m.provider}/${m.model}`, m])).values()].slice(0, 4);
      // Retired or renamed model: offer current models from the same family
      // (e.g. claude-3.5-sonnet → today's Claude Sonnet models).
      let family = false;
      if (!hits.length) {
        const words = base.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !GENERIC.has(w));
        hits = all
          .filter((m) => words.length && words.every((w) => `${m.provider}/${m.model}`.toLowerCase().includes(w)))
          .filter((m) => !/:free$/.test(m.model))
          .sort((x, y) => y.model.localeCompare(x.model, undefined, { numeric: true }))
          .slice(0, 3);
        family = hits.length > 0;
      }
      rows.push({
        asked: a,
        status: exact.length ? "exact" : sameModel.length ? "same model" : family ? "same family, newer" : hits.length ? "closest" : "none",
        matches: hits.map((m) => ({
          id: `${m.provider}/${m.model}`,
          inPerM: +((m.pricing?.promptToken ?? 0) * 1e6).toFixed(3),
          outPerM: +((m.pricing?.completionToken ?? 0) * 1e6).toFixed(3),
          hosted: m.provider === "inworld",
        })),
      });
    }
    const lines = rows.map((r) =>
      `- ${r.asked} → ${r.matches.length
        ? r.matches.map((m) => `${m.id} ($${m.inPerM}/$${m.outPerM} per 1M${m.hosted ? ", Inworld-hosted" : ""})`).join("; ")
        : "no match on the router; pick a replacement with list_llm_models"} [${r.status}]`);
    return {
      content: [{
        type: "text",
        text:
          "Router ids for the models in the code (first match is the best guess; confirm anything marked " +
          `"closest" with the user, since versions can differ):\n${lines.join("\n")}\n\n` +
          "Send the full provider/model id. A bare model name (e.g. deepseek-v4-flash) also works and lets the " +
          "router pick the provider.",
      }],
      structuredContent: { results: rows },
    };
  }

  // --- get_router / save_router -------------------------------------------

  async function getRouter(args, key) {
    const id = routerId(args.name);
    const r = await call(key, "GET", id ? `/router/v1/routers/${encodeURIComponent(id)}` : "/router/v1/routers");
    if (r.status === 403) {
      return { isError: true, content: [{ type: "text", text: `This API key can't read routers (403). ${WRITE_FIX}` }] };
    }
    if (r.status === 404) return { content: [{ type: "text", text: `No router named "${id}" in this workspace.` }], structuredContent: { exists: false } };
    if (!r.ok) throw new Error(`Inworld router API ${r.status}: ${JSON.stringify(r.json).slice(0, 300)}`);
    return { content: [{ type: "text", text: JSON.stringify(r.json, null, 2) }], structuredContent: r.json };
  }

  function validate(router) {
    const problems = [];
    const name = routerId(router?.name);
    if (!name) problems.push("`name` is required (it becomes the model id inworld/<name>).");
    else if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) problems.push("`name` should be lowercase letters, digits and dashes.");
    const routes = [
      ...(router?.routes ?? []).map((r, i) => ({ where: `routes[${i}]`, route: r?.route, condition: r?.condition })),
      ...(router?.defaultRoute ? [{ where: "defaultRoute", route: router.defaultRoute }] : []),
    ];
    if (!routes.length) problems.push("Add a defaultRoute (and optionally conditional routes).");
    const routeIds = new Set();
    for (const { where, route, condition } of routes) {
      if (!route?.route_id) problems.push(`${where}: route_id is required.`);
      else if (routeIds.has(route.route_id)) problems.push(`${where}: route_id "${route.route_id}" is used twice.`);
      routeIds.add(route?.route_id);
      if (where !== "defaultRoute" && !condition?.cel_expression) problems.push(`${where}: conditional routes need condition.cel_expression.`);
      const variants = route?.variants ?? [];
      if (!variants.length) problems.push(`${where}: needs at least one variant.`);
      const sum = variants.reduce((s, v) => s + Number(v?.weight ?? 0), 0);
      if (variants.length && Math.abs(sum - 100) > 1e-9) problems.push(`${where}: variant weights sum to ${sum}; they must sum to exactly 100.`);
      const ids = new Set();
      for (const [j, v] of variants.entries()) {
        const vid = v?.variant?.variant_id;
        if (!vid) problems.push(`${where}.variants[${j}]: variant.variant_id is required.`);
        else if (ids.has(vid)) problems.push(`${where}: variant_id "${vid}" is used twice.`);
        ids.add(vid);
        if (!v?.variant?.model_id) problems.push(`${where}.variants[${j}]: variant.model_id is required (provider/model, a bare model name, or auto).`);
      }
    }
    return problems;
  }

  async function pollOperation(key, op) {
    for (let i = 0; i < 30 && op && !op.done && op.name; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const r = await call(key, "GET", `/lro/v1alpha/${op.name.split("/").map(encodeURIComponent).join("/")}`);
      if (!r.ok) break;
      op = r.json;
    }
    if (op?.error) throw new Error(`Router operation failed: ${JSON.stringify(op.error).slice(0, 300)}`);
    return op?.response ?? op;
  }

  async function saveRouter(args, key) {
    const router = args.router ?? {};
    const problems = validate(router);
    const id = routerId(router.name);
    const body = { ...router, name: id };
    const curl =
      `curl -X POST '${apiBase}/router/v1/routers' -H "Authorization: Basic $INWORLD_API_KEY" ` +
      `-H 'Content-Type: application/json' -d @router.json`;
    if (problems.length) {
      return { isError: true, content: [{ type: "text", text: `Router config needs fixes before saving:\n- ${problems.join("\n- ")}` }] };
    }
    if (args.dry_run) {
      return {
        content: [{ type: "text", text: `Valid. Router JSON (save as router.json):\n${JSON.stringify(body, null, 2)}\n\nCreate it with:\n${curl}\nThen call it with model "inworld/${id}".` }],
        structuredContent: body,
      };
    }
    const existing = await call(key, "GET", `/router/v1/routers/${encodeURIComponent(id)}`);
    const update = existing.ok;
    const r = update
      ? await call(key, "PATCH", `/router/v1/routers/${encodeURIComponent(id)}?update_mask=${encodeURIComponent(UPDATE_MASK)}`, body)
      : await call(key, "POST", "/router/v1/routers", body);
    if (r.status === 403 || existing.status === 403) {
      return {
        isError: true,
        content: [{ type: "text", text: `This API key can't save routers (403). ${WRITE_FIX}\n\nThe config is valid; here it is to save once the key can:\n${JSON.stringify(body, null, 2)}` }],
      };
    }
    if (!r.ok) throw new Error(`Inworld router API ${r.status}: ${JSON.stringify(r.json).slice(0, 400)}`);
    const saved = await pollOperation(key, r.json);
    return {
      content: [{
        type: "text",
        text: `${update ? "Updated" : "Created"} router "${id}". Call it with model "inworld/${id}" on /v1/chat/completions ` +
          `(or the Anthropic-compatible /v1/messages). Run test_router to check which variants serve requests.`,
      }],
      structuredContent: saved,
    };
  }

  // --- test_router ----------------------------------------------------------

  // Sends the same request several times and tallies who served it, so the
  // developer can see a split, a fallback or a conditional route working.
  async function testRouter(args, key) {
    // A bare name is a model when the catalog has it (provider routing),
    // otherwise a router name.
    const asked = String(args.model ?? "").trim();
    const bareModel = !asked.includes("/") && asked !== "auto" && (await models(key)).some((m) => m.model === asked);
    const model = asked.includes("/") || asked === "auto" || bareModel ? asked : `inworld/${routerId(asked)}`;
    const runs = Math.min(Math.max(args.runs ?? 6, 1), 20);
    const body = {
      model,
      messages: [...(args.system ? [{ role: "system", content: args.system }] : []), { role: "user", content: args.prompt || "Say hello in one short sentence." }],
      max_tokens: args.max_tokens ?? 60,
      ...(args.metadata ? { extra_body: { metadata: args.metadata } } : {}),
      ...(args.extra ?? {}),
    };
    if (args.user) body.user = args.user;
    const results = [];
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      const r = await call(key, "POST", "/v1/chat/completions", body);
      const ms = Math.round(performance.now() - t0);
      const attempts = r.json?.metadata?.attempts ?? [];
      results.push({
        ok: r.ok,
        ms,
        served: r.json?.model ?? null,
        attempts: attempts.map((a) => `${a.model}${a.success ? "" : " ✗"}`),
        reply: r.json?.choices?.[0]?.message?.content?.slice(0, 120) ?? null,
        error: r.ok ? null : (r.json?.error?.message ?? JSON.stringify(r.json)).slice(0, 200),
        meta: Object.fromEntries(Object.entries(r.json?.metadata ?? {}).filter(([k]) => /route|variant|reason/i.test(k))),
      });
    }
    const tally = {};
    for (const r of results) tally[r.ok ? r.served : `error: ${r.error}`] = (tally[r.ok ? r.served : `error: ${r.error}`] ?? 0) + 1;
    const fallbacks = results.filter((r) => r.attempts.length > 1).length;
    const lines = Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${k}: ${n}/${runs}`);
    const sample = results.find((r) => r.ok);
    return {
      content: [{
        type: "text",
        text:
          `Sent ${runs} request(s) to "${model}"${args.metadata ? ` with metadata ${JSON.stringify(args.metadata)}` : ""}` +
          `${args.user ? ` as user "${args.user}" (sticky variant)` : ""}.\nServed by:\n${lines.join("\n")}\n` +
          `${fallbacks ? `${fallbacks} request(s) fell back after a failed attempt.\n` : ""}` +
          `Median round trip ${median(results.map((r) => r.ms))} ms.` +
          (sample ? `\nExample attempts: ${sample.attempts.join(" → ") || sample.served}${Object.keys(sample.meta).length ? `; ${JSON.stringify(sample.meta)}` : ""}` : "") +
          "\nWeighted splits need more runs to show their ratio; pass `user` to check that one user always gets the same variant.",
      }],
      structuredContent: { model, results },
    };
  }

  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor((s.length - 1) / 2)] : 0;
  };

  // --- ask_decision -----------------------------------------------------------

  async function askDecision(args, key) {
    const body = {
      model: args.model || "typesafe/jev-latest",
      state: typeof args.state === "string" ? args.state : JSON.stringify(args.state ?? ""),
      questions: args.questions ?? {},
    };
    if (!Object.keys(body.questions).length) {
      return { isError: true, content: [{ type: "text", text: "ask_decision needs at least one question (noul, choice or score)." }] };
    }
    const r = await call(key, "POST", "/alpha/decisions", body);
    if (!r.ok) throw new Error(`Inworld decisions API ${r.status}: ${JSON.stringify(r.json).slice(0, 400)}`);
    const lines = Object.entries(r.json.answers ?? {}).map(([name, a]) => {
      if (a.type === "noul") return `- ${name} (noul): P(yes) = ${a.noul}`;
      if (a.type === "choice") return `- ${name} (choice): ${a.choice} (confidence ${a.confidence}; ${JSON.stringify(a.probabilities)})`;
      if (a.type === "score") return `- ${name} (score): ${a.score} (confidence ${a.confidence}; ${JSON.stringify(a.probabilities)})`;
      return `- ${name}: ${JSON.stringify(a)}`;
    });
    return {
      content: [{
        type: "text",
        text: `${r.json.model ?? body.model} answered (preview API; input tokens billed only):\n${lines.join("\n")}\n` +
          `Usage: ${JSON.stringify(r.json.usage ?? {})}. Gate on these numbers in code with named thresholds.`,
      }],
      structuredContent: r.json,
    };
  }

  return { resolveModels, getRouter, saveRouter, testRouter, askDecision };
}
