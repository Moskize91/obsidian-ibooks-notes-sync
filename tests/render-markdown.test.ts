import test from "node:test";
import assert from "node:assert/strict";
import { renderEpubBookMarkdown, renderIndexMarkdown, renderPdfBookMarkdown } from "../src/lib/render-markdown";
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

test("renderPdfBookMarkdown renders single text note directly", () => {
  const pdfBook: Book = {
    ...demoBook,
    format: "PDF",
  };
  const output = renderPdfBookMarkdown(pdfBook, [
    {
      pageNumber: 8,
      imageRelativePath: "assets/pdf/asset-id/page-8.png",
      notes: [
        {
          marker: null,
          text: "单条笔记内容",
          hasRect: true,
        },
      ],
    },
  ]);

  assert.doesNotMatch(output, /## 页面标注/);
  assert.doesNotMatch(output, /### 第 8 页/);
  assert.match(output, /---/);
  assert.match(output, /> !\[第8页\]\(\.\.\/assets\/pdf\/asset-id\/page-8\.png\) 第 8 页/);
  assert.match(output, /\n单条笔记内容\n/);
  assert.doesNotMatch(output, /\*\*标注/);
  const imageIndex = output.indexOf("> ![第8页]");
  const noteIndex = output.indexOf("单条笔记内容");
  assert.notEqual(imageIndex, -1);
  assert.notEqual(noteIndex, -1);
  assert.ok(imageIndex < noteIndex);
  assert.doesNotMatch(output, /\n!\[第8页\]/);
});

test("renderPdfBookMarkdown renders multiple notes with markers and separators", () => {
  const pdfBook: Book = {
    ...demoBook,
    format: "PDF",
  };
  const output = renderPdfBookMarkdown(pdfBook, [
    {
      pageNumber: 12,
      imageRelativePath: "assets/pdf/asset-id/page-12.png",
      notes: [
        {
          marker: "①",
          text: "第一条",
          hasRect: true,
        },
        {
          marker: "②",
          text: "第二条",
          hasRect: false,
        },
      ],
    },
  ]);

  assert.match(output, /\*\*标注 ①\*\*/);
  assert.match(output, /\*\*标注 ②\*\*（无定位）/);
  assert.match(output, /\n---\n\n\*\*标注 ②\*\*/);
  assert.match(output, /第一条/);
  assert.match(output, /第二条/);
});

test("renderEpubBookMarkdown uses chapter spine order instead of title sort", () => {
  const annotations: EpubAnnotation[] = [
    {
      id: "a1",
      assetId: demoBook.assetId,
      chapterKey: "id_7",
      selectedText: "From chapter 7",
      noteText: null,
      location: "epubcfi(/6/14[id_7]!/4/2[chapter]/10/1,:1,:5)",
      createdAt: new Date("2026-02-01T00:00:01Z"),
      kind: "highlight",
    },
    {
      id: "a2",
      assetId: demoBook.assetId,
      chapterKey: "id_6",
      selectedText: "From chapter 6",
      noteText: null,
      location: "epubcfi(/6/12[id_6]!/4/2[chapter]/10/1,:1,:5)",
      createdAt: new Date("2026-02-01T00:00:00Z"),
      kind: "highlight",
    },
  ];

  const output = renderEpubBookMarkdown(
    demoBook,
    annotations,
    new Map([
      ["id_6", "新版前言"],
      ["id_7", "《周髀算经》新论"],
    ]),
    new Map([
      ["id_6", 5],
      ["id_7", 6],
    ]),
  );

  const chapter6Index = output.indexOf("## 新版前言");
  const chapter7Index = output.indexOf("## 《周髀算经》新论");
  assert.notEqual(chapter6Index, -1);
  assert.notEqual(chapter7Index, -1);
  assert.ok(chapter6Index < chapter7Index);
});

test("renderEpubBookMarkdown uses cfi position order inside chapter", () => {
  const annotations: EpubAnnotation[] = [
    {
      id: "late-created-but-early-position",
      assetId: demoBook.assetId,
      chapterKey: "id_7",
      selectedText: "Position 66",
      noteText: null,
      location: "epubcfi(/6/14[id_7]!/4/2[chapter],/66/1:6,/68/2/3:4)",
      createdAt: new Date("2026-02-01T00:00:10Z"),
      kind: "highlight",
    },
    {
      id: "early-created-but-late-position",
      assetId: demoBook.assetId,
      chapterKey: "id_7",
      selectedText: "Position 206",
      noteText: null,
      location: "epubcfi(/6/14[id_7]!/4/2[chapter]/206/1,:0,:47)",
      createdAt: new Date("2026-02-01T00:00:00Z"),
      kind: "highlight",
    },
  ];

  const output = renderEpubBookMarkdown(
    demoBook,
    annotations,
    new Map([["id_7", "《周髀算经》新论"]]),
    new Map([["id_7", 6]]),
  );

  const pos66Index = output.indexOf("Position 66");
  const pos206Index = output.indexOf("Position 206");
  assert.notEqual(pos66Index, -1);
  assert.notEqual(pos206Index, -1);
  assert.ok(pos66Index < pos206Index);
});
