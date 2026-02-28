import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

test("readEpubChapterTitleByKey resolves EPUB3 nav labels from OPF nav", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "epub-nav-map-"));
  const bookRoot = path.join(tempRoot, "book.epub");
  await fs.mkdir(path.join(bookRoot, "META-INF"), { recursive: true });
  await fs.mkdir(path.join(bookRoot, "OPS", "text"), { recursive: true });

  await fs.writeFile(
    path.join(bookRoot, "META-INF", "container.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`,
    "utf8",
  );

  await fs.writeFile(
    path.join(bookRoot, "OPS", "package.opf"),
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <manifest>
    <item id="chapter_1" href="text/chapter-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter_2" href="text/chapter-2.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>
    <itemref idref="chapter_1"/>
    <itemref idref="chapter_2"/>
  </spine>
</package>
`,
    "utf8",
  );

  await fs.writeFile(
    path.join(bookRoot, "OPS", "nav.xhtml"),
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc" id="toc">
      <ol>
        <li><a href="text/chapter-1.xhtml#p1">第一章 导论</a></li>
        <li><a href="text/chapter-2.xhtml#p1">第二章 展开</a></li>
      </ol>
    </nav>
  </body>
</html>
`,
    "utf8",
  );

  const chapterTitleByKey = await readEpubChapterTitleByKey(bookRoot);
  assert.equal(chapterTitleByKey.get("chapter_1"), "第一章 导论");
  assert.equal(chapterTitleByKey.get("chapter_2"), "第二章 展开");
});

test("readEpubChapterTitleByKey supports .epub zip file", async (context) => {
  const unzipCheck = spawnSync("unzip", ["-v"], { stdio: "ignore" });
  const zipCheck = spawnSync("zip", ["-v"], { stdio: "ignore" });
  if (unzipCheck.status !== 0 || zipCheck.status !== 0) {
    context.skip("zip/unzip command not available");
    return;
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "epub-zip-map-"));
  const sourceRoot = path.join(tempRoot, "source");
  await fs.mkdir(path.join(sourceRoot, "META-INF"), { recursive: true });
  await fs.mkdir(path.join(sourceRoot, "OPS", "text"), { recursive: true });

  await fs.writeFile(
    path.join(sourceRoot, "META-INF", "container.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`,
    "utf8",
  );

  await fs.writeFile(
    path.join(sourceRoot, "OPS", "package.opf"),
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <manifest>
    <item id="chapter_1" href="text/chapter-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>
    <itemref idref="chapter_1"/>
  </spine>
</package>
`,
    "utf8",
  );

  await fs.writeFile(
    path.join(sourceRoot, "OPS", "nav.xhtml"),
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc">
      <ol>
        <li><a href="text/chapter-1.xhtml#x">Zip 章节</a></li>
      </ol>
    </nav>
  </body>
</html>
`,
    "utf8",
  );

  const epubPath = path.join(tempRoot, "book.epub");
  const zipResult = spawnSync("zip", ["-qr", epubPath, "META-INF", "OPS"], { cwd: sourceRoot });
  assert.equal(zipResult.status, 0);

  const chapterTitleByKey = await readEpubChapterTitleByKey(epubPath);
  assert.equal(chapterTitleByKey.get("chapter_1"), "Zip 章节");
});
