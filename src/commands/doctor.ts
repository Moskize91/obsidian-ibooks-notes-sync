import type { Command } from "commander";
import { configExists, readConfig } from "../lib/config";
import { resolveIbooksPaths } from "../lib/ibooks-paths";
import { runDoctor } from "../lib/doctor";

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Run basic environment checks")
    .action(() => {
      void (async () => {
        const paths = await resolveIbooksPaths();
        const config = (await configExists()) ? await readConfig() : null;
        const report = await runDoctor(paths, config);

        for (const check of report.checks) {
          const status = check.ok ? "PASS" : "FAIL";
          console.log(`[${status}] ${check.name} - ${check.detail}`);
        }

        console.log("");
        console.log(
          `summary: books=${report.summary.books}, epub=${report.summary.epubBooks}, pdf=${report.summary.pdfBooks}`,
        );

        if (!report.ok) {
          process.exitCode = 1;
        }
      })().catch((error: unknown) => {
        if (error instanceof Error) {
          console.error(error.message);
        } else {
          console.error("doctor failed");
        }
        process.exitCode = 1;
      });
    });
}
