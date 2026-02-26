#!/usr/bin/env node

import { Command } from "commander";
import { registerDoctorCommand } from "./commands/doctor";
import { registerInitCommand } from "./commands/init";
import { registerListBooksCommand } from "./commands/list-books";
import { registerSyncCommand } from "./commands/sync";

const program = new Command();

program
  .name("ibooks-notes-sync")
  .description("Sync iBooks notes to local markdown targets")
  .version("0.1.0");

registerInitCommand(program);
registerSyncCommand(program);
registerListBooksCommand(program);
registerDoctorCommand(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error("Unexpected error");
  }
  process.exit(1);
});
