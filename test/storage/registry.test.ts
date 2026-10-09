import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { emptyRegistry, applyLifecycleEvent } from "../../src/session/lifecycle.ts";
import type { SessionStartEvent } from "../../src/session/model.ts";
import {
  parseRegistry,
  readRegistry,
  RegistryCorruptError,
  removeSessionByPrefix,
  resetCorruptRegistry,
  pruneMissingWorkingDirectories,
  updateRegistry,
} from "../../src/storage/registry.ts";
import type { AppPaths } from "../../src/storage/paths.ts";

const firstId = "502ed8ca-ce22-4e92-b6a7-34eaec25c59d";
const secondId = "502ed8cb-1111-4222-8333-444444444444";
const mixedCaseId = "AbCdEf01-2345-4aBc-8dEf-0123456789ab";
const startTimestamp = Date.parse("2026-10-05T18:10:00.000Z");

function createTestPaths(root: string): AppPaths {
  return {
    appDir: root,
    configFile: path.join(root, "config.json"),
    registryFile: path.join(root, "sessions.json"),
    lockFile: path.join(root, "sessions.lock"),
    diagnosticsDir: path.join(root, "diagnostics"),
    corruptDir: path.join(root, "corrupt"),
    copilotHookFile: path.join(root, "hooks", "copilot-session-recovery.json"),
    launchPlanFile: path.join(root, "launch-plan.json"),
    launchPlanLockFile: path.join(root, "launch-plan.lock"),
  };
}

function startEvent(
  sessionId: string,
  cwd: string,
  source: "startup" | "resume" | "new" = "new",
  timestamp: number = startTimestamp,
): SessionStartEvent {
  return {
    type: "start",
    sessionId,
    cwd,
    source,
    timestamp,
  };
}

