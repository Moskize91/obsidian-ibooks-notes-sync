import type { Command } from "commander";

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Run basic environment checks")
    .action(() => {
      console.log("doctor: not implemented yet");
    });
}
