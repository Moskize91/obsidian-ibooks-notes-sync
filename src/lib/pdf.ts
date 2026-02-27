import { execFileSync } from "node:child_process";
import path from "node:path";
import sharp from "sharp";
import type { PdfAnnotation, PdfPageAnnotations, Rect } from "./types";

type PdfJsAnnotation = {
  id?: string;
  subtype?: string;
  contents?: string;
  contentsObj?: { str?: string };
  rect?: number[];
  popupRef?: string;
};

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let cachedPdfJsModule: PdfJsModule | null = null;

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
          rect: toRect(annotation.rect),
        };
      })
      .filter((annotation) => {
        const subtype = annotation.subtype.toLowerCase();
        if (subtype === "link" || subtype === "popup") {
          return false;
        }

        return Boolean(annotation.rect || annotation.contents);
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
  annotations: Array<{ number: number; rect: Rect }>,
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

      const circleX = Math.max(x + 10, 12);
      const circleY = Math.max(y + 10, 12);

      return [
        `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${rectWidth.toFixed(2)}" height="${rectHeight.toFixed(2)}" fill="rgba(255,215,0,0.12)" stroke="#ff4500" stroke-width="2"/>`,
        `<circle cx="${circleX.toFixed(2)}" cy="${circleY.toFixed(2)}" r="11" fill="#ff4500"/>`,
        `<text x="${circleX.toFixed(2)}" y="${(circleY + 4).toFixed(2)}" text-anchor="middle" font-size="12" font-family="Arial, sans-serif" fill="#ffffff">${item.number}</text>`,
      ].join("");
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${elements}</svg>`;
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
  return (
    subtype === "highlight" ||
    subtype === "underline" ||
    subtype === "squiggly" ||
    subtype === "strikeout" ||
    subtype === "square" ||
    subtype === "circle"
  );
}

export async function overlayPdfAnnotationNumbers(
  imagePath: string,
  pageWidth: number,
  pageHeight: number,
  annotations: Array<{ number: number; rect: Rect }>,
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
