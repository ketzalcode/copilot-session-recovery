import { randomUUID } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import path from "node:path";

function serializeJson(value: unknown): string {
  const text = JSON.stringify(value, null, 2);
  if (text === undefined) {
    throw new Error("Value is not JSON-serializable.");
  }

  return `${text}\n`;
}

async function removeTemporaryFile(filePath: string): Promise<void> {
  try {
    await rm(filePath, { force: true });
  } catch {
    // Best-effort cleanup should not hide the original write error.
  }
}

export async function atomicWriteJson(
  filePath: string,
  value: unknown,
): Promise<void> {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  const handle = await open(temporaryPath, "wx", 0o600);
  let writeError: unknown;

  try {
    await handle.writeFile(serializeJson(value), "utf8");
    await handle.sync();
  } catch (error) {
    writeError = error;
  }

  try {
    await handle.close();
  } catch (error) {
    writeError ??= error;
  }

  if (writeError !== undefined) {
    await removeTemporaryFile(temporaryPath);
    throw writeError;
  }

  try {
    await rename(temporaryPath, filePath);
  } catch (error) {
    await removeTemporaryFile(temporaryPath);
    throw error;
  }
}
