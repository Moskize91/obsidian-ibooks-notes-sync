import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildBookSyncHash, readSyncState, writeSyncState } from "../src/lib/sync-state";
import type { SyncAssetState } from "../src/lib/types";

test("buildBookSyncHash for EPUB uses annotation modification only", () => {
  const hash = buildBookSyncHash("EPUB", 12345, null);
  assert.equal(hash, "EPUB|mod:12345");
});

test("buildBookSyncHash for PDF includes annotation and file stamp", () => {
  const hash = buildBookSyncHash("PDF", 789, { mtimeMs: 1000.9, size: 2048 });
  assert.equal(hash, "PDF|mod:789|file:1000:2048");
});

test("readSyncState returns empty state when file is missing", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ibooks-sync-state-"));
  try {
    const state = await readSyncState(tempDir);
    assert.equal(state.version, 1);
    assert.deepEqual(state.assets, {});
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("writeSyncState persists assets", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ibooks-sync-state-"));
  try {
    const assets: Record<string, SyncAssetState> = {
      "asset-1": {
        assetId: "asset-1",
        title: "Book 1",
        format: "EPUB",
        hash: "EPUB|mod:10",
        lastSyncedAt: "2026-02-28T00:00:00.000Z",
        bookFileRelativePath: "books/book-1.md",
        pdfAssetDirRelativePath: null,
      },
    };
    await writeSyncState(tempDir, assets);

    const reloaded = await readSyncState(tempDir);
    assert.equal(reloaded.assets["asset-1"]?.hash, "EPUB|mod:10");
    assert.equal(reloaded.assets["asset-1"]?.lastSyncedAt, "2026-02-28T00:00:00.000Z");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
