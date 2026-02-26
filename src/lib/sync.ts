import fs from "node:fs/promises";
import path from "node:path";
import {
  readAnnotationMaxModificationDates,
  readBooks,
  readEpubAnnotations,
  readPdfFallbackCounts,
} from "./ibooks-data";
import { sortEpubAnnotations } from "./epub";
import { log } from "./logger";
import {
  extractPdfPageAnnotations,
  overlayPdfAnnotationNumbers,
  pdfAnnotationLabel,
  renderPdfPageToPng,
  sortPdfAnnotations,
} from "./pdf";
import {
  getBookFileRelativePath,
  renderEpubBookMarkdown,
  renderIndexMarkdown,
  renderPdfBookMarkdown,
} from "./render-markdown";
import { acquireSyncLock, buildBookSyncHash, readSyncState, writeSyncState } from "./sync-state";
import type {
  Book,
  CliConfig,
  EpubAnnotation,
  IBooksPaths,
  PdfAnnotation,
  SyncAssetState,
  SyncStats,
  SyncableBookFormat,
} from "./types";

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

type PdfFileStamp = {
  mtimeMs: number;
  size: number;
};

type BookSyncSnapshot = {
  book: Book & { format: SyncableBookFormat };
  hash: string;
  bookFileRelativePath: string;
  pdfAssetDirRelativePath: string | null;
};

async function pathExists(inputPath: string): Promise<boolean> {
  try {
    await fs.access(inputPath);
    return true;
  } catch {
    return false;
  }
}

async function removeFileIfExists(filePath: string): Promise<void> {
  await fs.rm(filePath, { force: true });
}

async function removeDirectoryIfExists(dirPath: string): Promise<void> {
  await fs.rm(dirPath, { recursive: true, force: true });
}

function isSyncableBook(book: Book): book is Book & { format: SyncableBookFormat } {
  return book.format === "EPUB" || book.format === "PDF";
}

