import fs from "node:fs/promises";
import path from "node:path";
import { readBooks, readEpubAnnotations, readPdfFallbackCounts } from "./ibooks-data";
import { sortEpubAnnotations } from "./epub";
import { log } from "./logger";
import { extractPdfPageAnnotations, overlayPdfAnnotationNumbers, pdfAnnotationLabel, renderPdfPageToPng, sortPdfAnnotations } from "./pdf";
import { getBookFileRelativePath, renderEpubBookMarkdown, renderIndexMarkdown, renderPdfBookMarkdown } from "./render-markdown";
import type { Book, CliConfig, IBooksPaths, PdfAnnotation, SyncStats } from "./types";

type SyncOptions = {
  dryRun: boolean;
  bookFilter?: string;
};

type SyncResult = {
  stats: SyncStats;
  outputDir: string;
};

type PdfPageRenderItem = {
  pageNumber: number;
  imageRelativePath: string | null;
  notes: Array<{ number: number; label: string; subtype: string; hasRect: boolean }>;
};

async function pathExists(inputPath: string): Promise<boolean> {
  try {
    await fs.access(inputPath);
    return true;
  } catch {
    return false;
  }
}

function filterBooks(books: Book[], filter: string | undefined): Book[] {
  if (!filter) {
    return books;
  }

  const keyword = filter.toLowerCase();
  return books.filter((book) => {
    return (
      book.assetId.toLowerCase().includes(keyword) ||
      book.title.toLowerCase().includes(keyword) ||
      (book.author?.toLowerCase().includes(keyword) ?? false)
    );
  });
}

function numberPdfAnnotations(annotations: PdfAnnotation[]): Array<{ number: number; annotation: PdfAnnotation }> {
  return sortPdfAnnotations(annotations).map((annotation, index) => {
    return { number: index + 1, annotation };
  });
}

async function generatePdfPages(
  book: Book,
  bookAssetDir: string,
  dryRun: boolean,
): Promise<PdfPageRenderItem[]> {
  if (!book.path) {
    return [];
  }

  const pages = await extractPdfPageAnnotations(book.path);
  const items: PdfPageRenderItem[] = [];

  for (const page of pages) {
    const numbered = numberPdfAnnotations(page.annotations);
    const imageName = `page-${page.pageNumber}.png`;
    const imageRelativePath = path.posix.join("assets", "pdf", book.assetId, imageName);
    const imageAbsolutePath = path.join(bookAssetDir, imageName);

    if (!dryRun) {
      await fs.mkdir(bookAssetDir, { recursive: true });
      renderPdfPageToPng(book.path, page.pageNumber, imageAbsolutePath);

      const overlayRects = numbered
        .filter((item) => item.annotation.rect)
        .map((item) => {
          return {
            number: item.number,
            rect: item.annotation.rect!,
          };
        });

      await overlayPdfAnnotationNumbers(imageAbsolutePath, page.pageWidth, page.pageHeight, overlayRects);
    }

    const notes = numbered.map((item) => {
      return {
        number: item.number,
        label: pdfAnnotationLabel(item.annotation),
        subtype: item.annotation.subtype,
        hasRect: Boolean(item.annotation.rect),
      };
    });

    items.push({
      pageNumber: page.pageNumber,
      imageRelativePath: dryRun ? null : imageRelativePath,
      notes,
    });
  }

  return items;
}

