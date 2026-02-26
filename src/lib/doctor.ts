import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readBooks } from "./ibooks-data";
import { sqliteVersion } from "./sqlite";
import type { CliConfig, IBooksPaths } from "./types";

export type DoctorCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

export type DoctorReport = {
  ok: boolean;
  checks: DoctorCheck[];
  summary: {
    books: number;
    epubBooks: number;
    pdfBooks: number;
  };
};

async function canRead(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function canWriteDir(dirPath: string): Promise<boolean> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
    const probe = path.join(dirPath, `.probe-${Date.now()}`);
    await fs.writeFile(probe, "ok", "utf8");
    await fs.rm(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

export async function runDoctor(paths: IBooksPaths, config: CliConfig | null): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  checks.push({
    name: "macOS environment",
    ok: process.platform === "darwin",
    detail: `platform=${process.platform}`,
  });

  try {
    const version = sqliteVersion();
    checks.push({
      name: "sqlite3 available",
      ok: true,
      detail: version,
    });
  } catch (error: unknown) {
    checks.push({
      name: "sqlite3 available",
      ok: false,
      detail: error instanceof Error ? error.message : "not available",
    });
  }

  checks.push({
    name: "BKLibrary readable",
    ok: await canRead(paths.libraryDbPath),
    detail: paths.libraryDbPath,
  });

  checks.push({
    name: "AEAnnotation readable",
    ok: await canRead(paths.annotationDbPath),
    detail: paths.annotationDbPath,
  });

  checks.push({
    name: "Books.plist readable",
    ok: await canRead(paths.booksPlistPath),
    detail: paths.booksPlistPath,
  });

  if (paths.epubInfoDbPath) {
    checks.push({
      name: "EPUB info cache readable",
      ok: await canRead(paths.epubInfoDbPath),
      detail: paths.epubInfoDbPath,
    });
  } else {
    checks.push({
      name: "EPUB info cache readable",
      ok: false,
      detail: "AEEpubInfoSource database not found (publisher may be unavailable)",
    });
  }

  let books = 0;
  let epubBooks = 0;
  let pdfBooks = 0;
  try {
    const list = readBooks(paths.libraryDbPath, paths.annotationDbPath, paths.epubInfoDbPath);
    books = list.length;
    epubBooks = list.filter((book) => book.format === "EPUB").length;
    pdfBooks = list.filter((book) => book.format === "PDF").length;
    checks.push({
      name: "iBooks data query",
      ok: true,
      detail: `books=${books}, epub=${epubBooks}, pdf=${pdfBooks}`,
    });
  } catch (error: unknown) {
    checks.push({
      name: "iBooks data query",
      ok: false,
      detail: error instanceof Error ? error.message : "query failed",
    });
  }

  if (config) {
    const managedOutput = path.join(config.outputDir, config.managedDirName);
    const writable = await canWriteDir(path.dirname(managedOutput));
    checks.push({
      name: "output directory writable",
      ok: writable,
      detail: managedOutput,
    });
  } else {
    checks.push({
      name: "output directory writable",
      ok: false,
      detail: "config not initialized (run: ibooks-notes-sync init)",
    });
  }

  checks.push({
    name: "cpu architecture",
    ok: true,
    detail: `${os.arch()} / node ${process.version}`,
  });

  return {
    ok: checks.every((check) => check.ok),
    checks,
    summary: { books, epubBooks, pdfBooks },
  };
}
