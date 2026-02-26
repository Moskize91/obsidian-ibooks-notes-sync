import test from "node:test";
import assert from "node:assert/strict";
import { extractChapterKey, sortEpubAnnotations } from "../src/lib/epub";
import type { EpubAnnotation } from "../src/lib/types";

test("extractChapterKey reads chapter id from epubcfi", () => {
  const chapter = extractChapterKey("epubcfi(/6/8[x_part02.xhtml]!/4/16/1,:18,:31)");
  assert.equal(chapter, "x_part02.xhtml");
});

test("extractChapterKey falls back when location is missing", () => {
  assert.equal(extractChapterKey(null), "未分章");
  assert.equal(extractChapterKey("invalid"), "未分章");
});

test("sortEpubAnnotations is stable by time/location/id", () => {
  const baseDate = new Date("2026-02-08T10:00:00Z");
  const annotations: EpubAnnotation[] = [
    {
      id: "b",
      assetId: "asset",
      chapterKey: "c1",
      selectedText: "B",
      noteText: null,
      location: "epubcfi(/6/8[x]!/4/2/1,:1,:2)",
      createdAt: baseDate,
      kind: "highlight",
    },
    {
      id: "a",
      assetId: "asset",
      chapterKey: "c1",
      selectedText: "A",
      noteText: null,
      location: "epubcfi(/6/8[x]!/4/2/1,:1,:2)",
      createdAt: baseDate,
      kind: "highlight",
    },
  ];

  const sorted = sortEpubAnnotations(annotations);
  assert.equal(sorted[0]?.id, "a");
  assert.equal(sorted[1]?.id, "b");
});
