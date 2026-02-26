import type { LogLevel } from "./types";

export function log(level: LogLevel, message: string): void {
  const prefix = level.toUpperCase();
  const line = `[${prefix}] ${message}`;

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}
