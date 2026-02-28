import test from "node:test";
import assert from "node:assert/strict";
import {
  detectPdfRendererAvailability,
  extractPdfQuoteContent,
  extractPdfUserNoteContent,
  normalizePdfNoteText,
  resolvePdfRenderBackend,
  shouldOverlayPdfAnnotationRect,
  sortPdfAnnotations,
  toPdfNoteMarker,
} from "../src/lib/pdf";
import type { PdfAnnotation } from "../src/lib/types";

test("normalizePdfNoteText trims blank edges and keeps indentation", () => {
  const output = normalizePdfNoteText("\n\n  first\n    second\nthird   \n\n");
  assert.equal(output, "  first\n    second\nthird");
});

test("extractPdfUserNoteContent keeps text annotations and drops sound annotations", () => {
  const annotation: PdfAnnotation = {
    id: "a",
    pageNumber: 1,
    subtype: "Text",
    contents: "My page note\n",
    selectedText: null,
    rect: null,
  };
  const soundAnnotation: PdfAnnotation = {
    id: "b",
    pageNumber: 1,
    subtype: "Sound",
    contents: "should be ignored",
    selectedText: null,
    rect: null,
  };

  assert.equal(extractPdfUserNoteContent(annotation), "My page note");
  assert.equal(extractPdfUserNoteContent(soundAnnotation), "");
});

test("extractPdfQuoteContent returns normalized selected text", () => {
  const annotation: PdfAnnotation = {
    id: "q",
    pageNumber: 1,
    subtype: "Highlight",
    contents: null,
    selectedText: " quote\ntext  ",
    rect: null,
  };
  assert.equal(extractPdfQuoteContent(annotation), "quote text");
});

test("toPdfNoteMarker uses circled markers and falls back after 50", () => {
  assert.equal(toPdfNoteMarker(1), "①");
  assert.equal(toPdfNoteMarker(20), "⑳");
  assert.equal(toPdfNoteMarker(21), "㉑");
  assert.equal(toPdfNoteMarker(36), "㊱");
  assert.equal(toPdfNoteMarker(50), "㊿");
  assert.equal(toPdfNoteMarker(51), "[51]");
});

test("sortPdfAnnotations places positioned annotations first", () => {
  const annotations: PdfAnnotation[] = [
    {
      id: "no-rect",
      pageNumber: 1,
      subtype: "Text",
      contents: null,
      selectedText: null,
      rect: null,
    },
    {
      id: "rect",
      pageNumber: 1,
      subtype: "Highlight",
      contents: null,
      selectedText: null,
      rect: { x1: 10, y1: 10, x2: 20, y2: 20 },
    },
  ];

  const sorted = sortPdfAnnotations(annotations);
  assert.equal(sorted[0]?.id, "rect");
  assert.equal(sorted[1]?.id, "no-rect");
});

test("shouldOverlayPdfAnnotationRect only allows area annotations", () => {
  assert.equal(
    shouldOverlayPdfAnnotationRect({
      subtype: "Highlight",
      rect: { x1: 10, y1: 10, x2: 20, y2: 20 },
    }),
    false,
  );
  assert.equal(
    shouldOverlayPdfAnnotationRect({
      subtype: "Text",
      rect: { x1: 10, y1: 10, x2: 20, y2: 20 },
    }),
    false,
  );
  assert.equal(
    shouldOverlayPdfAnnotationRect({
      subtype: "Square",
      rect: { x1: 10, y1: 10, x2: 20, y2: 20 },
    }),
    true,
  );
  assert.equal(
    shouldOverlayPdfAnnotationRect({
      subtype: "Popup",
      rect: { x1: 10, y1: 10, x2: 20, y2: 20 },
    }),
    false,
  );
});

test("resolvePdfRenderBackend uses mutool first in auto mode", () => {
  const backend = resolvePdfRenderBackend("auto", {
    mutool: true,
    poppler: true,
  });
  assert.equal(backend, "mutool");
});

test("resolvePdfRenderBackend falls back to poppler then swift in auto mode", () => {
  const popplerBackend = resolvePdfRenderBackend("auto", {
    mutool: false,
    poppler: true,
  });
  const swiftBackend = resolvePdfRenderBackend("auto", {
    mutool: false,
    poppler: false,
  });
  assert.equal(popplerBackend, "poppler");
  assert.equal(swiftBackend, "swift");
});

test("resolvePdfRenderBackend rejects unavailable explicit renderer", () => {
  assert.throws(
    () => {
      resolvePdfRenderBackend("mutool", {
        mutool: false,
        poppler: true,
      });
    },
    /brew install mupdf-tools/,
  );
  assert.throws(
    () => {
      resolvePdfRenderBackend("poppler", {
        mutool: true,
        poppler: false,
      });
    },
    /brew install poppler/,
  );
});

test("detectPdfRendererAvailability returns booleans", () => {
  const availability = detectPdfRendererAvailability();
  assert.equal(typeof availability.mutool, "boolean");
  assert.equal(typeof availability.poppler, "boolean");
});
