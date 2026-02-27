import test from "node:test";
import assert from "node:assert/strict";
import { normalizeQuoteText } from "../src/lib/quote-normalize";

test("normalizeQuoteText compacts spaces for Chinese text", () => {
  const input = "。 农姑 亦 无 铀香 ， 所 种 之 地 ， 惟 以 刀 伐 木";
  const output = normalizeQuoteText(input);
  assert.equal(output, "农姑亦无铀香，所种之地，惟以刀伐木");
});

test("normalizeQuoteText joins hyphenated latin words across lines", () => {
  const input = "Some peo-\n  ple are here";
  const output = normalizeQuoteText(input);
  assert.equal(output, "Some people are here");
});

test("normalizeQuoteText removes leading punctuation but keeps opening quotes", () => {
  assert.equal(normalizeQuoteText("。 ， “Hello” world"), "“Hello” world");
  assert.equal(normalizeQuoteText("“Hello” world"), "“Hello” world");
});
