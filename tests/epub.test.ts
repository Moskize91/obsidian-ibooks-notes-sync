import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractChapterKey, readEpubChapterTitleByKey, sortEpubAnnotations } from "../src/lib/epub";
import type { EpubAnnotation } from "../src/lib/types";

test("extractChapterKey reads chapter id from epubcfi", () => {
  const chapter = extractChapterKey("epubcfi(/6/8[x_part02.xhtml]!/4/16/1,:18,:31)");
  assert.equal(chapter, "x_part02.xhtml");
});

test("extractChapterKey falls back when location is missing", () => {
  assert.equal(extractChapterKey(null), "未分章");
  assert.equal(extractChapterKey("invalid"), "未分章");
});

test("sortEpubAnnotations is stable by time/location/id", () => {
  const baseDate = new Date("2026-02-08T10:00:00Z");
  const annotations: EpubAnnotation[] = [
    {
      id: "b",
      assetId: "asset",
      chapterKey: "c1",
      selectedText: "B",
      noteText: null,
      location: "epubcfi(/6/8[x]!/4/2/1,:1,:2)",
      createdAt: baseDate,
      kind: "highlight",
    },
    {
      id: "a",
      assetId: "asset",
      chapterKey: "c1",
      selectedText: "A",
      noteText: null,
      location: "epubcfi(/6/8[x]!/4/2/1,:1,:2)",
      createdAt: baseDate,
      kind: "highlight",
    },
  ];

  const sorted = sortEpubAnnotations(annotations);
  assert.equal(sorted[0]?.id, "a");
  assert.equal(sorted[1]?.id, "b");
});

test("readEpubChapterTitleByKey resolves chapter labels from OPF and NCX", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "epub-map-"));
  const bookRoot = path.join(tempRoot, "book.epub");
  await fs.mkdir(path.join(bookRoot, "META-INF"), { recursive: true });
  await fs.mkdir(path.join(bookRoot, "OEBPS"), { recursive: true });

  await fs.writeFile(
    path.join(bookRoot, "META-INF", "container.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`,
    "utf8",
  );

  await fs.writeFile(
    path.join(bookRoot, "OEBPS", "content.opf"),
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <manifest>
    <item id="id_6" href="text00005.html" media-type="application/xhtml+xml"/>
    <item id="id_7" href="text00006.html" media-type="application/xhtml+xml"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="id_6"/>
    <itemref idref="id_7"/>
  </spine>
</package>
`,
    "utf8",
  );

  await fs.writeFile(
    path.join(bookRoot, "OEBPS", "toc.ncx"),
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="n1" playOrder="1">
      <navLabel><text>新版前言</text></navLabel>
      <content src="text00005.html#chapter"/>
    </navPoint>
    <navPoint id="n2" playOrder="2">
      <navLabel><text>《周髀算经》新论</text></navLabel>
      <content src="text00006.html#chapter"/>
    </navPoint>
  </navMap>
</ncx>
`,
    "utf8",
  );

  const chapterTitleByKey = await readEpubChapterTitleByKey(bookRoot);
  assert.equal(chapterTitleByKey.get("id_6"), "新版前言");
  assert.equal(chapterTitleByKey.get("id_7"), "《周髀算经》新论");
});
