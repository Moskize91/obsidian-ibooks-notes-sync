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

export function getBookFileRelativePath(book: Book, booksDirName: string): string {
  const fileName = `${book.title.replace(/[<>:"/\\|?*]/g, "_")}-${book.assetId.slice(0, 8)}.md`;
  return path.posix.join(booksDirName, fileName);
}

export function renderEpubBookMarkdown(book: Book, annotations: EpubAnnotation[]): string {
  const lines: string[] = [];
  lines.push(`# ${book.title}`);
  lines.push("");
  lines.push(`- 作者: ${book.author ?? "-"}`);
  if (book.publisher) {
    lines.push(`- 出版商: ${book.publisher}`);
  }
  lines.push("- 格式: EPUB");
  lines.push(`- 标注数: ${annotations.length}`);
  if (book.path) {
    lines.push(`- 源文件: \`${book.path}\``);
  }
  lines.push("");

  if (annotations.length === 0) {
    lines.push("> 本书暂无可同步的 EPUB 标注。");
    lines.push("");
    return lines.join("\n");
  }

  const chapterMap = new Map<string, EpubAnnotation[]>();
  for (const annotation of annotations) {
    const key = annotation.chapterKey;
    const list = chapterMap.get(key) ?? [];
    list.push(annotation);
    chapterMap.set(key, list);
  }

  const chapterKeys = Array.from(chapterMap.keys()).sort((a, b) => a.localeCompare(b));
  for (const chapterKey of chapterKeys) {
    lines.push(`## 章节：${chapterKey}`);
    lines.push("");
    const chapterAnnotations = chapterMap.get(chapterKey) ?? [];
    for (const [index, annotation] of chapterAnnotations.entries()) {
      lines.push(`### 标注 ${index + 1}`);
      lines.push("");
      if (annotation.selectedText) {
        lines.push(`> ${annotation.selectedText}`);
        lines.push("");
      }
      if (annotation.noteText) {
        lines.push(`- 笔记: ${annotation.noteText}`);
      }
      if (annotation.location) {
        lines.push(`- 定位: \`${annotation.location}\``);
      }
      lines.push(`- 时间: ${fmtDate(annotation.createdAt)}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function renderPdfBookMarkdown(book: Book, pages: PdfRenderedPage[], fallbackCount: number): string {
  const lines: string[] = [];
  lines.push(`# ${book.title}`);
  lines.push("");
  lines.push(`- 作者: ${book.author ?? "-"}`);
  if (book.publisher) {
    lines.push(`- 出版商: ${book.publisher}`);
  }
  lines.push("- 格式: PDF（Beta）");
  lines.push(`- 标注页数: ${pages.length}`);
  if (book.path) {
    lines.push(`- 源文件: \`${book.path}\``);
  }
  lines.push("");

  if (pages.length === 0) {
    if (fallbackCount > 0) {
      lines.push(`> 已检测到 ${fallbackCount} 条 PDF 标注记录，但当前版本无法展开内容。`);
    } else {
      lines.push("> 本书暂无可同步的 PDF 标注。");
    }
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
