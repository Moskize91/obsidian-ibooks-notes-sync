import type { EpubAnnotation } from "./types";

const CHAPTER_PATTERN = /\[([^\]]+)\]/;

export function extractChapterKey(location: string | null): string {
  if (!location) {
    return "未分章";
  }

  const match = location.match(CHAPTER_PATTERN);
  if (!match?.[1]) {
    return "未分章";
  }

  return match[1];
}

export function sortEpubAnnotations(annotations: EpubAnnotation[]): EpubAnnotation[] {
  return [...annotations].sort((left, right) => {
    if (left.createdAt.getTime() !== right.createdAt.getTime()) {
      return left.createdAt.getTime() - right.createdAt.getTime();
    }

    const leftLocation = left.location ?? "";
    const rightLocation = right.location ?? "";
    if (leftLocation !== rightLocation) {
      return leftLocation.localeCompare(rightLocation);
    }

    return left.id.localeCompare(right.id);
  });
}
