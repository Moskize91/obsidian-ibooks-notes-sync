import type { Command } from "commander";

type SyncOptions = {
  dryRun?: boolean;
};

export function registerSyncCommand(program: Command): void {
  program
    .command("sync")
    .description("Run note synchronization")
    .option("--dry-run", "preview changes without writing files")
    .action((options: SyncOptions) => {
      if (options.dryRun) {
        console.log("sync: dry-run mode");
      }
      console.log("sync: not implemented yet");
    });
}