test("missing registry reads as an empty registry", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "copilot-session-recovery-registry-test-"),
  );

  try {
    const testPaths = createTestPaths(directory);

    const actual = await readRegistry(testPaths.registryFile, testPaths.corruptDir);

    assert.deepEqual(actual, emptyRegistry());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("parseRegistry rejects unexpected top-level fields", () => {
  assert.throws(
    () =>
      parseRegistry({
        schemaVersion: 1,
        sessions: {},
        extra: true,
      }),
    /unexpected field "extra"/i,
  );
});

test("parseRegistry rejects unexpected session fields", () => {
  assert.throws(
    () =>
      parseRegistry({
        schemaVersion: 1,
        sessions: {
          [firstId]: {
            sessionId: firstId,
            cwd: "C:\\src\\ms-pal",
            launcherProfile: "copilot",
            source: "new",
            startedAt: "2026-10-05T18:10:00.000Z",
            lastSeenAt: "2026-10-05T18:10:00.000Z",
            extra: true,
          },
        },
      }),
    /unexpected field "extra"/i,
  );
});

test("updateRegistry rereads under the lock and preserves both updates", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "copilot-session-recovery-registry-test-"),
  );

  try {
    const testPaths = createTestPaths(directory);
    const firstStart = startEvent(firstId, "C:\\src\\ms-pal", "new");
    const secondStart = startEvent(
      secondId,
      "C:\\src\\copilot-session-recovery",
      "resume",
      startTimestamp + 10_000,
    );

    await Promise.all([
      updateRegistry(testPaths, (registry) =>
        applyLifecycleEvent(registry, firstStart, "copilot"),
      ),
      updateRegistry(testPaths, (registry) =>
        applyLifecycleEvent(registry, secondStart, "copilot"),
      ),
    ]);

    const actual = await readRegistry(
      testPaths.registryFile,
      testPaths.corruptDir,
    );

    assert.deepEqual(Object.keys(actual.sessions).sort(), [firstId, secondId]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("corrupt JSON is copied to hash-addressed evidence and never replaced", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "copilot-session-recovery-registry-test-"),
  );

  try {
    const testPaths = createTestPaths(directory);
    await writeFile(testPaths.registryFile, "{broken", "utf8");

    let firstEvidencePath = "";
    await assert.rejects(
      readRegistry(testPaths.registryFile, testPaths.corruptDir),
      (error: unknown) => {
        assert.equal(error instanceof RegistryCorruptError, true);
        firstEvidencePath = (error as RegistryCorruptError).evidencePath;
        assert.match(path.basename(firstEvidencePath), /^sessions\.\d{14}\.[0-9a-f]{64}\.json$/);
        return true;
      },
    );

    await assert.rejects(
      readRegistry(testPaths.registryFile, testPaths.corruptDir),
      (error: unknown) => {
        assert.equal(error instanceof RegistryCorruptError, true);
        assert.equal((error as RegistryCorruptError).evidencePath, firstEvidencePath);
        return true;
      },
    );

    assert.equal(await readFile(testPaths.registryFile, "utf8"), "{broken");
    assert.deepEqual(await readdir(testPaths.corruptDir), [path.basename(firstEvidencePath)]);
    assert.equal(await readFile(firstEvidencePath, "utf8"), "{broken");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("corrupt evidence preserves the exact rejected bytes if sessions.json is replaced after read", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "copilot-session-recovery-registry-test-"),
  );

  try {
    const testPaths = createTestPaths(directory);
    const rejectedBytes = Buffer.from("{broken-original", "utf8");
    const replacementBytes = Buffer.from("{broken-replacement", "utf8");
    const replacementTime = new Date("2026-10-05T18:10:00.000Z");
    const hash = createHash("sha256").update(rejectedBytes).digest("hex");
    await writeFile(testPaths.registryFile, rejectedBytes);

    let evidencePath = "";
    await assert.rejects(
      readRegistry(testPaths.registryFile, testPaths.corruptDir, {
        afterRead: async () => {
          await writeFile(testPaths.registryFile, replacementBytes);
          await utimes(testPaths.registryFile, replacementTime, replacementTime);
        },
      }),
      (error: unknown) => {
        assert.equal(error instanceof RegistryCorruptError, true);
        evidencePath = (error as RegistryCorruptError).evidencePath;
        assert.equal(
          path.basename(evidencePath),
          `sessions.20261005181000.${hash}.json`,
        );
        return true;
      },
    );

    assert.equal(await readFile(testPaths.registryFile, "utf8"), replacementBytes.toString("utf8"));
    assert.equal(await readFile(evidencePath, "utf8"), rejectedBytes.toString("utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("post-read metadata failure still preserves corrupt evidence", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "copilot-session-recovery-registry-test-"),
  );

  try {
    const testPaths = createTestPaths(directory);
    const rejectedBytes = Buffer.from("{broken-original", "utf8");
    const fallbackTime = new Date("2026-10-05T18:10:00.000Z");
    const hash = createHash("sha256").update(rejectedBytes).digest("hex");
    await writeFile(testPaths.registryFile, rejectedBytes);

    let evidencePath = "";
    await assert.rejects(
      readRegistry(testPaths.registryFile, testPaths.corruptDir, {
        afterRead: async () => {
          await rm(testPaths.registryFile);
        },
        now: () => fallbackTime,
      }),
      (error: unknown) => {
        assert.equal(error instanceof RegistryCorruptError, true);
        evidencePath = (error as RegistryCorruptError).evidencePath;
        assert.equal(
          path.basename(evidencePath),
          `sessions.20261005181000.${hash}.json`,
        );
        return true;
      },
    );

    assert.equal(await readFile(evidencePath, "utf8"), rejectedBytes.toString("utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("resetCorruptRegistry preserves evidence and replaces the registry with an empty one", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "copilot-session-recovery-registry-test-"),
  );

  try {
    const testPaths = createTestPaths(directory);
    await writeFile(testPaths.registryFile, "{broken", "utf8");

    const evidencePath = await resetCorruptRegistry(testPaths);

    assert.equal((await readRegistry(testPaths.registryFile, testPaths.corruptDir)).schemaVersion, 1);
    assert.deepEqual(await readRegistry(testPaths.registryFile, testPaths.corruptDir), emptyRegistry());
    assert.equal(await readFile(evidencePath, "utf8"), "{broken");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("removeSessionByPrefix matches prefixes case-insensitively and preserves stored IDs", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "copilot-session-recovery-registry-test-"),
  );

  try {
    const testPaths = createTestPaths(directory);
    await writeFile(
      testPaths.registryFile,
      JSON.stringify({
        schemaVersion: 1,
        sessions: {
          [mixedCaseId]: {
            sessionId: mixedCaseId,
            cwd: "C:\\src\\mixed",
            launcherProfile: "copilot",
            source: "resume",
            startedAt: "2026-10-05T18:10:00.000Z",
            lastSeenAt: "2026-10-05T18:10:00.000Z",
          },
        },
      }),
      "utf8",
    );

    const removed = await removeSessionByPrefix(testPaths, "abcdef01");

    assert.equal(removed, mixedCaseId);
    assert.deepEqual(
      await readRegistry(testPaths.registryFile, testPaths.corruptDir),
      emptyRegistry(),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("pruneMissingWorkingDirectories removes only approved sessions whose working directories are missing", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "copilot-session-recovery-registry-test-"),
  );

  try {
    const testPaths = createTestPaths(directory);
    const existingWorkingDirectory = path.join(directory, "existing");
    await mkdir(existingWorkingDirectory);

    await updateRegistry(testPaths, (registry) =>
      applyLifecycleEvent(
        applyLifecycleEvent(
          registry,
          startEvent(firstId, existingWorkingDirectory, "new"),
          "copilot",
        ),
        startEvent(secondId, path.join(directory, "missing"), "resume", startTimestamp + 1_000),
        "copilot",
      ),
    );

    const removed = await pruneMissingWorkingDirectories(
      testPaths,
      new Set([firstId, secondId]),
    );
    const actual = await readRegistry(
      testPaths.registryFile,
      testPaths.corruptDir,
    );

    assert.deepEqual(removed, [secondId]);
    assert.deepEqual(Object.keys(actual.sessions), [firstId]);
    await access(existingWorkingDirectory);
    const registryStats = await stat(testPaths.registryFile);
    assert.equal(registryStats.isFile(), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
