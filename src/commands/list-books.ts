import type { Command } from "commander";
import { readBooks } from "../lib/ibooks-data";
import { resolveIbooksPaths } from "../lib/ibooks-paths";

type ListBooksOptions = {
  json?: boolean;
};

function pad(input: string, width: number): string {
  return input.length >= width ? input : `${input}${" ".repeat(width - input.length)}`;
}

export function registerListBooksCommand(program: Command): void {
  program
    .command("list-books")
    .description("List books available from iBooks data source")
    .option("--json", "print JSON output")
    .action((options: ListBooksOptions) => {
      void (async () => {
        const paths = await resolveIbooksPaths();
        const books = readBooks(paths.libraryDbPath, paths.annotationDbPath, paths.epubInfoDbPath).filter((book) => {
          return book.format === "EPUB" || book.format === "PDF";
        });

        if (options.json) {
          console.log(JSON.stringify(books, null, 2));
          return;
        }

        const hasPublisher = books.some((book) => Boolean(book.publisher));
        const headers = hasPublisher
          ? ["Title", "Author", "Publisher", "Format", "Annotations"]
          : ["Title", "Author", "Format", "Annotations"];
        const widths = hasPublisher ? [40, 20, 20, 8, 11] : [40, 24, 8, 11];

        const headerLine = headers.map((header, index) => pad(header, widths[index] ?? 10)).join("  ");
        console.log(headerLine);
        console.log("-".repeat(headerLine.length));
        for (const book of books) {
          const title = pad(book.title.slice(0, 40), widths[0] ?? 40);
          const author = pad((book.author ?? "-").slice(0, hasPublisher ? 20 : 24), widths[1] ?? 24);
          if (hasPublisher) {
            const publisher = pad((book.publisher ?? "-").slice(0, 20), widths[2] ?? 20);
            const format = pad(book.format, widths[3] ?? 8);
            const count = pad(String(book.annotationCount), widths[4] ?? 11);
            console.log([title, author, publisher, format, count].join("  "));
          } else {
            const format = pad(book.format, widths[2] ?? 8);
            const count = pad(String(book.annotationCount), widths[3] ?? 11);
            console.log([title, author, format, count].join("  "));
          }
        }
        console.log("");
        console.log(`total: ${books.length}`);
      })().catch((error: unknown) => {
        if (error instanceof Error) {
          console.error(error.message);
        } else {
          console.error("list-books failed");
        }
        process.exitCode = 1;
      });
    });
}
