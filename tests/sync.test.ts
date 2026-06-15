import test from "node:test";
import assert from "node:assert/strict";
import {
  getSyncPlanRegenerateReason,
  hasLegacyEpubInternalChapterHeadingContent,
  hasRenderablePdfPageAnnotations,
  resolveEffectiveChapterNotes,
  shouldDefaultChapterNotes,
  shouldForcePdfResync,
} from "../src/lib/sync";
import type { PdfPageAnnotations, SyncAssetState } from "../src/lib/types";

function buildAsset(assetId: string): SyncAssetState {
  return {
    assetId,
    title: assetId,
    format: "PDF",
    hash: "PDF|file:1:1|schema:30",
    lastSyncedAt: "2026-02-28T00:00:00.000Z",
    bookFileRelativePath: `books/${assetId}.md`,
    chapterFileRelativePaths: [],
    interactiveProperties: { sync_paused: false, chapter_notes: false },
    pdfAssetDirRelativePath: `assets/pdf/${assetId}`,
    coverImageRelativePath: `assets/covers/${assetId}.png`,
  };
}

test("shouldForcePdfResync returns true when prior state exists and assets root is missing", () => {
  const assets: Record<string, SyncAssetState> = {
    "asset-1": buildAsset("asset-1"),
  };
  assert.equal(shouldForcePdfResync(assets, false), true);
});

test("shouldForcePdfResync returns false when assets root exists", () => {
  const assets: Record<string, SyncAssetState> = {
    "asset-1": buildAsset("asset-1"),
  };
  assert.equal(shouldForcePdfResync(assets, true), false);
});

test("shouldForcePdfResync returns false when there is no prior sync state", () => {
  assert.equal(shouldForcePdfResync({}, false), false);
});

test("getSyncPlanRegenerateReason explains why an asset needs sync", () => {
  const previous: SyncAssetState = {
    assetId: "asset-1",
    title: "Book 1",
    format: "EPUB",
    hash: "EPUB|mod:1|schema:31",
    lastSyncedAt: "2026-02-28T00:00:00.000Z",
    bookFileRelativePath: "books/book-1.md",
    chapterFileRelativePaths: [],
    interactiveProperties: { sync_paused: false, chapter_notes: false },
    pdfAssetDirRelativePath: null,
    coverImageRelativePath: null,
  };

  assert.equal(
    getSyncPlanRegenerateReason(
      {
        format: "EPUB",
        hash: "EPUB|mod:1|schema:31",
        bookFileRelativePath: "books/book-1.md",
        interactiveProperties: { sync_paused: false, chapter_notes: false },
      },
      undefined,
    ),
    "new",
  );
  assert.equal(
    getSyncPlanRegenerateReason(
      {
        format: "PDF",
        hash: "EPUB|mod:1|schema:31",
        bookFileRelativePath: "books/book-1.md",
        interactiveProperties: { sync_paused: false, chapter_notes: false },
      },
      previous,
    ),
    "format-changed",
  );
  assert.equal(
    getSyncPlanRegenerateReason(
      {
        format: "EPUB",
        hash: "EPUB|mod:2|schema:31",
        bookFileRelativePath: "books/book-1.md",
        interactiveProperties: { sync_paused: false, chapter_notes: false },
      },
      previous,
    ),
    "content-changed",
  );
  assert.equal(
    getSyncPlanRegenerateReason(
      {
        format: "EPUB",
        hash: "EPUB|mod:1|schema:31",
        bookFileRelativePath: "books/book-renamed.md",
        interactiveProperties: { sync_paused: false, chapter_notes: false },
      },
      previous,
    ),
    "output-path-changed",
  );
  assert.equal(
    getSyncPlanRegenerateReason(
      {
        format: "EPUB",
        hash: "EPUB|mod:1|schema:31",
        bookFileRelativePath: "books/book-1.md",
        interactiveProperties: { sync_paused: false, chapter_notes: true },
      },
      previous,
    ),
    "properties-changed",
  );
  assert.equal(
    getSyncPlanRegenerateReason(
      {
        format: "EPUB",
        hash: "EPUB|mod:1|schema:31",
        bookFileRelativePath: "books/book-1.md",
        interactiveProperties: { sync_paused: true, chapter_notes: false },
      },
      previous,
    ),
    null,
  );
});

test("shouldDefaultChapterNotes enables chapter notes for first sync with many structured annotations", () => {
  assert.equal(shouldDefaultChapterNotes(25, true), false);
  assert.equal(shouldDefaultChapterNotes(26, true), true);
  assert.equal(shouldDefaultChapterNotes(26, false), false);
});

test("resolveEffectiveChapterNotes prefers existing property over first-sync default", () => {
  assert.equal(resolveEffectiveChapterNotes(false, false, true, 26, true), false);
  assert.equal(resolveEffectiveChapterNotes(true, false, true, 0, false), true);
  assert.equal(resolveEffectiveChapterNotes(false, false, false, 26, true), true);
  assert.equal(resolveEffectiveChapterNotes(false, true, false, 26, true), false);
});

test("hasLegacyEpubInternalChapterHeadingContent detects internal chapter headings", () => {
  assert.equal(hasLegacyEpubInternalChapterHeadingContent("# Book\n\n## doc10\n\n> quote"), true);
  assert.equal(hasLegacyEpubInternalChapterHeadingContent("# Book\n\n## chapter.xhtml\n\n> quote"), true);
  assert.equal(hasLegacyEpubInternalChapterHeadingContent("# Book\n\n## Introduction 导言\n\n> quote"), false);
});

test("hasRenderablePdfPageAnnotations detects PDF annotations with note content", () => {
  const pages: PdfPageAnnotations[] = [
    {
      pageNumber: 1,
      pageWidth: 100,
      pageHeight: 100,
      annotations: [
        {
          id: "empty",
          pageNumber: 1,
          subtype: "Popup",
          contents: null,
          selectedText: null,
          rect: null,
        },
        {
          id: "note",
          pageNumber: 1,
          subtype: "Text",
          contents: "A note",
          selectedText: null,
          rect: { x1: 10, y1: 10, x2: 20, y2: 20 },
        },
      ],
    },
  ];

  assert.equal(hasRenderablePdfPageAnnotations(pages), true);
});

test("hasRenderablePdfPageAnnotations ignores non-renderable PDF annotations", () => {
  const pages: PdfPageAnnotations[] = [
    {
      pageNumber: 1,
      pageWidth: 100,
      pageHeight: 100,
      annotations: [
        {
          id: "sound",
          pageNumber: 1,
          subtype: "Sound",
          contents: "Audio note",
          selectedText: null,
          rect: { x1: 10, y1: 10, x2: 20, y2: 20 },
        },
      ],
    },
  ];

  assert.equal(hasRenderablePdfPageAnnotations(pages), false);
});
