import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { EpubAnnotation } from "./types";

const CHAPTER_PATTERN = /\[([^\]]+)\]/;
const XML_ENTITY_PATTERN = /&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g;
const execFileAsync = promisify(execFile);

function decodeXmlEntities(input: string): string {
  return input.replace(XML_ENTITY_PATTERN, (match, entity: string) => {
    if (entity === "amp") {
      return "&";
    }
    if (entity === "lt") {
      return "<";
    }
    if (entity === "gt") {
      return ">";
    }
    if (entity === "quot") {
      return '"';
    }
    if (entity === "apos") {
      return "'";
    }

    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const value = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    if (entity.startsWith("#")) {
      const value = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    return match;
  });
}

function parseXmlAttributes(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const attrPattern = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match = attrPattern.exec(tag);
  while (match) {
    const key = match[1];
    const value = match[2] ?? match[3] ?? "";
    if (key && value !== undefined) {
      attrs.set(key, decodeXmlEntities(value));
    }
    match = attrPattern.exec(tag);
  }
  return attrs;
}

function findRootfilePath(containerXml: string): string | null {
  const match = containerXml.match(/<rootfile\b[^>]*\bfull-path="([^"]+)"/i);
  if (!match?.[1]) {
    return null;
  }
  return decodeXmlEntities(match[1]);
}

type ParsedOpf = {
  manifestHrefById: Map<string, string>;
  ncxItemId: string | null;
  navItemId: string | null;
  spineOrderById: Map<string, number>;
};

function parseOpfManifest(opfXml: string): ParsedOpf {
  const manifestHrefById = new Map<string, string>();
  let ncxItemId: string | null = null;
  let navItemId: string | null = null;
  const spineOrderById = new Map<string, number>();

  const spineTagMatch = opfXml.match(/<spine\b[^>]*>/i);
  if (spineTagMatch?.[0]) {
    const spineAttrs = parseXmlAttributes(spineTagMatch[0]);
    ncxItemId = spineAttrs.get("toc") ?? null;
  }

  const itemrefPattern = /<itemref\b[^>]*>/gi;
  let itemrefMatch = itemrefPattern.exec(opfXml);
  let spineIndex = 0;
  while (itemrefMatch) {
    const attrs = parseXmlAttributes(itemrefMatch[0]);
    const idref = attrs.get("idref");
    if (idref && !spineOrderById.has(idref)) {
      spineOrderById.set(idref, spineIndex);
      spineIndex += 1;
    }
    itemrefMatch = itemrefPattern.exec(opfXml);
  }

  const itemPattern = /<item\b[^>]*>/gi;
  let itemMatch = itemPattern.exec(opfXml);
  while (itemMatch) {
    const attrs = parseXmlAttributes(itemMatch[0]);
    const id = attrs.get("id");
    const href = attrs.get("href");
    if (id && href) {
      manifestHrefById.set(id, href);
      const properties = attrs
        .get("properties")
        ?.split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 0);
      if (!navItemId && properties?.includes("nav")) {
        navItemId = id;
      }
      if (!ncxItemId && attrs.get("media-type") === "application/x-dtbncx+xml") {
        ncxItemId = id;
      }
    }
    itemMatch = itemPattern.exec(opfXml);
  }

  return { manifestHrefById, ncxItemId, navItemId, spineOrderById };
}

function parseTocHrefTitleMap(ncxXml: string): Map<string, string> {
  const hrefToTitle = new Map<string, string>();
  const navPointPattern =
    /<navPoint\b[\s\S]*?<navLabel>\s*<text>([\s\S]*?)<\/text>\s*<\/navLabel>[\s\S]*?<content\b[^>]*\bsrc="([^"]+)"/gi;
  let navMatch = navPointPattern.exec(ncxXml);
  while (navMatch) {
    const title = decodeXmlEntities(navMatch[1] ?? "").replace(/\s+/g, " ").trim();
    const src = decodeXmlEntities(navMatch[2] ?? "");
    const href = src.split("#")[0]?.trim();
    if (title && href && !hrefToTitle.has(href)) {
      hrefToTitle.set(href, title);
    }
    navMatch = navPointPattern.exec(ncxXml);
  }
  return hrefToTitle;
}

function stripHtmlTags(input: string): string {
  return input.replace(/<[^>]*>/g, "");
}

function parseNavHrefTitleMap(navXml: string): Map<string, string> {
  const hrefToTitle = new Map<string, string>();
  const tocNavMatch = navXml.match(/<nav\b[^>]*(?:\bepub:type|\btype)\s*=\s*(?:"toc"|'toc')[^>]*>([\s\S]*?)<\/nav>/i);
  const navBody = tocNavMatch?.[1] ?? navXml;
  const linkPattern = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/gi;

  let linkMatch = linkPattern.exec(navBody);
  while (linkMatch) {
    const hrefRaw = linkMatch[1] ?? linkMatch[2] ?? "";
    const href = decodeXmlEntities(hrefRaw).split("#")[0]?.trim();
    const titleRaw = stripHtmlTags(linkMatch[3] ?? "");
    const title = decodeXmlEntities(titleRaw).replace(/\s+/g, " ").trim();
    if (title && href && !hrefToTitle.has(href)) {
      hrefToTitle.set(href, title);
    }
    linkMatch = linkPattern.exec(navBody);
  }

  return hrefToTitle;
}

