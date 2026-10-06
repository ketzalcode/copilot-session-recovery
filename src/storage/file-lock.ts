import { randomUUID } from "node:crypto";
import { open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

interface FileLockOptions {
  retryDelayMs?: number;
  timeoutMs?: number;
  staleAfterMs?: number;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
  isProcessAlive?: (pid: number) => boolean | Promise<boolean>;
  createToken?: () => string;
}

interface LockIdentity {
  token: string;
  pid: number;
  createdAt: number;
}

interface MissingLockSnapshot {
  kind: "missing";
}

interface ValidLockSnapshot {
  kind: "valid";
  identity: LockIdentity;
}

interface MalformedLockSnapshot {
  kind: "malformed";
  bytes: Buffer;
  modifiedAtMs: number;
}

type LockSnapshot =
  | MissingLockSnapshot
  | ValidLockSnapshot
  | MalformedLockSnapshot;

interface RecoveryIntent {
  intentPath: string;
  identity: LockIdentity;
}

interface RecoveryIntentName {
  pid: number;
  token: string;
}

function isErrnoException(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function defaultIsProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    // Safety-first for PID reuse: a live PID may not be the original owner, so
    // never reclaim while the operating system reports it alive.
    return true;
  } catch (error) {
    if (isErrnoException(error, "ESRCH")) {
      return false;
    }
    if (isErrnoException(error, "EPERM")) {
      return true;
    }

    throw error;
  }
}

function parseLockIdentity(text: string | Buffer): LockIdentity | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text.toString());
  } catch {
    return undefined;
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const pid = candidate.pid;
  if (
    typeof candidate.token !== "string" ||
    candidate.token.length === 0 ||
    typeof pid !== "number" ||
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    typeof candidate.createdAt !== "number" ||
    !Number.isFinite(candidate.createdAt)
  ) {
    return undefined;
  }

  return {
    token: candidate.token,
    pid,
    createdAt: candidate.createdAt,
  };
}

async function readLockSnapshot(lockFile: string): Promise<LockSnapshot> {
  let bytes: Buffer;
  try {
    bytes = await readFile(lockFile);
  } catch (error) {
    if (isErrnoException(error, "ENOENT")) {
      return { kind: "missing" };
    }

    throw error;
  }

  const identity = parseLockIdentity(bytes);
  if (identity !== undefined) {
    return { kind: "valid", identity };
  }

  try {
    const metadata = await stat(lockFile);
    return {
      kind: "malformed",
      bytes,
      modifiedAtMs: metadata.mtimeMs,
    };
  } catch (error) {
    if (isErrnoException(error, "ENOENT")) {
      return { kind: "missing" };
    }

    throw error;
  }
}

async function readLockIdentity(
  lockFile: string,
): Promise<LockIdentity | undefined> {
  const snapshot = await readLockSnapshot(lockFile);
  return snapshot.kind === "valid" ? snapshot.identity : undefined;
}

function sameIdentity(
  left: LockIdentity | undefined,
  right: LockIdentity,
): boolean {
  return (
    left !== undefined &&
    left.token === right.token &&
    left.pid === right.pid &&
    left.createdAt === right.createdAt
  );
}

function sameLockSnapshot(left: LockSnapshot, right: LockSnapshot): boolean {
  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "missing" || right.kind === "missing") {
    return true;
  }

  if (left.kind === "valid" && right.kind === "valid") {
    return sameIdentity(left.identity, right.identity);
  }

  return (
    left.kind === "malformed" &&
    right.kind === "malformed" &&
    left.bytes.equals(right.bytes) &&
    Math.abs(left.modifiedAtMs - right.modifiedAtMs) < 1
  );
}

function uniqueSidePath(lockFile: string, purpose: string): string {
  return `${lockFile}.${purpose}.${process.pid}.${randomUUID()}`;
}

function recoveryIntentPath(
  lockFile: string,
  identity: LockIdentity,
): string {
  return `${lockFile}.recovery.${identity.pid}.${identity.token}`;
}

function parseRecoveryIntentName(
  lockFile: string,
  entry: string,
): RecoveryIntentName | undefined {
  const prefix = `${path.basename(lockFile)}.recovery.`;
  if (!entry.startsWith(prefix)) {
    return undefined;
  }

  const rest = entry.slice(prefix.length);
  const separator = rest.indexOf(".");
  if (separator <= 0 || separator === rest.length - 1) {
    return undefined;
  }

  const pidText = rest.slice(0, separator);
  if (!/^\d+$/.test(pidText)) {
    return undefined;
  }

  const pid = Number(pidText);
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return undefined;
  }

  return {
    pid,
    token: rest.slice(separator + 1),
  };
}

