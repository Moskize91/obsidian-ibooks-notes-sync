import type { Command } from "commander";

type InitOptions = {
  force?: boolean;
};

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize CLI configuration")
    .option("--force", "overwrite existing config")
    .action((options: InitOptions) => {
      if (options.force) {
        console.log("init: force mode enabled");
      }
      console.log("init: not implemented yet");
    });
}
