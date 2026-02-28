import test from "node:test";
import assert from "node:assert/strict";
import { shouldForcePdfResync } from "../src/lib/sync";
import type { SyncAssetState } from "../src/lib/types";

function buildAsset(assetId: string): SyncAssetState {
  return {
    assetId,
    title: assetId,
    format: "PDF",
    hash: "PDF|mod:1|file:1:1|schema:30",
    bookFileRelativePath: `books/${assetId}.md`,
    pdfAssetDirRelativePath: `assets/pdf/${assetId}`,
  };
}

test("shouldForcePdfResync returns true when prior state exists and assets root is missing", () => {
  const assets: Record<string, SyncAssetState> = {
    "asset-1": buildAsset("asset-1"),
  };
  assert.equal(shouldForcePdfResync(assets, false), true);
});

test("shouldForcePdfResync returns false when assets root exists", () => {
  const assets: Record<string, SyncAssetState> = {
    "asset-1": buildAsset("asset-1"),
  };
  assert.equal(shouldForcePdfResync(assets, true), false);
});

test("shouldForcePdfResync returns false when there is no prior sync state", () => {
  assert.equal(shouldForcePdfResync({}, false), false);
});
