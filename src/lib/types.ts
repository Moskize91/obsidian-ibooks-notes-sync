export type BookFormat = "EPUB" | "PDF" | "IBOOKS" | "UNKNOWN";
export type SyncableBookFormat = "EPUB" | "PDF";

export type LogLevel = "info" | "warn" | "error";

export type SyncMode = "write" | "dry-run";

export type AnnotationKind = "highlight" | "note" | "bookmark" | "unknown";

export type Rect = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type CliConfig = {
  outputDir: string;
  managedDirName: string;
  pdfBetaEnabled: boolean;
};

export type IBooksPaths = {
  booksPlistPath: string;
  libraryDbPath: string;
  annotationDbPath: string;
  epubInfoDbPath: string | null;
};

export type Book = {
  assetId: string;
  title: string;
  author: string | null;
  publisher: string | null;
  path: string | null;
  format: BookFormat;
  annotationCount: number;
};

export type EpubAnnotation = {
  id: string;
  assetId: string;
  chapterKey: string;
  selectedText: string | null;
  noteText: string | null;
  location: string | null;
  createdAt: Date;
  kind: AnnotationKind;
};

export type PdfAnnotation = {
  id: string;
  pageNumber: number;
  subtype: string;
  contents: string | null;
  rect: Rect | null;
};

export type PdfPageAnnotations = {
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  annotations: PdfAnnotation[];
};

export type SyncStats = {
  totalBooks: number;
  successBooks: number;
  failedBooks: number;
  skippedBooks: number;
  generatedFiles: number;
};

export type SyncAssetState = {
  assetId: string;
  title: string;
  format: SyncableBookFormat;
  hash: string;
  bookFileRelativePath: string | null;
  pdfAssetDirRelativePath: string | null;
};

export type SyncState = {
  version: 1;
  updatedAt: string;
  assets: Record<string, SyncAssetState>;
};
