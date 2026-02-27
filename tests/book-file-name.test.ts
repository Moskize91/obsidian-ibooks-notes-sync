import test from "node:test";
import assert from "node:assert/strict";
import { buildBookFileRelativePathByAssetId, toShortBookFileStem } from "../src/lib/book-file-name";
import type { Book } from "../src/lib/types";

function makeBook(assetId: string, title: string): Book & { format: "EPUB" } {
  return {
    assetId,
    title,
    author: null,
    publisher: null,
    path: null,
    format: "EPUB",
    annotationCount: 1,
  };
}

test("toShortBookFileStem truncates to 40 chars", () => {
  const input = "1234567890123456789012345678901234567890abcdef";
  const stem = toShortBookFileStem(input);
  assert.equal(stem.length, 40);
  assert.equal(stem, "1234567890123456789012345678901234567890");
});

test("buildBookFileRelativePathByAssetId adds numeric suffix for collisions", () => {
  const books = [
    makeBook("BBBBBBBB11111111", "Same Title"),
    makeBook("AAAAAAAA22222222", "Same Title"),
    makeBook("CCCCCCCC33333333", "Another"),
  ];
  const hasOutput = new Map<string, boolean>([
    ["BBBBBBBB11111111", true],
    ["AAAAAAAA22222222", true],
    ["CCCCCCCC33333333", true],
  ]);

  const mapping = buildBookFileRelativePathByAssetId(books, hasOutput, "books");
  assert.equal(mapping.get("AAAAAAAA22222222"), "books/Same Title.md");
  assert.equal(mapping.get("BBBBBBBB11111111"), "books/Same Title_2.md");
  assert.equal(mapping.get("CCCCCCCC33333333"), "books/Another.md");
});

test("buildBookFileRelativePathByAssetId returns null when book should not output", () => {
  const books = [makeBook("AAAAAAAA22222222", "No Output Book")];
  const hasOutput = new Map<string, boolean>([["AAAAAAAA22222222", false]]);
  const mapping = buildBookFileRelativePathByAssetId(books, hasOutput, "books");
  assert.equal(mapping.get("AAAAAAAA22222222"), null);
});
