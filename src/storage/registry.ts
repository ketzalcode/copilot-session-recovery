import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";

import { resolveSessionIdPrefix, isSessionId } from "../session/ids.ts";
import { emptyRegistry } from "../session/lifecycle.ts";
import {
  SESSION_REGISTRY_SCHEMA_VERSION,
  type SessionRegistry,
  type SessionStartSource,
} from "../session/model.ts";
import { atomicWriteJson } from "./atomic-json.ts";
import { withFileLock } from "./file-lock.ts";
import type { AppPaths } from "./paths.ts";

const REGISTRY_KEYS = ["schemaVersion", "sessions"] as const;
const SESSION_KEYS = [
  "cwd",
  "lastSeenAt",
  "launcherProfile",
  "sessionId",
  "source",
  "startedAt",
] as const;
const START_SOURCES = new Set<SessionStartSource>(["startup", "resume", "new"]);

interface ReadRegistryOptions {
  now?: () => Date;
  afterRead?: (bytes: Buffer) => Promise<void> | void;
}

function isErrnoException(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function assertOnlyKeys(
  input: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string,
): void {
  for (const key of Object.keys(input)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(`${label} contains an unexpected field "${key}".`);
    }
  }
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function isoValue(value: unknown, label: string): string {
  const text = nonEmptyString(value, label);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== text) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }

  return text;
}

function timestampSuffix(timestamp: Date): string {
  return timestamp.toISOString().replace(/\D/g, "").slice(0, 14);
}

async function existingEvidenceForBytes(
  corruptDir: string,
  hash: string,
  bytes: Buffer,
): Promise<string | undefined> {
  let entries: string[];
  try {
    entries = await readdir(corruptDir);
  } catch (error) {
    if (isErrnoException(error, "ENOENT")) {
      return undefined;
    }

    throw error;
  }

  const suffix = `.${hash}.json`;
  for (const entry of entries.sort()) {
    if (!entry.startsWith("sessions.") || !entry.endsWith(suffix)) {
      continue;
    }

    const evidencePath = path.join(corruptDir, entry);
    const existingBytes = await readFile(evidencePath);
    if (existingBytes.equals(bytes)) {
      return evidencePath;
    }

    throw new Error(
      `Corrupt registry evidence hash collision at ${evidencePath}.`,
    );
  }

  return undefined;
}

async function writeEvidenceBytes(
  evidencePath: string,
  bytes: Buffer,
): Promise<void> {
  const handle = await open(evidencePath, "wx", 0o600);
  let writeError: unknown;

  try {
    await handle.writeFile(bytes);
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
    try {
      await rm(evidencePath, { force: true });
    } catch {
      // Best-effort cleanup must not hide the evidence write failure.
    }

    throw writeError;
  }
}

async function preserveCorruptRegistry(
  registryFile: string,
  corruptDir: string,
  bytes: Buffer,
  fallbackTimestamp: Date,
): Promise<string> {
  await mkdir(corruptDir, { recursive: true });

  const hash = createHash("sha256").update(bytes).digest("hex");
  const existingEvidencePath = await existingEvidenceForBytes(
    corruptDir,
    hash,
    bytes,
  );
  if (existingEvidencePath !== undefined) {
    return existingEvidencePath;
  }

  const modifiedAt = await stat(registryFile)
    .then((metadata) => metadata.mtime)
    .catch(() => fallbackTimestamp);
  const evidencePath = path.join(
    corruptDir,
    `sessions.${timestampSuffix(modifiedAt)}.${hash}.json`,
  );

  try {
    await writeEvidenceBytes(evidencePath, bytes);
  } catch (error) {
    if (!isErrnoException(error, "EEXIST")) {
      throw error;
    }

    const existingBytes = await readFile(evidencePath);
    if (!existingBytes.equals(bytes)) {
      throw new Error(
        `Corrupt registry evidence hash collision at ${evidencePath}.`,
        { cause: error },
      );
    }
  }

  return evidencePath;
}

async function workingDirectoryMissing(cwd: string): Promise<boolean> {
  try {
    const metadata = await stat(cwd);
    return !metadata.isDirectory();
  } catch (error) {
    if (isErrnoException(error, "ENOENT")) {
      return true;
    }

    throw error;
  }
}

export class RegistryCorruptError extends Error {
  readonly evidencePath: string;

  constructor(
    message: string,
    evidencePath: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "RegistryCorruptError";
    this.evidencePath = evidencePath;
  }
}