async function removeBestEffort(filePath: string): Promise<boolean> {
  try {
    await rm(filePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

async function writeExclusiveJson(
  filePath: string,
  value: unknown,
): Promise<void> {
  const handle = await open(filePath, "wx", 0o600);
  let writeError: unknown;

  try {
    await handle.writeFile(JSON.stringify(value), "utf8");
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
    await removeBestEffort(filePath);
    throw writeError;
  }
}

async function createLockFile(
  lockFile: string,
  identity: LockIdentity,
): Promise<void> {
  await writeExclusiveJson(lockFile, identity);
}

async function createRecoveryIntent(
  lockFile: string,
  now: () => number,
  createToken: () => string,
): Promise<RecoveryIntent> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const identity: LockIdentity = {
      token: createToken(),
      pid: process.pid,
      createdAt: now(),
    };
    const intentPath = recoveryIntentPath(lockFile, identity);

    try {
      await writeExclusiveJson(intentPath, identity);
      return { intentPath, identity };
    } catch (error) {
      if (!isErrnoException(error, "EEXIST")) {
        throw error;
      }
    }
  }

  throw new Error(`Could not create a unique recovery intent for ${lockFile}.`);
}

async function isTokenizedRecoveryIntentActive(
  intentPath: string,
  intentName: RecoveryIntentName,
  staleAfterMs: number,
  now: () => number,
  isProcessAlive: (pid: number) => boolean | Promise<boolean>,
): Promise<boolean> {
  let pid = intentName.pid;
  let createdAt: number;

  try {
    const bytes = await readFile(intentPath);
    const identity = parseLockIdentity(bytes);
    if (
      identity !== undefined &&
      identity.pid === intentName.pid &&
      identity.token === intentName.token
    ) {
      pid = identity.pid;
      createdAt = identity.createdAt;
    } else {
      const metadata = await stat(intentPath);
      createdAt = metadata.mtimeMs;
    }
  } catch (error) {
    if (isErrnoException(error, "ENOENT")) {
      return false;
    }

    throw error;
  }

  if (now() - createdAt <= staleAfterMs) {
    return true;
  }

  if (await isProcessAlive(pid)) {
    return true;
  }

  return !(await removeBestEffort(intentPath));
}

async function hasActiveRecoveryIntent(
  lockFile: string,
  staleAfterMs: number,
  now: () => number,
  isProcessAlive: (pid: number) => boolean | Promise<boolean>,
): Promise<boolean> {
  let entries: string[];
  try {
    entries = await readdir(path.dirname(lockFile));
  } catch (error) {
    if (isErrnoException(error, "ENOENT")) {
      return false;
    }

    throw error;
  }

  let hasActive = false;
  for (const entry of entries) {
    const intentName = parseRecoveryIntentName(lockFile, entry);
    if (intentName === undefined) {
      continue;
    }

    const intentPath = path.join(path.dirname(lockFile), entry);
    if (
      await isTokenizedRecoveryIntentActive(
        intentPath,
        intentName,
        staleAfterMs,
        now,
        isProcessAlive,
      )
    ) {
      hasActive = true;
    }
  }

  return hasActive;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isErrnoException(error, "ENOENT")) {
      return false;
    }

    throw error;
  }
}

async function restoreQuarantineIfSafe(
  lockFile: string,
  quarantinePath: string,
): Promise<void> {
  if (!(await pathExists(lockFile))) {
    await rename(quarantinePath, lockFile);
    return;
  }

  throw new Error(
    `Registry lock ${lockFile} changed during recovery; preserved quarantine at ${quarantinePath}.`,
  );
}

async function quarantineAndRemoveObservedLock(
  lockFile: string,
  observedSnapshot: LockSnapshot,
): Promise<boolean> {
  const quarantinePath = uniqueSidePath(lockFile, "quarantine");

  try {
    await rename(lockFile, quarantinePath);
  } catch (error) {
    if (isErrnoException(error, "ENOENT")) {
      return true;
    }

    if (isErrnoException(error, "EPERM") || isErrnoException(error, "EACCES")) {
      return false;
    }

    throw error;
  }

  const quarantinedSnapshot = await readLockSnapshot(quarantinePath);
  if (sameLockSnapshot(quarantinedSnapshot, observedSnapshot)) {
    await rm(quarantinePath, { force: true });
    return true;
  }

  await restoreQuarantineIfSafe(lockFile, quarantinePath);
  return false;
}

async function releaseLockFile(
  lockFile: string,
  identity: LockIdentity,
): Promise<void> {
  if (!sameIdentity(await readLockIdentity(lockFile), identity)) {
    return;
  }

  const quarantinePath = uniqueSidePath(lockFile, "release");
  try {
    await rename(lockFile, quarantinePath);
  } catch (error) {
    if (isErrnoException(error, "ENOENT")) {
      return;
    }

    throw error;
  }

  const quarantinedIdentity = await readLockIdentity(quarantinePath);
  if (sameIdentity(quarantinedIdentity, identity)) {
    await rm(quarantinePath, { force: true });
    return;
  }

  await restoreQuarantineIfSafe(lockFile, quarantinePath);
}

