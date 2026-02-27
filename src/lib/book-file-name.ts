import path from "node:path";
import { sanitizeFileName } from "./path-utils";
import type { Book, SyncableBookFormat } from "./types";

export const SHORT_BOOK_FILE_STEM_MAX_LENGTH = 40;

export function toShortBookFileStem(title: string): string {
  const sanitized = sanitizeFileName(title);
  return sanitized.slice(0, SHORT_BOOK_FILE_STEM_MAX_LENGTH) || "untitled";
}

export function buildBookFileRelativePathByAssetId(
  books: Array<Book & { format: SyncableBookFormat }>,
  hasOutputByAssetId: Map<string, boolean>,
  booksDirName: string,
): Map<string, string | null> {
  const result = new Map<string, string | null>();
  const groups = new Map<string, Array<Book & { format: SyncableBookFormat }>>();

  for (const book of books) {
    if (!(hasOutputByAssetId.get(book.assetId) ?? false)) {
      result.set(book.assetId, null);
      continue;
    }

    const shortStem = toShortBookFileStem(book.title);
    const group = groups.get(shortStem) ?? [];
    group.push(book);
    groups.set(shortStem, group);
  }

  const sortedStems = Array.from(groups.keys()).sort((left, right) => left.localeCompare(right));
  for (const stem of sortedStems) {
    const group = groups.get(stem) ?? [];
    group.sort((left, right) => left.assetId.localeCompare(right.assetId));

    for (const [index, book] of group.entries()) {
      const suffix = index === 0 ? "" : `_${index + 1}`;
      const fileName = `${stem}${suffix}.md`;
      result.set(book.assetId, path.posix.join(booksDirName, fileName));
    }
  }

  return result;
}
