import fs from "node:fs/promises";
import path from "node:path";
import type { EpubAnnotation } from "./types";

const CHAPTER_PATTERN = /\[([^\]]+)\]/;
const XML_ENTITY_PATTERN = /&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g;

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
  const attrPattern = /([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g;
  let match = attrPattern.exec(tag);
  while (match) {
    const key = match[1];
    const value = match[2];
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
};

function parseOpfManifest(opfXml: string): ParsedOpf {
  const manifestHrefById = new Map<string, string>();
  let ncxItemId: string | null = null;

  const spineTagMatch = opfXml.match(/<spine\b[^>]*>/i);
  if (spineTagMatch?.[0]) {
    const spineAttrs = parseXmlAttributes(spineTagMatch[0]);
    ncxItemId = spineAttrs.get("toc") ?? null;
  }

  const itemPattern = /<item\b[^>]*>/gi;
  let itemMatch = itemPattern.exec(opfXml);
  while (itemMatch) {
    const attrs = parseXmlAttributes(itemMatch[0]);
    const id = attrs.get("id");
    const href = attrs.get("href");
    if (id && href) {
      manifestHrefById.set(id, href);
      if (!ncxItemId && attrs.get("media-type") === "application/x-dtbncx+xml") {
        ncxItemId = id;
      }
    }
    itemMatch = itemPattern.exec(opfXml);
  }

  return { manifestHrefById, ncxItemId };
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

export async function readEpubChapterTitleByKey(bookPath: string | null): Promise<Map<string, string>> {
  if (!bookPath) {
    return new Map<string, string>();
  }

  const stat = await fs.stat(bookPath).catch(() => null);
  if (!stat?.isDirectory()) {
    return new Map<string, string>();
  }

  const containerPath = path.join(bookPath, "META-INF", "container.xml");
  const containerXml = await fs.readFile(containerPath, "utf8").catch(() => null);
  if (!containerXml) {
    return new Map<string, string>();
  }

  const rootfileRelativePath = findRootfilePath(containerXml) ?? "OEBPS/content.opf";
  const opfPath = path.resolve(bookPath, rootfileRelativePath);
  const opfXml = await fs.readFile(opfPath, "utf8").catch(() => null);
  if (!opfXml) {
    return new Map<string, string>();
  }

  const opfDir = path.dirname(opfPath);
  const { manifestHrefById, ncxItemId } = parseOpfManifest(opfXml);
  if (!ncxItemId) {
    return new Map<string, string>();
  }

  const ncxHref = manifestHrefById.get(ncxItemId);
  if (!ncxHref) {
    return new Map<string, string>();
  }

  const ncxPath = path.resolve(opfDir, ncxHref);
  const ncxXml = await fs.readFile(ncxPath, "utf8").catch(() => null);
  if (!ncxXml) {
    return new Map<string, string>();
  }

  const hrefToTitle = parseTocHrefTitleMap(ncxXml);
  if (hrefToTitle.size === 0) {
    return new Map<string, string>();
  }

  const chapterTitleByKey = new Map<string, string>();
  for (const [key, href] of manifestHrefById.entries()) {
    const contentAbsolute = path.resolve(opfDir, href);
    let matchedTitle: string | null = null;
    for (const [tocHref, tocTitle] of hrefToTitle.entries()) {
      const tocAbsolute = path.resolve(path.dirname(ncxPath), tocHref);
      if (tocAbsolute === contentAbsolute) {
        matchedTitle = tocTitle;
        break;
      }
    }
    if (matchedTitle) {
      chapterTitleByKey.set(key, matchedTitle);
    }
  }

  return chapterTitleByKey;
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
