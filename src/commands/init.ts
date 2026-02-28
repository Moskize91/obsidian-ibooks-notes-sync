import type { Command } from "commander";
import path from "node:path";
import {
  configExists,
  getConfigPath,
  getDefaultConfig,
  isPdfRenderBackend,
  parsePdfRenderBackend,
  writeConfig,
} from "../lib/config";
import { expandHome } from "../lib/path-utils";
import type { CliConfig } from "../lib/types";

type InitOptions = {
  force?: boolean;
  outputDir?: string;
  managedDirName?: string;
  pdfBetaEnabled?: boolean;
  pdfBetaDisabled?: boolean;
  pdfRenderer?: string;
};

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize CLI configuration")
    .option("--force", "overwrite existing config")
    .option("--output-dir <path>", "root output directory (for example: ~/Documents)")
    .option("--managed-dir-name <name>", "managed subdirectory name")
    .option("--pdf-beta-enabled", "enable PDF beta flow", true)
    .option("--pdf-beta-disabled", "disable PDF beta flow")
    .option("--pdf-renderer <backend>", "pdf renderer backend: auto|swift|mutool|poppler")
    .action((options: InitOptions) => {
      void (async () => {
        if (options.pdfRenderer && !isPdfRenderBackend(options.pdfRenderer)) {
          console.error("Invalid --pdf-renderer value. Expected one of: auto|swift|mutool|poppler");
          process.exitCode = 1;
          return;
        }

        const exists = await configExists();
        if (exists && !options.force) {
          console.log(`Config already exists: ${getConfigPath()}`);
          console.log("Use --force to overwrite.");
          return;
        }

        const defaults = getDefaultConfig();
        const config: CliConfig = {
          outputDir: path.resolve(expandHome(options.outputDir ?? defaults.outputDir)),
          managedDirName: options.managedDirName ?? defaults.managedDirName,
          pdfBetaEnabled:
            options.pdfBetaDisabled !== undefined ? false : (options.pdfBetaEnabled ?? defaults.pdfBetaEnabled),
          pdfRenderBackend: parsePdfRenderBackend(options.pdfRenderer, defaults.pdfRenderBackend),
        };

        await writeConfig(config);
        console.log(`Config saved: ${getConfigPath()}`);
        console.log(`- outputDir: ${config.outputDir}`);
        console.log(`- managedDirName: ${config.managedDirName}`);
        console.log(`- pdfBetaEnabled: ${config.pdfBetaEnabled}`);
        console.log(`- pdfRenderBackend: ${config.pdfRenderBackend}`);
      })().catch((error: unknown) => {
        if (error instanceof Error) {
          console.error(error.message);
        } else {
          console.error("failed to initialize config");
        }
        process.exitCode = 1;
      });
    });
}
