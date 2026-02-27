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

  const chapterMap = new Map<string, EpubAnnotation[]>();
  for (const annotation of annotations) {
    const key = toDisplayChapterKey(annotation.chapterKey, chapterTitleByKey);
    const list = chapterMap.get(key) ?? [];
    list.push(annotation);
    chapterMap.set(key, list);
  }

  const chapterKeys = Array.from(chapterMap.keys()).sort((a, b) => a.localeCompare(b));
  for (const chapterKey of chapterKeys) {
    lines.push(`## ${chapterKey}`);
    lines.push("");
    const chapterAnnotations = chapterMap.get(chapterKey) ?? [];
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

  lines.push("## 页面标注");
  lines.push("");
  for (const page of pages) {
    lines.push(`### 第 ${page.pageNumber} 页`);
    lines.push("");
    if (page.imageRelativePath) {
      lines.push(`![第${page.pageNumber}页标注](${page.imageRelativePath})`);
      lines.push("");
    }
    if (page.notes.length === 0) {
      lines.push("- 无可展示笔记");
      lines.push("");
      continue;
    }
    for (const note of page.notes) {
      const positionTag = note.hasRect ? "" : "（无定位）";
      lines.push(`${note.number}. [${note.subtype}]${positionTag} ${note.label}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export type { PdfRenderedPage, PdfRenderedNote };
