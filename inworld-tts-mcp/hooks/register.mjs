// Claude Code mod: native play buttons under the voice lab's listening results
// (compare_voices, find_voices, design_voice, check_speech_text,
// benchmark_models), in the
// terminal and the desktop app. Each button plays its clip with
// $.audio.play (the platform player), so no shell command shows in the
// transcript; "Use" sends the pick back as the user's own message.
//
// The tool's text result lists one clip per line: "A: Ashley → /path/voice-A-Ashley.mp3".

const CLIP_LINE = /^([A-H]): (\S+) → (\S+\.mp3)\s*$/gm;

// What "Use" sends back as the user's message, and the heading, per tool.
const TOOLS = {
  compare_voices: { title: "Inworld voices", use: (c) => `Use voice ${c.label} (${c.voiceId}) for this project.` },
  find_voices: { title: "Inworld voices", use: (c) => `Use voice ${c.label} (${c.voiceId}) for this project.` },
  design_voice: { title: "Designed voices", use: (c) => `Save voice ${c.label} (${c.voiceId}) and use it for this project.` },
  benchmark_models: { title: "Replies by model", use: (c) => `Use ${c.voiceId} (${c.label}) as the LLM for this app.` },
  check_speech_text: { title: "Before / after", use: (c) => `Go with the ${c.voiceId} version (${c.label}) of the text.` },
};

const toolOf = (name) => Object.keys(TOOLS).find((t) => name.endsWith("__" + t));

// Pull the text out of whatever shape the stored MCP result takes.
function resultText(output) {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return output.map(resultText).join("\n");
  if (output && typeof output === "object") {
    if (typeof output.text === "string") return output.text;
    if (Array.isArray(output.content)) return resultText(output.content);
  }
  return "";
}

function clipsFrom(output) {
  return [...resultText(output).matchAll(CLIP_LINE)].map(([, label, voiceId, file]) => ({ label, voiceId, file }));
}

let stopCurrent = null;

async function play($, clip) {
  stopCurrent?.abort();
  const controller = new AbortController();
  stopCurrent = controller;
  const { base64 } = await $.fs.read(clip.file, { as: "bytes" });
  await $.audio.play({ base64, mime: "audio/mpeg" }, { signal: controller.signal });
  if (stopCurrent === controller) stopCurrent = null;
}

export function register(on) {
  on("ui.render", { component: "ToolResult" }, async ($, e, next) => {
    const tool = toolOf(String(e.props?.tool ?? ""));
    if (!tool || e.props.isErrored) return next(e);
    const clips = clipsFrom(e.props.output);
    if (!clips.length) return next(e);

    const { Box, Button, Text } = $.ui.resolve(e);
    const theirs = await next(e);
    const toast = (message) => $.ui.toast(message);

    const rows = clips.map((clip) =>
      Box({
        key: "row-" + clip.label,
        flexDirection: "row",
        columnGap: 2,
        children: [
          Button({
            key: "play-" + clip.label,
            label: `▶ ${clip.label} · ${clip.voiceId}`,
            onPress: () => play($, clip).catch((err) => toast(`Couldn't play ${clip.label}: ${err.message}`)),
          }),
          Button({
            key: "use-" + clip.label,
            label: `Use ${clip.label}`,
            plain: true,
            dimColor: true,
            onPress: () =>
              $.prompt.submit({ text: TOOLS[tool].use(clip), asUser: true }),
          }),
        ],
      }),
    );

    const playAll = Button({
      key: "play-all",
      label: "▶ Play all",
      onPress: async () => {
        try {
          for (const clip of clips) await play($, clip);
        } catch (err) {
          toast(`Playback stopped: ${err.message}`);
        }
      },
    });
    const stop = Button({
      key: "stop",
      label: "■ Stop",
      plain: true,
      onPress: () => stopCurrent?.abort(),
    });

    return Box({
      flexDirection: "column",
      children: [
        theirs,
        Text({ dimColor: true, children: [TOOLS[tool].title] }),
        ...rows,
        Box({ key: "controls", flexDirection: "row", columnGap: 2, children: [playAll, stop] }),
      ],
    });
  });
}
