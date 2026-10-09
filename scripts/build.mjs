import { build } from "esbuild";
import { mkdir, readFile, rm } from "node:fs/promises";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

await build({
  entryPoints: ["src/cli/main.ts"],
  outfile: "dist/copilot-session-recovery.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: "external",
  minify: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
});
