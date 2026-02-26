import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expandHome } from "./path-utils";
import type { CliConfig } from "./types";

const CONFIG_DIR = path.join(os.homedir(), ".config", "ibooks-notes-sync");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function getDefaultConfig(): CliConfig {
  return {
    outputDir: path.join(os.homedir(), "Documents"),
    managedDirName: "ibooks-notes-sync",
    pdfBetaEnabled: true,
  };
}

export async function readConfig(): Promise<CliConfig> {
  const raw = await fs.readFile(CONFIG_PATH, "utf8");
  const parsed = JSON.parse(raw) as Partial<CliConfig>;
  const defaults = getDefaultConfig();

  return {
    outputDir: expandHome(parsed.outputDir ?? defaults.outputDir),
    managedDirName: parsed.managedDirName ?? defaults.managedDirName,
    pdfBetaEnabled: parsed.pdfBetaEnabled ?? defaults.pdfBetaEnabled,
  };
}

export async function writeConfig(config: CliConfig): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export async function configExists(): Promise<boolean> {
  try {
    await fs.access(CONFIG_PATH);
    return true;
  } catch {
    return false;
  }
}
