import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const executable = "dist/copilot-auto-save-windows-x64.exe";
const bytes = await readFile(executable);
const hash = createHash("sha256").update(bytes).digest("hex");

await writeFile(
  `${executable}.sha256`,
  `${hash}  ${path.basename(executable)}\n`,
  "utf8",
);
