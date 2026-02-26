import fs from "node:fs/promises";
import path from "node:path";
import type { SyncAssetState, SyncState, SyncableBookFormat } from "./types";

const STATE_FILE_NAME = ".sync-state.json";
const LOCK_FILE_NAME = ".sync.lock";

type PdfFileStamp = {
  mtimeMs: number;
  size: number;
};

function createEmptyState(): SyncState {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    assets: {},
  };
}

function asSyncableFormat(value: unknown): SyncableBookFormat | null {
  if (value === "EPUB" || value === "PDF") {
    return value;
  }
  return null;
}

function normalizeStateAsset(assetId: string, value: unknown): SyncAssetState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<SyncAssetState>;
  const format = asSyncableFormat(candidate.format);
  if (!format) {
    return null;
  }

  if (
    typeof candidate.hash !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.bookFileRelativePath !== "string"
  ) {
    return null;
  }

  const pdfAssetDirRelativePath =
    typeof candidate.pdfAssetDirRelativePath === "string" ? candidate.pdfAssetDirRelativePath : null;

  return {
    assetId,
    title: candidate.title,
    format,
    hash: candidate.hash,
    bookFileRelativePath: candidate.bookFileRelativePath,
    pdfAssetDirRelativePath,
  };
}

export function getSyncStatePath(outputDir: string): string {
  return path.join(outputDir, STATE_FILE_NAME);
}

export async function readSyncState(outputDir: string): Promise<SyncState> {
  const statePath = getSyncStatePath(outputDir);
  try {
    const raw = await fs.readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<SyncState>;
    if (!parsed || typeof parsed !== "object") {
      return createEmptyState();
    }

    const assets: Record<string, SyncAssetState> = {};
    const rawAssets = parsed.assets;
    if (rawAssets && typeof rawAssets === "object") {
      for (const [assetId, value] of Object.entries(rawAssets)) {
        const normalized = normalizeStateAsset(assetId, value);
        if (normalized) {
          assets[assetId] = normalized;
        }
      }
    }

    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
      assets,
    };
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === "ENOENT") {
      return createEmptyState();
    }
    throw error;
  }
}

export async function writeSyncState(outputDir: string, assets: Record<string, SyncAssetState>): Promise<void> {
  const statePath = getSyncStatePath(outputDir);
  const tempPath = `${statePath}.tmp-${Date.now()}-${process.pid}`;
  const state: SyncState = {
    version: 1,
    updatedAt: new Date().toISOString(),
    assets,
  };

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, statePath);
}

export async function acquireSyncLock(outputDir: string): Promise<() => Promise<void>> {
  await fs.mkdir(outputDir, { recursive: true });
  const lockPath = path.join(outputDir, LOCK_FILE_NAME);

  let handle;
  try {
    handle = await fs.open(lockPath, "wx");
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === "EEXIST") {
      const wrapped = new Error("Another sync process is running. Remove .sync.lock if no sync is active.");
      (wrapped as Error & { cause?: unknown }).cause = error;
      throw wrapped;
    }
    throw error;
  }

  await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`, "utf8");

  let released = false;
  return async () => {
    if (released) {
      return;
    }
    released = true;
    await handle.close();
    await fs.rm(lockPath, { force: true });
  };
}

function toHashNumber(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "null";
  }
  return String(value);
}

function toPdfStamp(stamp: PdfFileStamp | "missing" | null): string {
  if (stamp === "missing") {
    return "missing";
  }
  if (stamp === null) {
    return "null";
  }
  return `${Math.trunc(stamp.mtimeMs)}:${stamp.size}`;
}

export function buildBookSyncHash(
  format: SyncableBookFormat,
  annotationMaxModificationDate: number | null,
  pdfFileStamp: PdfFileStamp | "missing" | null,
): string {
  const base = `${format}|mod:${toHashNumber(annotationMaxModificationDate)}`;
  if (format === "PDF") {
    return `${base}|file:${toPdfStamp(pdfFileStamp)}`;
  }
  return base;
}
