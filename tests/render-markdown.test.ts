import test from "node:test";
import assert from "node:assert/strict";
import { renderEpubBookMarkdown, renderIndexMarkdown } from "../src/lib/render-markdown";
import type { Book, EpubAnnotation } from "../src/lib/types";

const demoBook: Book = {
  assetId: "ABCDEF0123456789",
  title: "Demo Book",
  author: "Author",
  publisher: "Publisher",
  path: "/tmp/demo.epub",
  format: "EPUB",
  annotationCount: 1,
};

test("renderIndexMarkdown includes key fields", () => {
  const output = renderIndexMarkdown([demoBook], new Date("2026-02-01T00:00:00Z"), "books");
  assert.match(output, /书名/);
  assert.match(output, /Demo Book/);
  assert.match(output, /EPUB/);
});

test("renderEpubBookMarkdown groups by chapter", () => {
  const annotations: EpubAnnotation[] = [
    {
      id: "a1",
      assetId: demoBook.assetId,
      chapterKey: "chapter-1.xhtml",
      selectedText: "Highlighted text",
      noteText: "My note",
      location: "epubcfi(/6/8[chapter-1.xhtml]!/4/2/1,:1,:5)",
      createdAt: new Date("2026-02-01T00:00:00Z"),
      kind: "highlight",
    },
  ];

  const output = renderEpubBookMarkdown(demoBook, annotations);
  assert.match(output, /章节：chapter-1.xhtml/);
  assert.match(output, /Highlighted text/);
  assert.match(output, /笔记: My note/);
});