function normalizeEpubRelativePath(inputPath: string): string {
  const normalized = path.posix.normalize(inputPath.replace(/\\/g, "/"));
  return normalized.replace(/^\/+/, "").replace(/^(?:\.\.\/)+/g, "");
}

function resolveEpubRelativePath(baseDir: string, href: string): string {
  return normalizeEpubRelativePath(path.posix.join(baseDir, href));
}

async function readDirectoryEntryText(rootPath: string, relativePath: string): Promise<string | null> {
  const filePath = path.resolve(rootPath, relativePath);
  return fs.readFile(filePath, "utf8").catch(() => null);
}

async function readZipEntryText(zipPath: string, relativePath: string): Promise<string | null> {
  const entryPath = normalizeEpubRelativePath(relativePath);
  try {
    const { stdout } = await execFileAsync("unzip", ["-p", zipPath, entryPath], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return null;
  }
}

async function readEpubEntryText(bookPath: string, isDirectory: boolean, relativePath: string): Promise<string | null> {
  if (isDirectory) {
    return readDirectoryEntryText(bookPath, relativePath);
  }
  return readZipEntryText(bookPath, relativePath);
}

function buildChapterTitleMapByHrefResolution(
  manifestHrefById: Map<string, string>,
  hrefToTitle: Map<string, string>,
  opfRelativePath: string,
  tocRelativePath: string,
): Map<string, string> {
  const chapterTitleByKey = new Map<string, string>();
  const opfDir = path.posix.dirname(opfRelativePath);
  const tocDir = path.posix.dirname(tocRelativePath);
  const resolvedTitleByPath = new Map<string, string>();

  for (const [tocHref, title] of hrefToTitle.entries()) {
    const resolvedTocPath = resolveEpubRelativePath(tocDir, tocHref);
    if (!resolvedTitleByPath.has(resolvedTocPath)) {
      resolvedTitleByPath.set(resolvedTocPath, title);
    }
  }

  for (const [key, href] of manifestHrefById.entries()) {
    const contentPath = resolveEpubRelativePath(opfDir, href);
    const matchedTitle = resolvedTitleByPath.get(contentPath);
    if (matchedTitle) {
      chapterTitleByKey.set(key, matchedTitle);
    }
  }

  return chapterTitleByKey;
}

export async function readEpubChapterTitleByKey(bookPath: string | null): Promise<Map<string, string>> {
  if (!bookPath) {
    return new Map<string, string>();
  }

  const stat = await fs.stat(bookPath).catch(() => null);
  if (!stat || (!stat.isDirectory() && !stat.isFile())) {
    return new Map<string, string>();
  }
  const isDirectory = stat.isDirectory();

  const containerXml = await readEpubEntryText(bookPath, isDirectory, "META-INF/container.xml");
  if (!containerXml) {
    return new Map<string, string>();
  }

  const rootfileRelativePath = normalizeEpubRelativePath(findRootfilePath(containerXml) ?? "OEBPS/content.opf");
  const opfXml = await readEpubEntryText(bookPath, isDirectory, rootfileRelativePath);
  if (!opfXml) {
    return new Map<string, string>();
  }

  const { manifestHrefById, ncxItemId, navItemId } = parseOpfManifest(opfXml);

  if (ncxItemId) {
    const ncxHref = manifestHrefById.get(ncxItemId);
    if (ncxHref) {
      const ncxRelativePath = resolveEpubRelativePath(path.posix.dirname(rootfileRelativePath), ncxHref);
      const ncxXml = await readEpubEntryText(bookPath, isDirectory, ncxRelativePath);
      if (ncxXml) {
        const hrefToTitle = parseTocHrefTitleMap(ncxXml);
        if (hrefToTitle.size > 0) {
          return buildChapterTitleMapByHrefResolution(manifestHrefById, hrefToTitle, rootfileRelativePath, ncxRelativePath);
        }
      }
    }
  }

  if (navItemId) {
    const navHref = manifestHrefById.get(navItemId);
    if (navHref) {
      const navRelativePath = resolveEpubRelativePath(path.posix.dirname(rootfileRelativePath), navHref);
      const navXml = await readEpubEntryText(bookPath, isDirectory, navRelativePath);
      if (navXml) {
        const hrefToTitle = parseNavHrefTitleMap(navXml);
        if (hrefToTitle.size > 0) {
          return buildChapterTitleMapByHrefResolution(manifestHrefById, hrefToTitle, rootfileRelativePath, navRelativePath);
        }
      }
    }
  }

  return new Map<string, string>();
}

export async function readEpubChapterOrderByKey(bookPath: string | null): Promise<Map<string, number>> {
  if (!bookPath) {
    return new Map<string, number>();
  }

  const stat = await fs.stat(bookPath).catch(() => null);
  if (!stat || (!stat.isDirectory() && !stat.isFile())) {
    return new Map<string, number>();
  }
  const isDirectory = stat.isDirectory();

  const containerXml = await readEpubEntryText(bookPath, isDirectory, "META-INF/container.xml");
  if (!containerXml) {
    return new Map<string, number>();
  }

  const rootfileRelativePath = normalizeEpubRelativePath(findRootfilePath(containerXml) ?? "OEBPS/content.opf");
  const opfXml = await readEpubEntryText(bookPath, isDirectory, rootfileRelativePath);
  if (!opfXml) {
    return new Map<string, number>();
  }

  const { spineOrderById } = parseOpfManifest(opfXml);
  return spineOrderById;
}

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
