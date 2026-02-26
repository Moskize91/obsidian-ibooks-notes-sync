import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: false,
  entry: ["src/cli.ts"],
  skipNodeModulesBundle: true,
  format: ["cjs"],
  outDir: "dist",
  sourcemap: true,
  splitting: false,
  target: "node20",
});
