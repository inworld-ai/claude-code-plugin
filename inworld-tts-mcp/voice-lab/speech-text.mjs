// Checks text before it goes to Inworld TTS: finds the things that make a voice
// app sound wrong in production (IDs read as words, markdown read aloud, tags the
// model ignores) and returns a fixed copy. Pure and offline, so it runs without a key.
//
// Rules follow docs.inworld.ai/tts/capabilities/{verbatim,steering,pause-controls,
// custom-pronunciation} and tts/best-practices/generating-speech.

const NON_VERBALS = new Set(
  (
    "breathe sigh gasp pant huff grunt groan moan laugh chuckle giggle cackle snort scoff cry sob wail " +
    "whimper whine sniffle sniff shriek squeal howl clearthroat cough sneeze hiccup yawn burp snore choke " +
    "gag swallow gulp spit tongueclick mouthclick mouthsound lipsmack kiss shush raspberry whistle bleh " +
    "chew slurp babble beatbox growl"
  ).split(" "),
);
// Describe how words are spoken, so they persist like any instruction.
const PERSISTENT_STYLES = new Set(["shout", "scream", "sing", "hum", "mumble", "whisper"]);
const VERBATIM_OK = /^[A-Za-z0-9 ()\-#:.,+@/_*]+$/;
const IPA_CHARS = /[ɪəʊæɑɔʃʒθðŋːˈˌɛʌɜɒɐɾʔ]/;

function soundKey(tag) {
  return tag.toLowerCase().replace(/[^a-z]/g, "").replace(/(s|es|ing|ed)$/, "");
}

function isNonVerbal(tag) {
  const k = soundKey(tag);
  if (NON_VERBALS.has(k) || NON_VERBALS.has(tag.toLowerCase().replace(/[^a-z]/g, ""))) return true;
  return k === "throatclear" || k === "throatclearing" || k === "clearsthroat";
}

// Spans already protected from rewriting: existing tags, IPA, URLs, emails.
function protectedRanges(text) {
  const ranges = [];
  const add = (re) => {
    for (const m of text.matchAll(re)) ranges.push([m.index, m.index + m[0].length]);
  };
  add(/<verbatim>[\s\S]*?<\/verbatim>/gi);
  add(/<say-as[^>]*>[\s\S]*?<\/say-as>/gi);
  add(/<[^>]+>/g);
  add(/\[[^\]]*\]/g);
  add(/\/[^/\s]+\//g);
  add(/\bhttps?:\/\/\S+/gi);
  add(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g);
  return ranges;
}

const inside = (ranges, i) => ranges.some(([a, b]) => i >= a && i < b);

export function checkSpeechText(input, { model = "inworld-tts-2", normalization = "default" } = {}) {
  const issues = [];
  let text = String(input ?? "");
  const flash = /flash/.test(model);
  const note = (severity, rule, message, fix) => issues.push({ severity, rule, message, ...(fix ? { fix } : {}) });

  // 1. Markdown and emoji: LLM output is often formatted for a screen.
  const before = text;
  text = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|[.,!?]|$)/g, "$1$2")
    .replace(/\p{Extended_Pictographic}️?/gu, "")
    .replace(/[ \t]{2,}/g, " ");
  if (text !== before) {
    note("fix", "markdown", "Removed markdown/emoji: TTS reads symbols aloud or garbles them. Strip formatting from LLM output before synthesis, or tell the LLM to answer in plain spoken text.");
  }

  // 2. Alphanumeric identifiers → <verbatim>.
  if (normalization === "off") {
    if (/<verbatim>|interpret-as="verbatim"/i.test(text)) {
      note("error", "verbatim-needs-normalization", "applyTextNormalization is OFF, so <verbatim> tags are removed and their content is read as normal text. Turn normalization on (or unset) for requests that carry IDs, or spell the characters out yourself.");
    }
  }
  const prot = protectedRanges(text);
  const wrapped = [];
  text = text.replace(/(?<![\w/@.-])(?=[A-Za-z0-9-]*\d)(?=[A-Za-z0-9-]*[A-Za-z])[A-Za-z0-9][A-Za-z0-9-]{3,}(?![\w/@-])/g, (tok, offset) => {
    if (inside(prot, offset)) return tok;
    if (/^\d+(st|nd|rd|th|s|am|pm|k|m|kg|km|ms|mb|gb|hz|x)$/i.test(tok)) return tok; // 21st, 1990s, 5pm, 10ms
    if (/^[a-z]+\d$/i.test(tok) && tok.length <= 5) return tok; // mp3, gpt4
    wrapped.push(tok);
    return `<verbatim>${tok}</verbatim>`;
  });
  text = text.replace(/(?<![\w.,$£€-])\d{6,}(?![\w.,])/g, (tok, offset) => {
    if (inside(protectedRanges(text), offset)) return tok;
    wrapped.push(tok);
    return `<verbatim>${tok}</verbatim>`;
  });
  if (wrapped.length) {
    note("fix", "verbatim", `Wrapped ${wrapped.map((w) => `"${w}"`).join(", ")} in <verbatim> so each character is read out (otherwise the model may read it as a word or one big number). Most reliable on inworld-tts-2.`);
  }
  for (const m of text.matchAll(/<verbatim>([\s\S]*?)<\/verbatim>/gi)) {
    if (!VERBATIM_OK.test(m[1])) {
      note("warn", "verbatim-chars", `<verbatim>${m[1]}</verbatim> contains characters outside letters, digits, spaces and ( ) - # : . , + @ / _ *, so it may be read as regular text.`);
    }
  }

  // 3. Ambiguous dates.
  for (const m of text.matchAll(/\b(0?[1-9]|1[0-2])\/(0?[1-9]|1[0-2])\/(\d{2}|\d{4})\b/g)) {
    note("warn", "ambiguous-date", `"${m[0]}" could be read as month/day or day/month. Write it the way it should be spoken, e.g. "March fourth".`);
  }

  // 4. Steering tags and non-verbals.
  const tags = [...text.matchAll(/\[([^\]]+)\]/g)].map((m) => ({ raw: m[0], body: m[1].trim(), index: m.index }));
  const instructions = tags.filter((t) => !isNonVerbal(t.body) && t.body.toLowerCase() !== "reset");
  if (flash && instructions.length) {
    note("warn", "flash-steering", `inworld-tts-2-flash ignores steering instructions (${instructions.map((t) => t.raw).join(" ")}). Use inworld-tts-2 for steering; non-verbals like [laugh] still work on Flash.`);
  }
  for (const t of instructions) {
    const word = t.body.toLowerCase().split(/\s+/)[0];
    const after = text.slice(t.index + t.raw.length);
    const sentencesAfter = after.split(/(?<=[.!?])\s+/).filter((s) => s.trim()).length;
    const resetAfter = /\[\s*reset\s*\]/i.test(after);
    if (!resetAfter && sentencesAfter > 1 && (PERSISTENT_STYLES.has(word) || t.body.split(/\s+/).length <= 2)) {
      note("info", "steering-scope", `${t.raw} applies to everything after it, not just the next sentence. Add [reset] where normal delivery should resume.`);
    }
    if (/[A-Z]/.test(t.body) && t.body !== t.body.toUpperCase()) {
      note("info", "steering-style", `Steering works best in lowercase English without punctuation: ${t.raw} → [${t.body.toLowerCase().replace(/[^\w\s]/g, "")}].`);
    }
  }

  // 5. Pauses.
  const breaks = [...text.matchAll(/<break\b[^>]*>/gi)];
  if (breaks.length > 20) note("warn", "break-count", `${breaks.length} <break> tags: only the first 20 per request are used.`);
  for (const b of breaks) {
    const t = /time\s*=\s*"(\d+(?:\.\d+)?)(ms|s)"/i.exec(b[0]);
    if (!t) note("error", "break-format", `${b[0]} isn't a valid break. Use <break time="500ms" /> or <break time="1s" />.`);
    else if ((t[2].toLowerCase() === "s" ? +t[1] * 1000 : +t[1]) > 10000) note("warn", "break-length", `${b[0]} is longer than the 10 s maximum.`);
    if (!/\/>$/.test(b[0])) note("warn", "break-format", `${b[0]} should be self-closing: <break time="..." />.`);
  }

  // 6. Pronunciation.
  if (/<phoneme\b/i.test(text)) {
    note("error", "phoneme-tag", "SSML <phoneme> isn't supported. Replace the word with its English IPA between slashes, one word at a time: /kriːt/.");
  }
  for (const m of text.matchAll(/\/([^/\n]{2,80})\//g)) {
    if (IPA_CHARS.test(m[1]) && /\s/.test(m[1].trim())) {
      note("warn", "ipa-multiword", `/${m[1]}/ wraps several words. Inline IPA replaces one word per pair of slashes.`);
    }
  }

  // 7. Other SSML the API doesn't document.
  for (const m of text.matchAll(/<(speak|prosody|emphasis|sub|audio|voice|p|s|lang)\b[^>]*>/gi)) {
    note("warn", "unsupported-ssml", `<${m[1]}> isn't a documented Inworld tag and may be read aloud. Supported: <break />, <verbatim>, and [steering] tags.`);
  }

  return { text: text.trim(), changed: text.trim() !== String(input ?? "").trim(), issues };
}