async function recoverStaleLockWithIntent(
  lockFile: string,
  staleAfterMs: number,
  now: () => number,
  isProcessAlive: (pid: number) => boolean | Promise<boolean>,
): Promise<boolean> {
  const observedSnapshot = await readLockSnapshot(lockFile);
  if (observedSnapshot.kind === "missing") {
    return true;
  }

  if (observedSnapshot.kind === "valid") {
    if (now() - observedSnapshot.identity.createdAt <= staleAfterMs) {
      return false;
    }

    if (await isProcessAlive(observedSnapshot.identity.pid)) {
      return false;
    }

    return quarantineAndRemoveObservedLock(lockFile, observedSnapshot);
  }

  if (now() - observedSnapshot.modifiedAtMs <= staleAfterMs) {
    return false;
  }

  return quarantineAndRemoveObservedLock(lockFile, observedSnapshot);
}

async function shouldAttemptStaleRecovery(
  snapshot: LockSnapshot,
  staleAfterMs: number,
  now: () => number,
): Promise<boolean> {
  if (snapshot.kind === "missing") {
    return true;
  }

  if (snapshot.kind === "malformed") {
    return now() - snapshot.modifiedAtMs > staleAfterMs;
  }

  return now() - snapshot.identity.createdAt > staleAfterMs;
}

async function recoverStaleLock(
  lockFile: string,
  staleAfterMs: number,
  now: () => number,
  isProcessAlive: (pid: number) => boolean | Promise<boolean>,
  createToken: () => string,
): Promise<boolean> {
  if (
    !(await shouldAttemptStaleRecovery(
      await readLockSnapshot(lockFile),
      staleAfterMs,
      now,
    ))
  ) {
    return false;
  }

  const intent = await createRecoveryIntent(lockFile, now, createToken);
  let recoveryError: unknown;

  try {
    return await recoverStaleLockWithIntent(
      lockFile,
      staleAfterMs,
      now,
      isProcessAlive,
    );
  } catch (error) {
    recoveryError = error;
    throw error;
  } finally {
    try {
      await rm(intent.intentPath, { force: true });
    } catch (cleanupError) {
      if (recoveryError === undefined) {
        throw cleanupError;
      }
    }
  }
}

function timeoutError(lockFile: string): Error {
  return new Error(`Timed out waiting for registry lock ${lockFile}.`);
}

async function waitForRetry(
  lockFile: string,
  deadline: number,
  retryDelayMs: number,
  now: () => number,
  sleep: (delayMs: number) => Promise<void>,
): Promise<void> {
  if (now() >= deadline) {
    throw timeoutError(lockFile);
  }

  await sleep(retryDelayMs);
}

export async function withFileLock<T>(
  lockFile: string,
  action: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const retryDelayMs = options.retryDelayMs ?? 25;
  const timeoutMs = options.timeoutMs ?? 4_000;
  const staleAfterMs = options.staleAfterMs ?? 10_000;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const createToken = options.createToken ?? randomUUID;
  const deadline = now() + timeoutMs;

  while (true) {
    if (
      await hasActiveRecoveryIntent(
        lockFile,
        staleAfterMs,
        now,
        isProcessAlive,
      )
    ) {
      await waitForRetry(lockFile, deadline, retryDelayMs, now, sleep);
      continue;
    }

    const identity: LockIdentity = {
      token: createToken(),
      pid: process.pid,
      createdAt: now(),
    };

    try {
      await createLockFile(lockFile, identity);
    } catch (error) {
      if (!isErrnoException(error, "EEXIST")) {
        throw error;
      }

      if (
        await recoverStaleLock(
          lockFile,
          staleAfterMs,
          now,
          isProcessAlive,
          createToken,
        )
      ) {
        continue;
      }

      await waitForRetry(lockFile, deadline, retryDelayMs, now, sleep);
      continue;
    }

    const recoveryIntentAppeared = await hasActiveRecoveryIntent(
      lockFile,
      staleAfterMs,
      now,
      isProcessAlive,
    );
    const currentIdentity = await readLockIdentity(lockFile);
    if (recoveryIntentAppeared || !sameIdentity(currentIdentity, identity)) {
      await releaseLockFile(lockFile, identity);
      await waitForRetry(lockFile, deadline, retryDelayMs, now, sleep);
      continue;
    }

    let actionResult: T | undefined;
    let actionError: unknown;

    try {
      actionResult = await action();
    } catch (error) {
      actionError = error;
    }

    try {
      await releaseLockFile(lockFile, identity);
    } catch (cleanupError) {
      if (actionError !== undefined) {
        throw new AggregateError(
          [actionError, cleanupError],
          `Action and release both failed for registry lock ${lockFile}.`,
        );
      }

      throw cleanupError;
    }

    if (actionError !== undefined) {
      throw actionError;
    }

    return actionResult as T;
  }
}
