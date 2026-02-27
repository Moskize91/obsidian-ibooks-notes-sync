import test from "node:test";
import assert from "node:assert/strict";
import { pdfAnnotationLabel, shouldOverlayPdfAnnotationRect, sortPdfAnnotations } from "../src/lib/pdf";
import type { PdfAnnotation } from "../src/lib/types";

test("pdfAnnotationLabel prefers explicit contents", () => {
  const annotation: PdfAnnotation = {
    id: "a",
    pageNumber: 1,
    subtype: "Text",
    contents: "My page note",
    rect: null,
  };

  assert.equal(pdfAnnotationLabel(annotation), "My page note");
});

test("pdfAnnotationLabel falls back for highlight", () => {
  const annotation: PdfAnnotation = {
    id: "a",
    pageNumber: 1,
    subtype: "Highlight",
    contents: null,
    rect: null,
  };

  assert.equal(pdfAnnotationLabel(annotation), "高亮标注（无附注）");
});

test("sortPdfAnnotations places positioned annotations first", () => {
  const annotations: PdfAnnotation[] = [
    {
      id: "no-rect",
      pageNumber: 1,
      subtype: "Text",
      contents: null,
      rect: null,
    },
    {
      id: "rect",
      pageNumber: 1,
      subtype: "Highlight",
      contents: null,
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
    true,
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
      subtype: "Popup",
      rect: { x1: 10, y1: 10, x2: 20, y2: 20 },
    }),
    false,
  );
});
