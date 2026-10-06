import assert from "node:assert/strict";
import { closeSync, fsyncSync, openSync, writeFileSync } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { withFileLock } from "../../src/storage/file-lock.ts";

interface TestLockIdentity {
  token: string;
  pid: number;
  createdAt: number;
}

function recoveryIntentPath(
  lockFile: string,
  pid: number,
  token: string,
): string {
  return `${lockFile}.recovery.${pid}.${token}`;
}

async function writeRecoveryIntent(
  lockFile: string,
  identity: TestLockIdentity,
): Promise<string> {
  const intentPath = recoveryIntentPath(lockFile, identity.pid, identity.token);
  const handle = await open(intentPath, "wx", 0o600);
  let writeError: unknown;

  try {
    await handle.writeFile(JSON.stringify(identity), "utf8");
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
    await rm(intentPath, { force: true });
    throw writeError;
  }

  return intentPath;
}

function writeRecoveryIntentSync(
  lockFile: string,
  identity: TestLockIdentity,
): string {
  const intentPath = recoveryIntentPath(lockFile, identity.pid, identity.token);
  const fd = openSync(intentPath, "wx", 0o600);
  let writeError: unknown;

  try {
    writeFileSync(fd, JSON.stringify(identity), "utf8");
    fsyncSync(fd);
  } catch (error) {
    writeError = error;
  }

  try {
    closeSync(fd);
  } catch (error) {
    writeError ??= error;
  }

  if (writeError !== undefined) {
    throw writeError;
  }

  return intentPath;
}

async function recoveryIntentNames(lockFile: string): Promise<string[]> {
  const prefix = `${path.basename(lockFile)}.recovery.`;
  const entries = await readdir(path.dirname(lockFile));
  return entries.filter((entry) => entry.startsWith(prefix)).sort();
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(
  description: string,
  predicate: () => Promise<boolean> | boolean,
): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 1);
    });
  }

  assert.fail(`Timed out waiting for ${description}.`);
}

