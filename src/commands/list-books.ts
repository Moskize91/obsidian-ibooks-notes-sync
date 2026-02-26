import type { Command } from "commander";

export function registerListBooksCommand(program: Command): void {
  program
    .command("list-books")
    .description("List books available from iBooks data source")
    .action(() => {
      console.log("list-books: not implemented yet");
    });
}
