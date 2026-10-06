import { appendFile } from "node:fs/promises";

const logFile = process.env.COPILOT_SESSION_RECOVERY_FAKE_LOG;
if (!logFile) {
  throw new Error("COPILOT_SESSION_RECOVERY_FAKE_LOG is required.");
}

await appendFile(
  logFile,
  `${JSON.stringify({
    executable: process.env.COPILOT_SESSION_RECOVERY_FAKE_NAME,
    argv: process.argv.slice(2),
    cwd: process.cwd(),
  })}\n`,
  "utf8",
);
