import path from "node:path";
import type { Book, EpubAnnotation } from "./types";

type PdfRenderedNote = {
  number: number;
  label: string;
  subtype: string;
  hasRect: boolean;
};

type PdfRenderedPage = {
  pageNumber: number;
  imageRelativePath: string | null;
  notes: PdfRenderedNote[];
};

type FrontmatterValue = string | number | boolean;
const LOCATION_SORT_COLLATOR = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function fmtDate(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

export function renderIndexMarkdown(
  books: Book[],
  generatedAt: Date,
  booksDirName: string,
  bookFileRelativePathByAssetId?: Map<string, string | null>,
): string {
  const lines: string[] = [];
  lines.push("# iBooks Notes Sync Index");
  lines.push("");
  lines.push(`- 生成时间: ${fmtDate(generatedAt)}`);
  lines.push(`- 书籍总数: ${books.length}`);
  lines.push("");
  lines.push("| 书名 | 作者 | 格式 | 标注数 | 最后同步 | 文件 |");
  lines.push("| --- | --- | --- | ---: | --- | --- |");

  for (const book of books) {
    const mapped = bookFileRelativePathByAssetId?.get(book.assetId);
    const fileName = mapped ?? getBookFileRelativePath(book, booksDirName);
    if (!fileName) {
      continue;
    }
    const fileCell = `[打开](${fileName})`;
    lines.push(
      `| ${escapeCell(book.title)} | ${escapeCell(book.author ?? "-")} | ${book.format} | ${book.annotationCount} | ${fmtDate(generatedAt)} | ${fileCell} |`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

function escapeCell(input: string): string {
  return input.replace(/\|/g, "\\|");
}

function toYamlScalar(value: FrontmatterValue): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return String(value);
}

function pushFrontmatter(lines: string[], properties: Array<[string, FrontmatterValue | null]>): void {
  lines.push("---");
  for (const [key, value] of properties) {
    if (value === null) {
      continue;
    }
    lines.push(`${key}: ${toYamlScalar(value)}`);
  }
  lines.push("---");
  lines.push("");
}

function toDisplayChapterKey(rawChapterKey: string, chapterTitleByKey?: Map<string, string>): string {
  const chapterKey = rawChapterKey.trim();
  if (chapterKey.length === 0) {
    return "未分章";
  }
  const mappedChapterTitle = chapterTitleByKey?.get(chapterKey)?.trim();
  if (mappedChapterTitle) {
    return mappedChapterTitle;
  }
  if (/^id[_-]?\d+$/i.test(chapterKey)) {
    return "未分章";
  }
  return chapterKey;
}

function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function normalizeLocationForSort(location: string | null): string {
  if (!location) {
    return "";
  }
  return location
    .replace(/^epubcfi\(/i, "")
    .replace(/\)$/g, "")
    .replace(/\[[^\]]*]/g, "");
}

function compareEpubAnnotationsBySourceOrder(
  left: EpubAnnotation,
  right: EpubAnnotation,
  chapterOrderByKey?: Map<string, number>,
): number {
  const leftChapterOrder = chapterOrderByKey?.get(left.chapterKey) ?? Number.MAX_SAFE_INTEGER;
  const rightChapterOrder = chapterOrderByKey?.get(right.chapterKey) ?? Number.MAX_SAFE_INTEGER;
  if (leftChapterOrder !== rightChapterOrder) {
    return leftChapterOrder - rightChapterOrder;
  }

  const leftLocation = normalizeLocationForSort(left.location);
  const rightLocation = normalizeLocationForSort(right.location);
  const locationCompare = LOCATION_SORT_COLLATOR.compare(leftLocation, rightLocation);
  if (locationCompare !== 0) {
    return locationCompare;
  }

  if (left.createdAt.getTime() !== right.createdAt.getTime()) {
    return left.createdAt.getTime() - right.createdAt.getTime();
  }
  return left.id.localeCompare(right.id);
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

function normalizeNoteText(noteText: string): string {
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

function buildEpubLocationLink(book: Book, location: string | null): string {
  if (!location) {
    return `ibooks://assetid/${book.assetId}`;
  }
  return `ibooks://assetid/${book.assetId}#${location}`;
}

export function getBookFileRelativePath(book: Book, booksDirName: string): string {
  const fileName = `${book.title.replace(/[<>:"/\\|?*]/g, "_")}-${book.assetId.slice(0, 8)}.md`;
  return path.posix.join(booksDirName, fileName);
}

export function renderEpubBookMarkdown(
  book: Book,
  annotations: EpubAnnotation[],
  chapterTitleByKey?: Map<string, string>,
  chapterOrderByKey?: Map<string, number>,
): string {
  const lines: string[] = [];
  pushFrontmatter(lines, [
    ["title", book.title],
    ["author", book.author ?? "-"],
    ["publisher", book.publisher],
    ["format", "EPUB"],
    ["annotation_count", annotations.length],
    ["source_file", book.path],
  ]);

  if (annotations.length === 0) {
    lines.push("> 本书暂无可同步的 EPUB 标注。");
    lines.push("");
    return lines.join("\n");
  }

  const sortedAnnotations = [...annotations].sort((left, right) => {
    return compareEpubAnnotationsBySourceOrder(left, right, chapterOrderByKey);
  });

  const chapterMap = new Map<string, { order: number; annotations: EpubAnnotation[] }>();
  for (const annotation of sortedAnnotations) {
    const chapterDisplayKey = toDisplayChapterKey(annotation.chapterKey, chapterTitleByKey);
    const chapterOrder = chapterOrderByKey?.get(annotation.chapterKey) ?? Number.MAX_SAFE_INTEGER;
    const existing = chapterMap.get(chapterDisplayKey);
    if (existing) {
      existing.annotations.push(annotation);
      if (chapterOrder < existing.order) {
        existing.order = chapterOrder;
      }
      continue;
    }
    chapterMap.set(chapterDisplayKey, { order: chapterOrder, annotations: [annotation] });
  }

  const chapterKeys = Array.from(chapterMap.keys()).sort((left, right) => {
    const leftEntry = chapterMap.get(left);
    const rightEntry = chapterMap.get(right);
    const leftOrder = leftEntry?.order ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = rightEntry?.order ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.localeCompare(right);
  });
  for (const chapterKey of chapterKeys) {
    lines.push(`## ${chapterKey}`);
    lines.push("");
    const chapterAnnotations = chapterMap.get(chapterKey)?.annotations ?? [];
    for (const [index, annotation] of chapterAnnotations.entries()) {
      if (index === 0) {
        lines.push("---");
      }
      const quoteText = collapseWhitespace(annotation.selectedText ?? "");
      const timestamp = fmtDate(annotation.createdAt);
      const timestampLabel = `[${timestamp}](<${buildEpubLocationLink(book, annotation.location)}>)`;

      if (quoteText) {
        lines.push(`> ${timestampLabel} ${quoteText}`);
      } else {
        lines.push(`> ${timestampLabel}`);
      }
      lines.push("");

      const normalizedNoteText = normalizeNoteText(annotation.noteText ?? "");
      if (normalizedNoteText) {
        lines.push(normalizedNoteText);
        lines.push("");
      }

      lines.push("---");
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function renderPdfBookMarkdown(book: Book, pages: PdfRenderedPage[]): string {
  const lines: string[] = [];
  pushFrontmatter(lines, [
    ["title", book.title],
    ["author", book.author ?? "-"],
    ["publisher", book.publisher],
    ["format", "PDF"],
    ["pdf_beta", true],
    ["annotated_pages", pages.length],
    ["source_file", book.path],
  ]);

  if (pages.length === 0) {
    lines.push("> 本书暂无可同步的 PDF 标注。");
    lines.push("");
    return lines.join("\n");
  }

  for (const page of pages) {
    if (lines[lines.length - 1] !== "") {
      lines.push("");
    }
    lines.push("---");
    lines.push("");

    if (page.imageRelativePath) {
      const pageLinkPath = path.posix.join("..", page.imageRelativePath);
      lines.push(`> ![第${page.pageNumber}页](${pageLinkPath}) 第 ${page.pageNumber} 页`);
    } else {
      lines.push(`> 第 ${page.pageNumber} 页`);
    }
    lines.push("");

    if (page.notes.length === 0) {
      lines.push("- 无可展示笔记");
    } else {
      for (const note of page.notes) {
        const positionTag = note.hasRect ? "" : "（无定位）";
        lines.push(`${note.number}. [${note.subtype}]${positionTag} ${note.label}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

export type { PdfRenderedPage, PdfRenderedNote };