function filterBooks(books: Array<Book & { format: SyncableBookFormat }>, filter: string | undefined): Array<Book & { format: SyncableBookFormat }> {
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

async function getPdfFileStamp(pdfPath: string | null): Promise<PdfFileStamp | "missing" | null> {
  if (!pdfPath) {
    return null;
  }

  try {
    const stat = await fs.stat(pdfPath);
    return {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    };
  } catch {
    return "missing";
  }
}

function toSyncStateAsset(snapshot: BookSyncSnapshot): SyncAssetState {
  return {
    assetId: snapshot.book.assetId,
    title: snapshot.book.title,
    format: snapshot.book.format,
    hash: snapshot.hash,
    bookFileRelativePath: snapshot.bookFileRelativePath,
    pdfAssetDirRelativePath: snapshot.pdfAssetDirRelativePath,
  };
}

function shouldRegenerateBook(snapshot: BookSyncSnapshot, previous: SyncAssetState | undefined): boolean {
  if (!previous) {
    return true;
  }

  if (previous.format !== snapshot.book.format) {
    return true;
  }

  if (previous.hash !== snapshot.hash) {
    return true;
  }

  if (previous.bookFileRelativePath !== snapshot.bookFileRelativePath) {
    return true;
  }

  return previous.pdfAssetDirRelativePath !== snapshot.pdfAssetDirRelativePath;
}

async function writeFileAtomically(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${Date.now()}-${process.pid}`;
  await fs.writeFile(tempPath, content, "utf8");
  await fs.rename(tempPath, filePath);
}

async function replaceDirectoryAtomically(stagingDir: string, targetDir: string): Promise<void> {
  const targetParent = path.dirname(targetDir);
  await fs.mkdir(targetParent, { recursive: true });
  const backupDir = `${targetDir}.bak-${Date.now()}-${process.pid}`;
  const hadTarget = await pathExists(targetDir);

  try {
    if (hadTarget) {
      await fs.rename(targetDir, backupDir);
    }
    await fs.rename(stagingDir, targetDir);
    if (hadTarget) {
      await removeDirectoryIfExists(backupDir);
    }
  } catch (error) {
    if (await pathExists(targetDir)) {
      await removeDirectoryIfExists(targetDir);
    }
    if (await pathExists(backupDir)) {
      await fs.rename(backupDir, targetDir);
    }
    if (await pathExists(stagingDir)) {
      await removeDirectoryIfExists(stagingDir);
    }
    throw error;
  }
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

function buildAnnotationsByAssetId(
  annotations: EpubAnnotation[],
  assetIds: Set<string>,
): Map<string, EpubAnnotation[]> {
  const byAssetId = new Map<string, EpubAnnotation[]>();
  for (const annotation of annotations) {
    if (!assetIds.has(annotation.assetId)) {
      continue;
    }
    const list = byAssetId.get(annotation.assetId) ?? [];
    list.push(annotation);
    byAssetId.set(annotation.assetId, list);
  }
  return byAssetId;
}

async function buildBookSyncSnapshot(
  book: Book & { format: SyncableBookFormat },
  annotationMaxModificationDates: Map<string, number | null>,
  booksDirName: string,
): Promise<BookSyncSnapshot> {
  const pdfFileStamp = book.format === "PDF" ? await getPdfFileStamp(book.path) : null;
  const hash = buildBookSyncHash(book.format, annotationMaxModificationDates.get(book.assetId) ?? null, pdfFileStamp);
  return {
    book,
    hash,
    bookFileRelativePath: getBookFileRelativePath(book, booksDirName),
    pdfAssetDirRelativePath: book.format === "PDF" ? path.posix.join("assets", "pdf", book.assetId) : null,
  };
}

export async function runSync(config: CliConfig, paths: IBooksPaths, options: SyncOptions): Promise<SyncResult> {
  const allBooks = readBooks(paths.libraryDbPath, paths.annotationDbPath, paths.epubInfoDbPath).filter(isSyncableBook);
  const books = filterBooks(allBooks, options.bookFilter);
  const isFullSync = !options.bookFilter;

  const outputDir = path.resolve(config.outputDir, config.managedDirName);
  const booksDirName = "books";
  const stagingRoot = path.join(outputDir, ".staging", `${Date.now()}-${process.pid}`);

  const stats: SyncStats = {
    totalBooks: books.length,
    successBooks: 0,
    failedBooks: 0,
    skippedBooks: 0,
    generatedFiles: 0,
  };

  const errors: Array<{ title: string; reason: string }> = [];
  const previousState = await readSyncState(outputDir);
  const nextStateAssets: Record<string, SyncAssetState> = { ...previousState.assets };

  const annotationMaxModificationDates = readAnnotationMaxModificationDates(
    paths.annotationDbPath,
    paths.libraryDbPath,
  );

  const bookSnapshots = await Promise.all(
    books.map(async (book) => {
      return buildBookSyncSnapshot(book, annotationMaxModificationDates, booksDirName);
    }),
  );

  const changedSnapshots: BookSyncSnapshot[] = [];
  for (const snapshot of bookSnapshots) {
    const previous = previousState.assets[snapshot.book.assetId];
    if (shouldRegenerateBook(snapshot, previous)) {
      changedSnapshots.push(snapshot);
    } else {
      stats.skippedBooks += 1;
    }
  }

  const allCurrentAssetIds = new Set(allBooks.map((book) => book.assetId));
  const removedAssetIds = isFullSync
    ? Object.keys(previousState.assets).filter((assetId) => {
        return !allCurrentAssetIds.has(assetId);
      })
    : [];

  log(
    "info",
    `sync plan: changed=${changedSnapshots.length}, unchanged=${stats.skippedBooks}, removed=${removedAssetIds.length}`,
  );

  const changedEpubAssetIds = new Set(
    changedSnapshots
      .filter((snapshot) => snapshot.book.format === "EPUB")
      .map((snapshot) => snapshot.book.assetId),
  );

  const changedPdfAssetIds = new Set(
    changedSnapshots
      .filter((snapshot) => snapshot.book.format === "PDF")
      .map((snapshot) => snapshot.book.assetId),
  );

  let annotationsByAssetId = new Map<string, EpubAnnotation[]>();
  if (changedEpubAssetIds.size > 0) {
    const sortedEpubAnnotations = sortEpubAnnotations(readEpubAnnotations(paths.annotationDbPath, paths.libraryDbPath));
    annotationsByAssetId = buildAnnotationsByAssetId(sortedEpubAnnotations, changedEpubAssetIds);
  }

  let pdfFallbackCounts = new Map<string, number>();
  if (changedPdfAssetIds.size > 0) {
    pdfFallbackCounts = readPdfFallbackCounts(paths.annotationDbPath, paths.libraryDbPath);
  }

  let releaseLock: (() => Promise<void>) | null = null;
  try {
    if (!options.dryRun) {
      releaseLock = await acquireSyncLock(outputDir);
      await fs.mkdir(path.dirname(stagingRoot), { recursive: true });
      await removeDirectoryIfExists(stagingRoot);
      await fs.mkdir(stagingRoot, { recursive: true });
    }

    for (const [index, snapshot] of changedSnapshots.entries()) {
      const progress = `${index + 1}/${changedSnapshots.length}`;
      const action = options.dryRun ? "dry-run preparing" : "syncing";
      log("info", `${action} (${progress}) [${snapshot.book.format}] ${snapshot.book.title}`);

      const previousAssetState = previousState.assets[snapshot.book.assetId];
      try {
        let markdown = "";
        let generatedPdfImageCount = 0;
        let stagedPdfAssetDir = "";

        if (snapshot.book.format === "EPUB") {
          const notes = annotationsByAssetId.get(snapshot.book.assetId) ?? [];
          markdown = renderEpubBookMarkdown(snapshot.book, notes);
        } else {
          let pages: PdfPageRenderItem[] = [];
          if (config.pdfBetaEnabled && snapshot.book.path) {
            stagedPdfAssetDir = path.join(stagingRoot, "assets", "pdf", snapshot.book.assetId);
            pages = await generatePdfPages(snapshot.book, stagedPdfAssetDir, options.dryRun);
            generatedPdfImageCount = pages.filter((page) => page.imageRelativePath).length;
          }
          markdown = renderPdfBookMarkdown(
            snapshot.book,
            pages,
            pdfFallbackCounts.get(snapshot.book.assetId) ?? 0,
          );
        }

        if (!options.dryRun) {
          const targetBookPath = path.join(outputDir, snapshot.bookFileRelativePath);
          await writeFileAtomically(targetBookPath, markdown);

          if (snapshot.book.format === "PDF") {
            const targetPdfAssetDir = path.join(
              outputDir,
              snapshot.pdfAssetDirRelativePath ?? path.posix.join("assets", "pdf", snapshot.book.assetId),
            );
            if (generatedPdfImageCount > 0) {
              await replaceDirectoryAtomically(stagedPdfAssetDir, targetPdfAssetDir);
            } else {
              await removeDirectoryIfExists(targetPdfAssetDir);
            }
          }

          if (previousAssetState && previousAssetState.bookFileRelativePath !== snapshot.bookFileRelativePath) {
            await removeFileIfExists(path.join(outputDir, previousAssetState.bookFileRelativePath));
          }

          if (
            previousAssetState &&
            previousAssetState.pdfAssetDirRelativePath &&
            previousAssetState.pdfAssetDirRelativePath !== snapshot.pdfAssetDirRelativePath
          ) {
            await removeDirectoryIfExists(path.join(outputDir, previousAssetState.pdfAssetDirRelativePath));
          }
        }

        nextStateAssets[snapshot.book.assetId] = toSyncStateAsset(snapshot);
        stats.successBooks += 1;
        stats.generatedFiles += 1 + generatedPdfImageCount;
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : "unknown error";
        errors.push({ title: snapshot.book.title, reason });
        stats.failedBooks += 1;
        if (!options.dryRun) {
          await removeDirectoryIfExists(path.join(stagingRoot, "assets", "pdf", snapshot.book.assetId));
        }
      }
    }

    if (isFullSync) {
      for (const removedAssetId of removedAssetIds) {
        const previousAsset = previousState.assets[removedAssetId];
        if (!previousAsset) {
          continue;
        }

        if (!options.dryRun) {
          try {
            await removeFileIfExists(path.join(outputDir, previousAsset.bookFileRelativePath));
            if (previousAsset.pdfAssetDirRelativePath) {
              await removeDirectoryIfExists(path.join(outputDir, previousAsset.pdfAssetDirRelativePath));
            }
          } catch (error: unknown) {
            const reason = error instanceof Error ? error.message : "unknown error";
            errors.push({ title: previousAsset.title, reason });
            continue;
          }
        }
        delete nextStateAssets[removedAssetId];
      }
    }

    if (options.dryRun) {
      log("info", `dry-run completed: ${stats.successBooks}/${stats.totalBooks} books would be generated.`);
      if (removedAssetIds.length > 0) {
        log("info", `dry-run removals: ${removedAssetIds.length} assets would be removed.`);
      }
      if (errors.length > 0) {
        for (const error of errors) {
          log("warn", `failed to prepare "${error.title}": ${error.reason}`);
        }
      }
      return { stats, outputDir };
    }

    if (isFullSync) {
      const indexMarkdown = renderIndexMarkdown(allBooks, new Date(), booksDirName);
      await writeFileAtomically(path.join(outputDir, "index.md"), indexMarkdown);
      stats.generatedFiles += 1;
    }

    await writeSyncState(outputDir, nextStateAssets);
  } finally {
    if (!options.dryRun) {
      await removeDirectoryIfExists(stagingRoot);
    }
    if (releaseLock) {
      await releaseLock();
    }
  }

  if (errors.length > 0) {
    for (const error of errors) {
      log("warn", `book failed: "${error.title}" -> ${error.reason}`);
    }
  }

  return { stats, outputDir };
}