test("serializes concurrent writers", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "copilot-session-recovery-file-lock-test-"),
  );

  try {
    const lockFile = path.join(directory, "sessions.lock");
    const order: string[] = [];
    let releaseFirst!: () => void;
    let signalEntered!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const holdFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withFileLock(lockFile, async () => {
      order.push("first-start");
      signalEntered();
      await holdFirst;
      order.push("first-end");
    });

    await firstEntered;

    const second = withFileLock(lockFile, async () => {
      order.push("second");
    });

    releaseFirst();
    await Promise.all([first, second]);

    assert.deepEqual(order, ["first-start", "first-end", "second"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("default timeout survives a legitimate critical section longer than 1.5 seconds", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "copilot-session-recovery-file-lock-test-"),
  );

  try {
    const lockFile = path.join(directory, "sessions.lock");
    const order: string[] = [];
    let signalEntered!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const startedAt = Date.now();

    const first = withFileLock(lockFile, async () => {
      order.push("first-start");
      signalEntered();
      await new Promise((resolve) => {
        setTimeout(resolve, 1_650);
      });
      order.push("first-end");
    });

    await firstEntered;

    const second = withFileLock(lockFile, async () => {
      order.push("second");
    });

    await Promise.all([first, second]);

    const elapsedMs = Date.now() - startedAt;
    assert.deepEqual(order, ["first-start", "first-end", "second"]);
    assert.ok(elapsedMs >= 1_600, `expected wait >= 1600ms, got ${elapsedMs}`);
    assert.ok(elapsedMs < 2_500, `expected wait < 2500ms, got ${elapsedMs}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("removes a stale lock and continues", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "copilot-session-recovery-file-lock-test-"),
  );

  try {
    const lockFile = path.join(directory, "sessions.lock");
    await writeFile(
      lockFile,
      JSON.stringify({ token: "stale", pid: 1, createdAt: Date.now() - 60_000 }),
      "utf8",
    );
    const staleAt = new Date(Date.now() - 60_000);
    await utimes(lockFile, staleAt, staleAt);

    let entered = false;
    await withFileLock(lockFile, async () => {
      entered = true;
    }, {
      isProcessAlive: () => false,
    });

    assert.equal(entered, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("retries when a recovery intent appears between acquisition checks", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "copilot-session-recovery-file-lock-test-"),
  );

  try {
    const lockFile = path.join(directory, "sessions.lock");
    let entered = 0;
    let retryObserved!: () => void;
    let allowRetry!: () => void;
    const observedRetry = new Promise<void>((resolve) => {
      retryObserved = resolve;
    });
    const retryGate = new Promise<void>((resolve) => {
      allowRetry = resolve;
    });
    let intentPath = "";
    let tokenCalls = 0;

    const contender = withFileLock(
      lockFile,
      async () => {
        entered += 1;
      },
      {
        retryDelayMs: 1,
        timeoutMs: 1_000,
        staleAfterMs: 1_000,
        createToken: () => {
          tokenCalls += 1;
          if (tokenCalls === 1) {
            intentPath = writeRecoveryIntentSync(lockFile, {
              token: "recovering",
              pid: process.pid,
              createdAt: Date.now(),
            });
            return "candidate";
          }

          return `retry-${tokenCalls}`;
        },
        sleep: async () => {
          retryObserved();
          await retryGate;
        },
      },
    );

    const blocked = await Promise.race([
      observedRetry.then(() => true),
      contender.then(() => false),
    ]);

    assert.equal(blocked, true);
    assert.equal(entered, 0);

    await rm(intentPath, { force: true });
    allowRetry();
    await contender;

    assert.equal(entered, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fresh candidates wait for all stale-recovery intents to clear", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "copilot-session-recovery-file-lock-test-"),
  );

  try {
    const lockFile = path.join(directory, "sessions.lock");
    await writeFile(
      lockFile,
      JSON.stringify({ token: "stale", pid: 987_654, createdAt: 0 }),
      "utf8",
    );
    const firstIntentPath = await writeRecoveryIntent(lockFile, {
      token: "first-recoverer",
      pid: process.pid,
      createdAt: Date.now(),
    });
    const secondIntentPath = await writeRecoveryIntent(lockFile, {
      token: "second-recoverer",
      pid: process.pid,
      createdAt: Date.now(),
    });

    let freshEntered = false;
    let sleepCalls = 0;
    const freshCandidate = withFileLock(
      lockFile,
      async () => {
        freshEntered = true;
      },
      {
        retryDelayMs: 1,
        timeoutMs: 1_000,
        staleAfterMs: 1,
        createToken: (() => {
          const tokens = ["fresh-lock", "fresh-intent", "fresh-retry"];
          return () => tokens.shift() ?? "fresh-extra";
        })(),
        sleep: async () => {
          sleepCalls += 1;
        },
        isProcessAlive: (pid) => pid === process.pid,
      },
    );

    const firstBlock = await Promise.race([
      waitFor("fresh candidate to observe recovery intents", () => sleepCalls > 0)
        .then(() => true),
      freshCandidate.then(() => false),
    ]);
    assert.equal(firstBlock, true);
    assert.equal(freshEntered, false);
    assert.equal((await recoveryIntentNames(lockFile)).length, 2);

    await rm(firstIntentPath, { force: true });
    await waitFor("fresh candidate to remain blocked on second intent", () =>
      sleepCalls > 1,
    );
    assert.equal(freshEntered, false);
    assert.deepEqual(await recoveryIntentNames(lockFile), [
      path.basename(secondIntentPath),
    ]);

    await rm(secondIntentPath, { force: true });
    await freshCandidate;
    assert.equal(freshEntered, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("removes only exact tokenized stale recovery intents", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "copilot-session-recovery-file-lock-test-"),
  );

  try {
    const lockFile = path.join(directory, "sessions.lock");
    const staleIntentPath = await writeRecoveryIntent(lockFile, {
      token: "stale-token",
      pid: 987_654,
      createdAt: 0,
    });
    const freshIntentPath = await writeRecoveryIntent(lockFile, {
      token: "fresh-token",
      pid: process.pid,
      createdAt: Date.now(),
    });

    let entered = false;
    await assert.rejects(
      withFileLock(
        lockFile,
        async () => {
          entered = true;
        },
        {
          retryDelayMs: 1,
          staleAfterMs: 1,
          timeoutMs: 10,
          isProcessAlive: (pid) => pid === process.pid,
        },
      ),
      /Timed out waiting for registry lock/,
    );

    assert.equal(entered, false);
    assert.equal(await pathExists(staleIntentPath), false);
    assert.equal(await pathExists(freshIntentPath), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("recovers a stale malformed lock only after it ages out", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "copilot-session-recovery-file-lock-test-"),
  );

  try {
    const lockFile = path.join(directory, "sessions.lock");
    await writeFile(lockFile, "", "utf8");
    const staleAt = new Date(Date.now() - 60_000);
    await utimes(lockFile, staleAt, staleAt);

    let entered = false;
    await withFileLock(
      lockFile,
      async () => {
        entered = true;
      },
      {
        retryDelayMs: 1,
        staleAfterMs: 1,
        timeoutMs: 1_000,
      },
    );

    assert.equal(entered, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("does not recover a fresh malformed lock", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "copilot-session-recovery-file-lock-test-"),
  );

  try {
    const lockFile = path.join(directory, "sessions.lock");
    await writeFile(lockFile, "", "utf8");

    let entered = false;
    await assert.rejects(
      withFileLock(
        lockFile,
        async () => {
          entered = true;
        },
        {
          retryDelayMs: 1,
          staleAfterMs: 60_000,
          timeoutMs: 10,
        },
      ),
      /Timed out waiting for registry lock/,
    );

    assert.equal(entered, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("surfaces both action and release failures", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "copilot-session-recovery-file-lock-test-"),
  );

  try {
    const lockFile = path.join(directory, "sessions.lock");
    const actionError = new Error("action failed");

    await assert.rejects(
      withFileLock(lockFile, async () => {
        await rm(lockFile, { force: true });
        await mkdir(lockFile);
        throw actionError;
      }),
      (error: unknown) => {
        assert.equal(error instanceof AggregateError, true);
        const aggregate = error as AggregateError;
        assert.equal(aggregate.errors[0], actionError);
        assert.match(String(aggregate.errors[1]), /EISDIR|EPERM|EACCES/);
        return true;
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("does not reclaim a live lock held past staleAfterMs", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "copilot-session-recovery-file-lock-test-"),
  );

  try {
    const lockFile = path.join(directory, "sessions.lock");
    let releaseFirst!: () => void;
    let signalEntered!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const holdFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withFileLock(lockFile, async () => {
      signalEntered();
      await holdFirst;
    });

    await firstEntered;
    const staleAt = new Date(Date.now() - 60_000);
    await utimes(lockFile, staleAt, staleAt);

    let secondEntered = false;
    await assert.rejects(
      withFileLock(
        lockFile,
        async () => {
          secondEntered = true;
        },
        {
          retryDelayMs: 1,
          staleAfterMs: 1,
          timeoutMs: 25,
          isProcessAlive: (pid) => pid === process.pid,
        },
      ),
      /Timed out waiting for registry lock/,
    );
    assert.equal(secondEntered, false);

    releaseFirst();
    await first;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("stale waiters do not delete a fresh owner after recovery", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "copilot-session-recovery-file-lock-test-"),
  );

  try {
    const lockFile = path.join(directory, "sessions.lock");
    await writeFile(
      lockFile,
      JSON.stringify({ token: "dead", pid: 987_654, createdAt: 0 }),
      "utf8",
    );

    let releaseFirst!: () => void;
    let signalEntered!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const holdFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const entered: string[] = [];

    const first = withFileLock(
      lockFile,
      async () => {
        entered.push("first");
        signalEntered();
        await holdFirst;
      },
      {
        retryDelayMs: 1,
        staleAfterMs: 1,
        timeoutMs: 1_000,
        isProcessAlive: (pid) => pid === process.pid,
      },
    );

    await firstEntered;
    const staleAt = new Date(Date.now() - 60_000);
    await utimes(lockFile, staleAt, staleAt);

    const second = withFileLock(
      lockFile,
      async () => {
        entered.push("second");
      },
      {
        retryDelayMs: 1,
        staleAfterMs: 1,
        timeoutMs: 1_000,
        isProcessAlive: (pid) => pid === process.pid,
      },
    );

    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
    assert.deepEqual(entered, ["first"]);

    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(entered, ["first", "second"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("release does not remove a replacement lock", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "copilot-session-recovery-file-lock-test-"),
  );

  try {
    const lockFile = path.join(directory, "sessions.lock");
    const replacement = { token: "replacement", pid: 123_456, createdAt: 1 };

    await withFileLock(lockFile, async () => {
      await writeFile(lockFile, JSON.stringify(replacement), "utf8");
    });

    assert.deepEqual(JSON.parse(await readFile(lockFile, "utf8")), replacement);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("times out while another writer holds the lock", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "copilot-session-recovery-file-lock-test-"),
  );

  try {
    const lockFile = path.join(directory, "sessions.lock");
    let releaseFirst!: () => void;
    let signalEntered!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const holdFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withFileLock(lockFile, async () => {
      signalEntered();
      await holdFirst;
    });

    await firstEntered;

    await assert.rejects(
      withFileLock(
        lockFile,
        async () => {
          assert.fail("lock acquisition should time out before entering");
        },
        { retryDelayMs: 10, timeoutMs: 50 },
      ),
      /Timed out waiting for registry lock/,
    );

    releaseFirst();
    await first;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
