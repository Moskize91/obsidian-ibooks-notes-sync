const HYPHEN_CHARS = "-‐‑‒–—―";

const LEADING_KEEP_CHARS = new Set([
  "\"",
  "'",
  "“",
  "‘",
  "「",
  "『",
  "《",
  "〈",
  "【",
  "（",
  "(",
  "[",
  "{",
]);

const LEADING_REMOVE_CHARS = new Set([
  ".",
  ",",
  ";",
  ":",
  "!",
  "?",
  "。",
  "，",
  "；",
  "：",
  "！",
  "？",
  "、",
  "…",
]);

function stripLeadingPunctuation(text: string): string {
  let output = text;
  while (output.length > 0) {
    const char = output[0];
    if (char === undefined) {
      break;
    }
    if (LEADING_KEEP_CHARS.has(char)) {
      break;
    }
    if (LEADING_REMOVE_CHARS.has(char)) {
      output = output.slice(char.length).trimStart();
      continue;
    }
    break;
  }
  return output;
}

function compactChineseSpacing(text: string): string {
  let output = text;

  // Iterate until stable because a single pass may miss adjacent merges.
  while (true) {
    const before = output;

    // Remove spaces around common Chinese punctuation marks.
    output = output.replace(/\s+([，。！？；：、）〉》」』】〕”’])/gu, "$1");
    output = output.replace(/([（〈《「『【〔“‘])\s+/gu, "$1");
    output = output.replace(/([，。！？；：、])\s+/gu, "$1");

    // Remove spaces between CJK and CJK / Latin / digits.
    output = output.replace(/([\p{Script=Han}])\s+([\p{Script=Han}])/gu, "$1$2");
    output = output.replace(/([\p{Script=Han}])\s+([A-Za-z0-9])/gu, "$1$2");
    output = output.replace(/([A-Za-z0-9])\s+([\p{Script=Han}])/gu, "$1$2");

    if (output === before) {
      break;
    }
  }

  return output;
}

export function normalizeQuoteText(input: string): string {
  if (!input) {
    return "";
  }

  let output = input.replace(/\r\n?/g, "\n");

  // Join hyphenated Latin words across line breaks, e.g. "peop-\\nple" -> "people".
  output = output.replace(
    new RegExp(`([A-Za-z]+)[${HYPHEN_CHARS}]\\s*\\n\\s*([A-Za-z]+)`, "g"),
    "$1$2",
  );

  // General line merge: turn any remaining line breaks into single spaces.
  output = output.replace(/\s*\n\s*/g, " ");
  output = output.replace(/\s+/g, " ").trim();

  output = stripLeadingPunctuation(output);
  output = compactChineseSpacing(output);

  return output.trim();
}
