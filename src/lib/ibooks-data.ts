import { extractChapterKey } from "./epub";
import { querySqlite } from "./sqlite";
import type { Book, BookFormat, EpubAnnotation } from "./types";

type RawBookRow = {
  assetId: string;
  title: string | null;
  author: string | null;
  path: string | null;
  contentType: number;
  annotationCount: number | null;
  publisher: string | null;
};

type RawEpubAnnotationRow = {
  id: string | null;
  assetId: string;
  annotationType: number | null;
  selectedText: string | null;
  noteText: string | null;
  location: string | null;
  creationDate: number | null;
};

type RawPdfFallbackRow = {
  assetId: string;
  fallbackCount: number;
};

type RawAssetAnnotationModificationRow = {
  assetId: string;
  maxModificationDate: number | null;
};

const APPLE_EPOCH_SECONDS = 978307200;

function toFormat(contentType: number): BookFormat {
  if (contentType === 1) {
    return "EPUB";
  }
  if (contentType === 3) {
    return "PDF";
  }
  if (contentType === 4) {
    return "IBOOKS";
  }
  return "UNKNOWN";
}

function quoteSqlPath(inputPath: string): string {
  return inputPath.replace(/'/g, "''");
}

function normalizeNullableText(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toDateFromAppleEpoch(value: number | null): Date {
  if (!value || Number.isNaN(value)) {
    return new Date(0);
  }
  return new Date((value + APPLE_EPOCH_SECONDS) * 1000);
}

export function readBooks(
  libraryDbPath: string,
  annotationDbPath: string,
  epubInfoDbPath: string | null,
): Book[] {
  const quotedAnnoPath = quoteSqlPath(annotationDbPath);
  const maybeAttachEpub = epubInfoDbPath
    ? `ATTACH DATABASE '${quoteSqlPath(epubInfoDbPath)}' AS epubinfo;`
    : "";
  const maybeJoinEpub = epubInfoDbPath
    ? "LEFT JOIN epubinfo.ZAEBOOKINFO info ON info.ZDATABASEKEY = b.ZASSETID"
    : "";
  const maybeSelectPublisher = epubInfoDbPath ? "info.ZPUBLISHERNAME AS publisher" : "NULL AS publisher";

  const sql = `
    ATTACH DATABASE '${quotedAnnoPath}' AS anno;
    ${maybeAttachEpub}
    SELECT
      b.ZASSETID AS assetId,
      b.ZTITLE AS title,
      b.ZAUTHOR AS author,
      b.ZPATH AS path,
      b.ZCONTENTTYPE AS contentType,
      COALESCE(cnt.annotationCount, 0) AS annotationCount,
      ${maybeSelectPublisher}
    FROM ZBKLIBRARYASSET b
    LEFT JOIN (
      SELECT
        ZANNOTATIONASSETID AS assetId,
        COUNT(*) AS annotationCount
      FROM anno.ZAEANNOTATION
      WHERE ZANNOTATIONDELETED IS NULL OR ZANNOTATIONDELETED = 0
      GROUP BY ZANNOTATIONASSETID
    ) cnt ON cnt.assetId = b.ZASSETID
    ${maybeJoinEpub}
    WHERE b.ZCONTENTTYPE IN (1, 3, 4)
    ORDER BY b.ZTITLE COLLATE NOCASE;
  `;

  const rows = querySqlite<RawBookRow>(libraryDbPath, sql);

  return rows.map((row) => {
    return {
      assetId: row.assetId,
      title: normalizeNullableText(row.title) ?? `Unknown-${row.assetId.slice(0, 8)}`,
      author: normalizeNullableText(row.author),
      publisher: normalizeNullableText(row.publisher),
      path: normalizeNullableText(row.path),
      format: toFormat(row.contentType),
      annotationCount: Number(row.annotationCount ?? 0),
    };
  });
}

export function readEpubAnnotations(annotationDbPath: string, libraryDbPath: string): EpubAnnotation[] {
  const sql = `
    ATTACH DATABASE '${quoteSqlPath(libraryDbPath)}' AS lib;
    SELECT
      a.ZANNOTATIONUUID AS id,
      a.ZANNOTATIONASSETID AS assetId,
      a.ZANNOTATIONTYPE AS annotationType,
      a.ZANNOTATIONSELECTEDTEXT AS selectedText,
      a.ZANNOTATIONNOTE AS noteText,
      a.ZANNOTATIONLOCATION AS location,
      a.ZANNOTATIONCREATIONDATE AS creationDate
    FROM ZAEANNOTATION a
    INNER JOIN lib.ZBKLIBRARYASSET b ON b.ZASSETID = a.ZANNOTATIONASSETID
    WHERE (a.ZANNOTATIONDELETED IS NULL OR a.ZANNOTATIONDELETED = 0)
      AND b.ZCONTENTTYPE = 1;
  `;

  const rows = querySqlite<RawEpubAnnotationRow>(annotationDbPath, sql);

  return rows
    .map((row) => {
      const selectedText = normalizeNullableText(row.selectedText);
      const noteText = normalizeNullableText(row.noteText);
      const annotationType = Number(row.annotationType ?? 0);

      let kind: EpubAnnotation["kind"] = "unknown";
      if (annotationType === 2) {
        kind = "highlight";
      } else if (annotationType === 1 || annotationType === 3) {
        kind = "bookmark";
      } else if (noteText) {
        kind = "note";
      }

      return {
        id: row.id ?? `${row.assetId}-${Number(row.creationDate ?? 0)}-${normalizeNullableText(row.location) ?? "na"}`,
        assetId: row.assetId,
        chapterKey: extractChapterKey(row.location),
        selectedText,
        noteText,
        location: normalizeNullableText(row.location),
        createdAt: toDateFromAppleEpoch(row.creationDate),
        kind,
      };
    })
    .filter((annotation) => {
      if (annotation.kind === "highlight") {
        return Boolean(annotation.selectedText);
      }

      return Boolean(annotation.selectedText || annotation.noteText);
    });
}

export function readPdfFallbackCounts(annotationDbPath: string, libraryDbPath: string): Map<string, number> {
  const sql = `
    ATTACH DATABASE '${quoteSqlPath(libraryDbPath)}' AS lib;
    SELECT
      a.ZANNOTATIONASSETID AS assetId,
      COUNT(*) AS fallbackCount
    FROM ZAEANNOTATION a
    INNER JOIN lib.ZBKLIBRARYASSET b ON b.ZASSETID = a.ZANNOTATIONASSETID
    WHERE (a.ZANNOTATIONDELETED IS NULL OR a.ZANNOTATIONDELETED = 0)
      AND b.ZCONTENTTYPE = 3
    GROUP BY a.ZANNOTATIONASSETID;
  `;

  const rows = querySqlite<RawPdfFallbackRow>(annotationDbPath, sql);
  const result = new Map<string, number>();
  for (const row of rows) {
    result.set(row.assetId, Number(row.fallbackCount ?? 0));
  }
  return result;
}

export function readAnnotationMaxModificationDates(
  annotationDbPath: string,
  libraryDbPath: string,
): Map<string, number | null> {
  const sql = `
    ATTACH DATABASE '${quoteSqlPath(libraryDbPath)}' AS lib;
    SELECT
      a.ZANNOTATIONASSETID AS assetId,
      MAX(a.ZANNOTATIONMODIFICATIONDATE) AS maxModificationDate
    FROM ZAEANNOTATION a
    INNER JOIN lib.ZBKLIBRARYASSET b ON b.ZASSETID = a.ZANNOTATIONASSETID
    WHERE (a.ZANNOTATIONDELETED IS NULL OR a.ZANNOTATIONDELETED = 0)
      AND b.ZCONTENTTYPE IN (1, 3)
    GROUP BY a.ZANNOTATIONASSETID;
  `;

  const rows = querySqlite<RawAssetAnnotationModificationRow>(annotationDbPath, sql);
  const result = new Map<string, number | null>();
  for (const row of rows) {
    const value = row.maxModificationDate;
    if (value === null || Number.isNaN(Number(value))) {
      result.set(row.assetId, null);
      continue;
    }
    result.set(row.assetId, Number(value));
  }
  return result;
}
