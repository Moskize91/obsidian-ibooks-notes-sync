import type { Command } from "commander";
import { configExists, readConfig } from "../lib/config";
import { resolveIbooksPaths } from "../lib/ibooks-paths";
import { runSync } from "../lib/sync";

type SyncOptions = {
  dryRun?: boolean;
  book?: string;
};

export function registerSyncCommand(program: Command): void {
  program
    .command("sync")
    .description("Run note synchronization")
    .option("--dry-run", "preview changes without writing files")
    .option("--book <keyword>", "sync only books matching keyword/title/asset id")
    .action((options: SyncOptions) => {
      void (async () => {
        const hasConfig = await configExists();
        if (!hasConfig) {
          console.error("Config not found. Run `ibooks-notes-sync init` first.");
          process.exitCode = 1;
          return;
        }

        const config = await readConfig();
        const paths = await resolveIbooksPaths();
        const syncOptions: { dryRun: boolean; bookFilter?: string } = {
          dryRun: Boolean(options.dryRun),
        };
        if (options.book) {
          syncOptions.bookFilter = options.book;
        }

        const result = await runSync(config, paths, syncOptions);

        const prefix = options.dryRun ? "dry-run" : "sync";
        console.log(
          `${prefix} summary: total=${result.stats.totalBooks}, success=${result.stats.successBooks}, failed=${result.stats.failedBooks}, skipped=${result.stats.skippedBooks}, files=${result.stats.generatedFiles}`,
        );
        console.log(`output: ${result.outputDir}`);
      })().catch((error: unknown) => {
        if (error instanceof Error) {
          console.error(error.message);
        } else {
          console.error("sync failed");
        }
        process.exitCode = 1;
      });
    });
}
