import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { IBooksPaths } from "./types";

const HOME = os.homedir();

export const BOOKS_PLIST_PATH = path.join(
  HOME,
  "Library/Containers/com.apple.BKAgentService/Data/Documents/iBooks/Books/Books.plist",
);

export const LIBRARY_DB_PATH = path.join(
  HOME,
  "Library/Containers/com.apple.iBooksX/Data/Documents/BKLibrary/BKLibrary-1-091020131601.sqlite",
);

export const ANNOTATION_DB_PATH = path.join(
  HOME,
  "Library/Containers/com.apple.iBooksX/Data/Documents/AEAnnotation/AEAnnotation_v10312011_1727_local.sqlite",
);

const EPUB_INFO_DIR = path.join(
  HOME,
  "Library/Containers/com.apple.iBooksX/Data/Library/Caches/AEEpubInfoSource",
);

export async function discoverLatestEpubInfoDbPath(): Promise<string | null> {
  try {
    const entries = await fs.readdir(EPUB_INFO_DIR);
    const sqliteFiles = entries.filter((name) => name.endsWith(".sqlite"));
    if (sqliteFiles.length === 0) {
      return null;
    }

    const withStats = await Promise.all(
      sqliteFiles.map(async (name) => {
        const fullPath = path.join(EPUB_INFO_DIR, name);
        const stats = await fs.stat(fullPath);
        return { fullPath, mtimeMs: stats.mtimeMs };
      }),
    );

    withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return withStats[0]?.fullPath ?? null;
  } catch {
    return null;
  }
}

export async function resolveIbooksPaths(): Promise<IBooksPaths> {
  const epubInfoDbPath = await discoverLatestEpubInfoDbPath();
  return {
    booksPlistPath: BOOKS_PLIST_PATH,
    libraryDbPath: LIBRARY_DB_PATH,
    annotationDbPath: ANNOTATION_DB_PATH,
    epubInfoDbPath,
  };
}
