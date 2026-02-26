import path from "node:path";
import os from "node:os";

export function expandHome(inputPath: string): string {
  if (inputPath === "~") {
    return os.homedir();
  }

  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  return inputPath;
}

export function sanitizeFileName(input: string): string {
  const sanitized = input
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  return sanitized.length > 0 ? sanitized : "untitled";
}

export function getBookFileName(title: string, assetId: string): string {
  const safeTitle = sanitizeFileName(title).slice(0, 80);
  return `${safeTitle}-${assetId.slice(0, 8)}.md`;
}
