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
  assert.match(output, /^---\n/m);
  assert.match(output, /title: "Demo Book"/);
  assert.match(output, /author: "Author"/);
  assert.match(output, /format: "EPUB"/);
  assert.match(output, /annotation_count: 1/);
  assert.match(output, /## chapter-1.xhtml/);
  assert.match(output, /\[2026-02-01 00:00:00\]\(<ibooks:\/\/assetid\/ABCDEF0123456789#epubcfi\(.*\)>\) Highlighted text/);
  assert.match(output, /\nMy note\n/);
  assert.doesNotMatch(output, /- 笔记:/);
});

test("renderEpubBookMarkdown maps internal chapter ids to 未分章", () => {
  const annotations: EpubAnnotation[] = [
    {
      id: "a1",
      assetId: demoBook.assetId,
      chapterKey: "id_11",
      selectedText: "A",
      noteText: null,
      location: "epubcfi(/6/22[id_11]!/4/2[chapter]/1:1)",
      createdAt: new Date("2026-02-01T00:00:00Z"),
      kind: "highlight",
    },
    {
      id: "a2",
      assetId: demoBook.assetId,
      chapterKey: "id_6",
      selectedText: "B",
      noteText: null,
      location: "epubcfi(/6/12[id_6]!/4/2[chapter]/1:1)",
      createdAt: new Date("2026-02-01T00:00:01Z"),
      kind: "highlight",
    },
  ];

  const output = renderEpubBookMarkdown(demoBook, annotations);
  assert.match(output, /## 未分章/);
  assert.doesNotMatch(output, /## id_11/);
  assert.doesNotMatch(output, /## id_6/);
});

test("renderEpubBookMarkdown normalizes quote whitespace and note blank edges", () => {
  const annotations: EpubAnnotation[] = [
    {
      id: "a1",
      assetId: demoBook.assetId,
      chapterKey: "chapter-1.xhtml",
      selectedText: "  line1 \n   line2\tline3  ",
      noteText: "\n\n  first line\n    second line\nthird line   \n\n",
      location: "epubcfi(/6/8[chapter-1.xhtml]!/4/2/1,:1,:5)",
      createdAt: new Date("2026-02-01T00:00:00Z"),
      kind: "highlight",
    },
  ];

  const output = renderEpubBookMarkdown(demoBook, annotations);
  assert.match(output, /> \[2026-02-01 00:00:00\]\(<ibooks:\/\/assetid\/ABCDEF0123456789#epubcfi\(.*\)>\) line1 line2 line3/);
  assert.match(output, /\n {2}first line\n {4}second line\nthird line\n/);
  assert.doesNotMatch(output, /\n\n\n {2}first line/);
  assert.doesNotMatch(output, /third line {3}/);
});

test("renderEpubBookMarkdown omits note block when note is empty", () => {
  const annotations: EpubAnnotation[] = [
    {
      id: "a1",
      assetId: demoBook.assetId,
      chapterKey: "chapter-1.xhtml",
      selectedText: "Only quote",
      noteText: " \n \n",
      location: "epubcfi(/6/8[chapter-1.xhtml]!/4/2/1,:1,:5)",
      createdAt: new Date("2026-02-01T00:00:00Z"),
      kind: "highlight",
    },
  ];

  const output = renderEpubBookMarkdown(demoBook, annotations);
  assert.match(output, /Only quote/);
  assert.doesNotMatch(output, /笔记:/);
});

test("renderEpubBookMarkdown collapses multi-paragraph selected text into one quote line", () => {
  const annotations: EpubAnnotation[] = [
    {
      id: "a1",
      assetId: demoBook.assetId,
      chapterKey: "chapter-1.xhtml",
      selectedText: "钱宝琮得到结论：\n\n余考《周髀》所详天体论。",
      noteText: null,
      location: "epubcfi(/6/8[chapter-1.xhtml]!/4/2/1,:1,:5)",
      createdAt: new Date("2026-02-01T00:00:00Z"),
      kind: "highlight",
    },
  ];

  const output = renderEpubBookMarkdown(demoBook, annotations);
  assert.match(
    output,
    /> \[2026-02-01 00:00:00\]\(<ibooks:\/\/assetid\/ABCDEF0123456789#epubcfi\(.*\)>\) 钱宝琮得到结论： 余考《周髀》所详天体论。/,
  );
  assert.doesNotMatch(output, /钱宝琮得到结论：:/);
  assert.doesNotMatch(output, /\n余考《周髀》所详天体论。\n/);
});

test("renderEpubBookMarkdown keeps single separator between entries", () => {
  const annotations: EpubAnnotation[] = [
    {
      id: "a1",
      assetId: demoBook.assetId,
      chapterKey: "chapter-1.xhtml",
      selectedText: "First",
      noteText: null,
      location: "epubcfi(/6/8[chapter-1.xhtml]!/4/2/1,:1,:5)",
      createdAt: new Date("2026-02-01T00:00:00Z"),
      kind: "highlight",
    },
    {
      id: "a2",
      assetId: demoBook.assetId,
      chapterKey: "chapter-1.xhtml",
      selectedText: "Second",
      noteText: null,
      location: "epubcfi(/6/8[chapter-1.xhtml]!/4/2/1,:6,:10)",
      createdAt: new Date("2026-02-01T00:00:01Z"),
      kind: "highlight",
    },
  ];

  const output = renderEpubBookMarkdown(demoBook, annotations);
  assert.doesNotMatch(output, /---\n\n---/);
  assert.match(output, /First/);
  assert.match(output, /Second/);
});
