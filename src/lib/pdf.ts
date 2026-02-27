import { execFileSync } from "node:child_process";
import path from "node:path";
import sharp from "sharp";
import type { PdfAnnotation, PdfPageAnnotations, Rect } from "./types";
import { normalizeQuoteText } from "./quote-normalize";

type PdfJsAnnotation = {
  id?: string;
  subtype?: string;
  contents?: string;
  contentsObj?: { str?: string };
  rect?: number[];
  popupRef?: string;
  quadPoints?: ArrayLike<number>;
};

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfOverlayAnnotation = {
  marker: string | null;
  rect: Rect;
  drawRect: boolean;
};
type PdfPageTextItem = {
  str: string;
  rect: Rect;
};

let cachedPdfJsModule: PdfJsModule | null = null;
const NON_TEXT_PDF_SUBTYPES = new Set([
  "sound",
  "popup",
  "link",
  "movie",
  "fileattachment",
  "screen",
  "widget",
  "3d",
  "richmedia",
]);

async function getPdfJsModule(): Promise<PdfJsModule> {
  if (cachedPdfJsModule) {
    return cachedPdfJsModule;
  }

  cachedPdfJsModule = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as PdfJsModule;
  return cachedPdfJsModule;
}

function toRect(input: number[] | undefined): Rect | null {
  if (!input || input.length < 4) {
    return null;
  }

  return {
    x1: Number(input[0]),
    y1: Number(input[1]),
    x2: Number(input[2]),
    y2: Number(input[3]),
  };
}

function normalizeSubtype(subtype: string | undefined): string {
  if (!subtype) {
    return "Unknown";
  }
  return subtype;
}