export function parseRegistry(value: unknown): SessionRegistry {
  const input = objectValue(value, "Registry");
  assertOnlyKeys(input, REGISTRY_KEYS, "Registry");

  if (input.schemaVersion !== SESSION_REGISTRY_SCHEMA_VERSION) {
    throw new Error(
      `Registry schemaVersion must be ${SESSION_REGISTRY_SCHEMA_VERSION}.`,
    );
  }

  const rawSessions = objectValue(input.sessions, "Registry sessions");
  const sessions: SessionRegistry["sessions"] = {};

  for (const [key, rawRecord] of Object.entries(rawSessions)) {
    const record = objectValue(rawRecord, `Session ${key}`);
    assertOnlyKeys(record, SESSION_KEYS, `Session ${key}`);

    const sessionId = nonEmptyString(record.sessionId, `Session ${key} sessionId`);
    if (!isSessionId(sessionId) || key !== sessionId) {
      throw new Error(`Session map key ${key} must match a valid sessionId.`);
    }

    const source = nonEmptyString(record.source, `Session ${key} source`);
    if (!START_SOURCES.has(source as SessionStartSource)) {
      throw new Error(`Session ${key} contains an invalid source.`);
    }

    sessions[key] = {
      sessionId,
      cwd: nonEmptyString(record.cwd, `Session ${key} cwd`),
      launcherProfile: nonEmptyString(
        record.launcherProfile,
        `Session ${key} launcherProfile`,
      ),
      source: source as SessionStartSource,
      startedAt: isoValue(record.startedAt, `Session ${key} startedAt`),
      lastSeenAt: isoValue(record.lastSeenAt, `Session ${key} lastSeenAt`),
    };
  }

  return {
    schemaVersion: SESSION_REGISTRY_SCHEMA_VERSION,
    sessions,
  };
}

export async function readRegistry(
  registryFile: string,
  corruptDir: string,
  options: ReadRegistryOptions = {},
): Promise<SessionRegistry> {
  let bytes: Buffer;

  try {
    bytes = await readFile(registryFile);
  } catch (error) {
    if (isErrnoException(error, "ENOENT")) {
      return emptyRegistry();
    }

    throw error;
  }

  await options.afterRead?.(Buffer.from(bytes));

  try {
    return parseRegistry(JSON.parse(bytes.toString("utf8")));
  } catch (error) {
    const evidencePath = await preserveCorruptRegistry(
      registryFile,
      corruptDir,
      bytes,
      options.now?.() ?? new Date(),
    );

    throw new RegistryCorruptError(
      `Registry is corrupt. Preserved evidence at ${evidencePath}.`,
      evidencePath,
      error,
    );
  }
}

export async function updateRegistry(
  paths: AppPaths,
  mutate: (current: SessionRegistry) => SessionRegistry,
): Promise<SessionRegistry> {
  return withFileLock(paths.lockFile, async () => {
    const current = await readRegistry(paths.registryFile, paths.corruptDir);
    const next = parseRegistry(mutate(current));
    await atomicWriteJson(paths.registryFile, next);
    return next;
  });
}

export async function resetCorruptRegistry(paths: AppPaths): Promise<string> {
  return withFileLock(paths.lockFile, async () => {
    let evidencePath = "";

    try {
      await readRegistry(paths.registryFile, paths.corruptDir);
    } catch (error) {
      if (!(error instanceof RegistryCorruptError)) {
        throw error;
      }

      evidencePath = error.evidencePath;
    }

    if (evidencePath.length === 0) {
      throw new Error("Registry is valid; reset was refused.");
    }

    await atomicWriteJson(paths.registryFile, emptyRegistry());
    return evidencePath;
  });
}

export async function removeSessionByPrefix(
  paths: AppPaths,
  prefix: string,
): Promise<string> {
  let removed = "";

  await updateRegistry(paths, (registry) => {
    removed = resolveSessionIdPrefix(Object.keys(registry.sessions), prefix);
    const sessions = { ...registry.sessions };
    delete sessions[removed];
    return { ...registry, sessions };
  });

  return removed;
}

export async function pruneMissingWorkingDirectories(
  paths: AppPaths,
  approvedSessionIds: ReadonlySet<string>,
): Promise<string[]> {
  return withFileLock(paths.lockFile, async () => {
    const current = await readRegistry(paths.registryFile, paths.corruptDir);
    const sessions = { ...current.sessions };
    const removed: string[] = [];

    for (const [sessionId, record] of Object.entries(current.sessions)) {
      if (!approvedSessionIds.has(sessionId)) {
        continue;
      }

      if (!(await workingDirectoryMissing(record.cwd))) {
        continue;
      }

      delete sessions[sessionId];
      removed.push(sessionId);
    }

    if (removed.length > 0) {
      await atomicWriteJson(
        paths.registryFile,
        parseRegistry({
          schemaVersion: current.schemaVersion,
          sessions,
        }),
      );
    }

    return removed;
  });
}