async function writeFileIfNeeded(filePath: string, content: string, dryRun: boolean): Promise<void> {
  if (dryRun) {
    return;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

export async function runSync(config: CliConfig, paths: IBooksPaths, options: SyncOptions): Promise<SyncResult> {
  const allBooks = readBooks(paths.libraryDbPath, paths.annotationDbPath, paths.epubInfoDbPath).filter((book) => {
    return book.format === "EPUB" || book.format === "PDF";
  });
  const books = filterBooks(allBooks, options.bookFilter);
  const epubAnnotations = readEpubAnnotations(paths.annotationDbPath, paths.libraryDbPath);
  const sortedEpubAnnotations = sortEpubAnnotations(epubAnnotations);
  const annotationsByAssetId = new Map<string, typeof sortedEpubAnnotations>();
  for (const annotation of sortedEpubAnnotations) {
    const list = annotationsByAssetId.get(annotation.assetId) ?? [];
    list.push(annotation);
    annotationsByAssetId.set(annotation.assetId, list);
  }

  const pdfFallbackCounts = readPdfFallbackCounts(paths.annotationDbPath, paths.libraryDbPath);

  const outputDir = path.resolve(config.outputDir, config.managedDirName);
  const outputParent = path.dirname(outputDir);
  const tempDir = `${outputDir}.tmp-${Date.now()}-${process.pid}`;
  const booksDirName = "books";
  const assetRootDir = path.join(tempDir, "assets", "pdf");

  const stats: SyncStats = {
    totalBooks: books.length,
    successBooks: 0,
    failedBooks: 0,
    skippedBooks: 0,
    generatedFiles: 0,
  };

  if (!options.dryRun) {
    await fs.mkdir(outputParent, { recursive: true });
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.mkdir(tempDir, { recursive: true });
  }

  const errors: Array<{ title: string; reason: string }> = [];

  for (const book of books) {
    try {
      const bookRelativePath = getBookFileRelativePath(book, booksDirName);
      const bookFilePath = path.join(tempDir, bookRelativePath);
      let markdown = "";

      if (book.format === "EPUB") {
        const notes = annotationsByAssetId.get(book.assetId) ?? [];
        markdown = renderEpubBookMarkdown(book, notes);
      } else if (book.format === "PDF") {
        let pages: PdfPageRenderItem[] = [];
        if (config.pdfBetaEnabled && book.path) {
          const bookAssetDir = path.join(assetRootDir, book.assetId);
          pages = await generatePdfPages(book, bookAssetDir, options.dryRun);
          stats.generatedFiles += pages.filter((page) => page.imageRelativePath).length;
        }
        markdown = renderPdfBookMarkdown(book, pages, pdfFallbackCounts.get(book.assetId) ?? 0);
      } else {
        stats.skippedBooks += 1;
        continue;
      }

      await writeFileIfNeeded(bookFilePath, markdown, options.dryRun);
      stats.generatedFiles += 1;
      stats.successBooks += 1;
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : "unknown error";
      errors.push({ title: book.title, reason });
      stats.failedBooks += 1;
    }
  }

  const indexMarkdown = renderIndexMarkdown(books, new Date(), booksDirName);
  if (!options.dryRun) {
    await writeFileIfNeeded(path.join(tempDir, "index.md"), indexMarkdown, false);
    stats.generatedFiles += 1;
  }

  if (options.dryRun) {
    log("info", `dry-run completed: ${stats.successBooks}/${stats.totalBooks} books would be generated.`);
    if (errors.length > 0) {
      for (const error of errors) {
        log("warn", `failed to prepare "${error.title}": ${error.reason}`);
      }
    }
    return { stats, outputDir };
  }

  const backupDir = `${outputDir}.bak-${Date.now()}`;
  const hadExistingOutput = await pathExists(outputDir);

  try {
    if (hadExistingOutput) {
      await fs.rename(outputDir, backupDir);
    }
    await fs.rename(tempDir, outputDir);
    if (hadExistingOutput) {
      await fs.rm(backupDir, { recursive: true, force: true });
    }
  } catch (error) {
    log("error", "failed to replace output directory, trying to rollback.");
    const hasNewOutput = await pathExists(outputDir);
    if (hasNewOutput) {
      await fs.rm(outputDir, { recursive: true, force: true });
    }
    if (await pathExists(backupDir)) {
      await fs.rename(backupDir, outputDir);
    }
    if (await pathExists(tempDir)) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
    throw error;
  }

  if (errors.length > 0) {
    for (const error of errors) {
      log("warn", `book failed: "${error.title}" -> ${error.reason}`);
    }
  }

  return { stats, outputDir };
}