function normalizeText(input: string | undefined): string | null {
  if (!input) {
    return null;
  }
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function trimBlankEdges(input: string): string {
  const lines = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let start = 0;
  while (start < lines.length) {
    const line = lines[start];
    if (line === undefined || line.trim() !== "") {
      break;
    }
    start += 1;
  }

  let end = lines.length;
  while (end > start) {
    const line = lines[end - 1];
    if (line === undefined || line.trim() !== "") {
      break;
    }
    end -= 1;
  }

  if (start >= end) {
    return "";
  }
  return lines.slice(start, end).join("\n");
}

export function normalizePdfNoteText(noteText: string): string {
  const trimmed = trimBlankEdges(noteText);
  if (!trimmed) {
    return "";
  }
  const kept = trimmed.split("\n");
  const lastLine = kept[kept.length - 1];
  if (lastLine === undefined) {
    return "";
  }
  kept[kept.length - 1] = lastLine.replace(/\s+$/g, "");
  return kept.join("\n");
}

export function extractPdfUserNoteContent(annotation: Pick<PdfAnnotation, "subtype" | "contents">): string {
  const subtype = annotation.subtype.toLowerCase();
  if (NON_TEXT_PDF_SUBTYPES.has(subtype)) {
    return "";
  }
  if (!annotation.contents) {
    return "";
  }
  return normalizePdfNoteText(annotation.contents);
}

export function extractPdfQuoteContent(annotation: Pick<PdfAnnotation, "selectedText">): string {
  if (!annotation.selectedText) {
    return "";
  }
  return normalizeQuoteText(annotation.selectedText);
}

export function toPdfNoteMarker(number: number): string {
  if (number >= 1 && number <= 20) {
    return String.fromCodePoint(0x2460 + number - 1);
  }
  if (number >= 21 && number <= 35) {
    return String.fromCodePoint(0x3251 + number - 21);
  }
  if (number >= 36 && number <= 50) {
    return String.fromCodePoint(0x32b1 + number - 36);
  }
  return `[${number}]`;
}

function getAnnotationContents(
  annotation: PdfJsAnnotation,
  byId: Map<string, PdfJsAnnotation>,
): string | null {
  const direct = normalizeText(annotation.contents ?? annotation.contentsObj?.str);
  if (direct) {
    return direct;
  }

  const popupRef = annotation.popupRef;
  if (!popupRef) {
    return null;
  }

  const popupAnnotation = byId.get(popupRef);
  if (!popupAnnotation) {
    return null;
  }

  return normalizeText(popupAnnotation.contents ?? popupAnnotation.contentsObj?.str);
}

function toQuadRects(quadPoints: ArrayLike<number> | undefined): Rect[] {
  if (!quadPoints || quadPoints.length < 8) {
    return [];
  }
  const rects: Rect[] = [];
  for (let index = 0; index + 7 < quadPoints.length; index += 8) {
    const x1 = Number(quadPoints[index]);
    const y1 = Number(quadPoints[index + 1]);
    const x2 = Number(quadPoints[index + 2]);
    const y2 = Number(quadPoints[index + 3]);
    const x3 = Number(quadPoints[index + 4]);
    const y3 = Number(quadPoints[index + 5]);
    const x4 = Number(quadPoints[index + 6]);
    const y4 = Number(quadPoints[index + 7]);
    rects.push({
      x1: Math.min(x1, x2, x3, x4),
      y1: Math.min(y1, y2, y3, y4),
      x2: Math.max(x1, x2, x3, x4),
      y2: Math.max(y1, y2, y3, y4),
    });
  }
  return rects;
}

function rectsIntersect(left: Rect, right: Rect, tolerance = 0.8): boolean {
  return !(
    left.x2 < right.x1 - tolerance ||
    left.x1 > right.x2 + tolerance ||
    left.y2 < right.y1 - tolerance ||
    left.y1 > right.y2 + tolerance
  );
}

function extractTextByQuadPoints(annotation: PdfJsAnnotation, textItems: PdfPageTextItem[]): string | null {
  const quadRects = toQuadRects(annotation.quadPoints);
  if (quadRects.length === 0) {
    return null;
  }
  const selectedTexts: string[] = [];
  for (const item of textItems) {
    if (!item.str) {
      continue;
    }
    if (quadRects.some((quadRect) => rectsIntersect(quadRect, item.rect))) {
      selectedTexts.push(item.str);
    }
  }
  if (selectedTexts.length === 0) {
    return null;
  }
  return normalizeText(selectedTexts.join(" "));
}

async function readPdfPageTextItems(page: Awaited<ReturnType<PdfJsModule["getPage"]>>): Promise<PdfPageTextItem[]> {
  const content = await page.getTextContent();
  const rawItems = (content.items ?? []) as Array<{
    str?: string;
    transform?: number[];
    width?: number;
    height?: number;
  }>;
  const items: PdfPageTextItem[] = [];
  for (const item of rawItems) {
    if (!item.str || !item.transform || item.transform.length < 6) {
      continue;
    }
    const x = Number(item.transform[4]);
    const y = Number(item.transform[5]);
    const width = Math.max(Number(item.width ?? 0), 0);
    const fallbackHeight = Math.abs(Number(item.transform[3] ?? 0));
    const height = Math.max(Number(item.height ?? fallbackHeight), fallbackHeight, 0);
    items.push({
      str: item.str,
      rect: {
        x1: Math.min(x, x + width),
        y1: Math.min(y, y + height),
        x2: Math.max(x, x + width),
        y2: Math.max(y, y + height),
      },
    });
  }
  return items;
}

export async function extractPdfPageAnnotations(pdfPath: string): Promise<PdfPageAnnotations[]> {
  const pdfjs = await getPdfJsModule();
  const loadingTask = pdfjs.getDocument({
    url: pdfPath,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
  } as unknown as Parameters<PdfJsModule["getDocument"]>[0]);
  const document = await loadingTask.promise;
  const pages: PdfPageAnnotations[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const rawAnnotations = (await page.getAnnotations()) as PdfJsAnnotation[];
    const textItems = await readPdfPageTextItems(page);

    const annotationsById = new Map<string, PdfJsAnnotation>();
    for (const annotation of rawAnnotations) {
      if (annotation.id) {
        annotationsById.set(annotation.id, annotation);
      }
    }

    const annotations: PdfAnnotation[] = rawAnnotations
      .map((annotation, index) => {
        return {
          id: annotation.id ?? `${pageNumber}-${index}`,
          pageNumber,
          subtype: normalizeSubtype(annotation.subtype),
          contents: getAnnotationContents(annotation, annotationsById),
          selectedText: extractTextByQuadPoints(annotation, textItems),
          rect: toRect(annotation.rect),
        };
      })
      .filter((annotation) => {
        const subtype = annotation.subtype.toLowerCase();
        if (subtype === "link" || subtype === "popup") {
          return false;
        }

        return Boolean(annotation.rect || annotation.contents || annotation.selectedText);
      });

    if (annotations.length > 0) {
      pages.push({
        pageNumber,
        pageWidth: viewport.width,
        pageHeight: viewport.height,
        annotations,
      });
    }
  }

  await loadingTask.destroy();
  return pages;
}

function toOverlaySvg(
  width: number,
  height: number,
  pageWidth: number,
  pageHeight: number,
  annotations: PdfOverlayAnnotation[],
): string {
  const scaleX = width / pageWidth;
  const scaleY = height / pageHeight;
  const elements = annotations
    .map((item) => {
      const xMin = Math.min(item.rect.x1, item.rect.x2);
      const xMax = Math.max(item.rect.x1, item.rect.x2);
      const yMin = Math.min(item.rect.y1, item.rect.y2);
      const yMax = Math.max(item.rect.y1, item.rect.y2);

      const x = xMin * scaleX;
      const y = height - yMax * scaleY;
      const rectWidth = Math.max((xMax - xMin) * scaleX, 6);
      const rectHeight = Math.max((yMax - yMin) * scaleY, 6);

      const marker = item.marker ? escapeXml(toOverlayMarkerText(item.marker)) : "";

      const pieces: string[] = [];
      if (item.drawRect) {
        pieces.push(
          `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${rectWidth.toFixed(2)}" height="${rectHeight.toFixed(2)}" fill="rgba(255,215,0,0.12)" stroke="#ff8c00" stroke-width="1.6"/>`,
        );
      }
      if (marker) {
        const markerFontSize = clamp(Math.round(Math.min(width, height) * 0.018), 28, 56);
        const markerPadX = Math.round(markerFontSize * 0.45);
        const markerPadY = Math.round(markerFontSize * 0.32);
        const markerWidth = Math.max(
          markerFontSize + markerPadX * 2,
          marker.length * markerFontSize * 0.68 + markerPadX * 2,
        );
        const markerHeight = markerFontSize + markerPadY * 2;

        // Prefer placing marker to the right-top of the target; if out of bounds, move near the target bottom.
        const desiredLeft = x + rectWidth + 14;
        const desiredTop = y - markerHeight * 0.6;
        const markerLeft = clamp(desiredLeft, 2, width - markerWidth - 2);
        const markerTop = desiredTop < 2 ? Math.min(y + rectHeight + 8, height - markerHeight - 2) : desiredTop;
        const markerCenterX = markerLeft + markerWidth / 2;
        const markerBaselineY = markerTop + markerPadY + markerFontSize * 0.78;

        const { markerAnchorX, markerAnchorY, rectAnchorX, rectAnchorY } = computeConnectorAnchors(
          x,
          y,
          rectWidth,
          rectHeight,
          markerLeft,
          markerTop,
          markerWidth,
          markerHeight,
        );
        const connectorStroke = Math.max(1.4, markerFontSize * 0.07);
        const arrowHead = buildArrowHead(markerAnchorX, markerAnchorY, rectAnchorX, rectAnchorY, markerFontSize);
        pieces.push(
          `<line x1="${markerAnchorX.toFixed(2)}" y1="${markerAnchorY.toFixed(2)}" x2="${rectAnchorX.toFixed(2)}" y2="${rectAnchorY.toFixed(2)}" stroke="#4b5563" stroke-width="${connectorStroke.toFixed(2)}" opacity="0.75"/>`,
        );
        pieces.push(
          `<polyline points="${arrowHead.leftX.toFixed(2)},${arrowHead.leftY.toFixed(2)} ${rectAnchorX.toFixed(2)},${rectAnchorY.toFixed(2)} ${arrowHead.rightX.toFixed(2)},${arrowHead.rightY.toFixed(2)}" fill="none" stroke="#4b5563" stroke-width="${connectorStroke.toFixed(2)}" opacity="0.85"/>`,
        );
        pieces.push(
          `<rect x="${markerLeft.toFixed(2)}" y="${markerTop.toFixed(2)}" width="${markerWidth.toFixed(2)}" height="${markerHeight.toFixed(2)}" rx="${Math.max(10, markerFontSize * 0.45).toFixed(2)}" ry="${Math.max(10, markerFontSize * 0.45).toFixed(2)}" fill="#ffffff" fill-opacity="0.96" stroke="#111827" stroke-width="${Math.max(1.4, markerFontSize * 0.07).toFixed(2)}"/>`,
        );
        pieces.push(
          `<text x="${markerCenterX.toFixed(2)}" y="${markerBaselineY.toFixed(2)}" text-anchor="middle" font-size="${markerFontSize}" font-weight="600" font-family="PingFang SC, Hiragino Sans GB, Arial, sans-serif" fill="#111111">${marker}</text>`,
        );
      }
      return pieces.join("");
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${elements}</svg>`;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function computeConnectorAnchors(
  rectX: number,
  rectY: number,
  rectWidth: number,
  rectHeight: number,
  markerX: number,
  markerY: number,
  markerWidth: number,
  markerHeight: number,
): {
  markerAnchorX: number;
  markerAnchorY: number;
  rectAnchorX: number;
  rectAnchorY: number;
} {
  const rectCenterX = rectX + rectWidth / 2;
  const rectCenterY = rectY + rectHeight / 2;
  const markerCenterX = markerX + markerWidth / 2;
  const markerCenterY = markerY + markerHeight / 2;
  const dx = markerCenterX - rectCenterX;
  const dy = markerCenterY - rectCenterY;

  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx >= 0) {
      return {
        markerAnchorX: markerX,
        markerAnchorY: markerCenterY,
        rectAnchorX: rectX + rectWidth - 3,
        rectAnchorY: clamp(markerCenterY, rectY + 3, rectY + rectHeight - 3),
      };
    }
    return {
      markerAnchorX: markerX + markerWidth,
      markerAnchorY: markerCenterY,
      rectAnchorX: rectX + 3,
      rectAnchorY: clamp(markerCenterY, rectY + 3, rectY + rectHeight - 3),
    };
  }

  if (dy >= 0) {
    return {
      markerAnchorX: markerCenterX,
      markerAnchorY: markerY,
      rectAnchorX: clamp(markerCenterX, rectX + 3, rectX + rectWidth - 3),
      rectAnchorY: rectY + rectHeight - 3,
    };
  }
  return {
    markerAnchorX: markerCenterX,
    markerAnchorY: markerY + markerHeight,
    rectAnchorX: clamp(markerCenterX, rectX + 3, rectX + rectWidth - 3),
    rectAnchorY: rectY + 3,
  };
}

function buildArrowHead(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  markerFontSize: number,
): { leftX: number; leftY: number; rightX: number; rightY: number } {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const headLen = Math.max(7, markerFontSize * 0.32);
  const headHalf = Math.max(4, markerFontSize * 0.18);

  return {
    leftX: toX - ux * headLen + -uy * headHalf,
    leftY: toY - uy * headLen + ux * headHalf,
    rightX: toX - ux * headLen - -uy * headHalf,
    rightY: toY - uy * headLen - ux * headHalf,
  };
}

function toOverlayMarkerText(marker: string): string {
  const bracketMatch = marker.match(/^\[(\d+)\]$/);
  if (bracketMatch?.[1]) {
    return bracketMatch[1];
  }

  const codePoint = marker.codePointAt(0);
  if (!codePoint) {
    return marker;
  }
  if (codePoint >= 0x2460 && codePoint <= 0x2473) {
    return String(codePoint - 0x2460 + 1);
  }
  if (codePoint >= 0x3251 && codePoint <= 0x325f) {
    return String(codePoint - 0x3251 + 21);
  }
  if (codePoint >= 0x32b1 && codePoint <= 0x32bf) {
    return String(codePoint - 0x32b1 + 36);
  }
  return marker;
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getRenderScriptPath(): string {
  return path.resolve(__dirname, "../../tools/render_pdf_page.swift");
}

export function renderPdfPageToPng(pdfPath: string, pageNumber: number, outputPath: string, scale = 2): void {
  execFileSync("swift", [getRenderScriptPath(), pdfPath, String(pageNumber), outputPath, String(scale)], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
}

export async function limitPngMaxDimension(imagePath: string, maxDimension: number): Promise<void> {
  const metadata = await sharp(imagePath).metadata();
  if (!metadata.width || !metadata.height) {
    return;
  }
  const longestSide = Math.max(metadata.width, metadata.height);
  if (longestSide <= maxDimension) {
    return;
  }

  const resized = await sharp(imagePath)
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
  await sharp(resized).toFile(imagePath);
}

export function sortPdfAnnotations(annotations: PdfAnnotation[]): PdfAnnotation[] {
  return [...annotations].sort((left, right) => {
    if (left.rect && right.rect) {
      const leftTop = -Math.max(left.rect.y1, left.rect.y2);
      const rightTop = -Math.max(right.rect.y1, right.rect.y2);
      if (leftTop !== rightTop) {
        return leftTop - rightTop;
      }

      const leftX = Math.min(left.rect.x1, left.rect.x2);
      const rightX = Math.min(right.rect.x1, right.rect.x2);
      if (leftX !== rightX) {
        return leftX - rightX;
      }
    } else if (left.rect && !right.rect) {
      return -1;
    } else if (!left.rect && right.rect) {
      return 1;
    }

    return left.id.localeCompare(right.id);
  });
}

export function shouldOverlayPdfAnnotationRect(annotation: Pick<PdfAnnotation, "subtype" | "rect">): boolean {
  if (!annotation.rect) {
    return false;
  }

  const subtype = annotation.subtype.toLowerCase();
  return subtype === "square" || subtype === "circle";
}

export async function overlayPdfAnnotationNumbers(
  imagePath: string,
  pageWidth: number,
  pageHeight: number,
  annotations: PdfOverlayAnnotation[],
): Promise<void> {
  if (annotations.length === 0) {
    return;
  }

  const metadata = await sharp(imagePath).metadata();
  if (!metadata.width || !metadata.height) {
    return;
  }

  const overlaySvg = toOverlaySvg(metadata.width, metadata.height, pageWidth, pageHeight, annotations);
  const outputBuffer = await sharp(imagePath)
    .composite([{ input: Buffer.from(overlaySvg), blend: "over" }])
    .png()
    .toBuffer();

  await sharp(outputBuffer).toFile(imagePath);
}

export function pdfAnnotationLabel(annotation: PdfAnnotation): string {
  const subtype = annotation.subtype.toLowerCase();
  if (annotation.contents) {
    return annotation.contents;
  }
  if (subtype === "highlight" || subtype === "underline" || subtype === "squiggly") {
    return "高亮标注（无附注）";
  }
  if (subtype === "text" || subtype === "freetext") {
    return "页面标注（无文本内容）";
  }
  return `${annotation.subtype} 标注（无文本内容）`;
}
