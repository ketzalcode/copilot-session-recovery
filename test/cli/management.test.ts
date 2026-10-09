import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseCliArguments } from "../../src/cli/arguments.ts";
import {
  addSessionCommand,
  listSessionsCommand,
  removeSessionCommand,
  pruneSessionsCommand,
} from "../../src/cli/commands.ts";
import { main } from "../../src/cli/main.ts";
import { defaultConfig, saveConfig } from "../../src/config/config.ts";
import { atomicWriteJson } from "../../src/storage/atomic-json.ts";
import type { AppPaths } from "../../src/storage/paths.ts";
import type { SessionRegistry } from "../../src/session/model.ts";

interface OutputCapture {
  output: {
    out(message: string): void;
    error(message: string): void;
    confirm(message: string): Promise<boolean>;
  };
  text(): string;
  errorText(): string;
  prompts: string[];
}

interface ManagementTestDependencies {
  paths: AppPaths;
  output: OutputCapture["output"];
  directoryExists(cwd: string): Promise<boolean>;
  outputCapture: OutputCapture;
  readRegistry(): Promise<SessionRegistry>;
}

interface ManagementDependencyOverrides {
  directoryExists?: (cwd: string) => Promise<boolean>;
  confirm?: (message: string) => Promise<boolean>;
}

const firstSessionId = "502ed8ca-ce22-4e92-b6a7-34eaec25c59d";
const secondSessionId = "95d2d9b1-0e6a-48c1-afd6-8a7598128f43";
const thirdSessionId = "502ed8ce-7934-4bf7-913d-73dbf8c128f8";

function createOutputCapture(
  confirm: (message: string) => Promise<boolean>,
): OutputCapture {
  const lines: string[] = [];
  const errors: string[] = [];
  const prompts: string[] = [];

  return {
    output: {
      out(message) {
        lines.push(message);
      },
      error(message) {
        errors.push(message);
      },
      async confirm(message) {
        prompts.push(message);
        return confirm(message);
      },
    },
    text() {
      return lines.join("\n");
    },
    errorText() {
      return errors.join("\n");
    },
    prompts,
  };
}

function createSessionRegistry(
  sessions: SessionRegistry["sessions"],
): SessionRegistry {
  return {
    schemaVersion: 1,
    sessions,
  };
}

async function createManagementTestDependencies(
  t: test.TestContext,
  registry: SessionRegistry,
  overrides: ManagementDependencyOverrides = {},
): Promise<ManagementTestDependencies> {
  const root = await mkdtemp(path.join(os.tmpdir(), "copilot-session-recovery-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const paths: AppPaths = {
    appDir: root,
    configFile: path.join(root, "config.json"),
    registryFile: path.join(root, "sessions.json"),
    lockFile: path.join(root, "sessions.lock"),
    diagnosticsDir: path.join(root, "diagnostics"),
    corruptDir: path.join(root, "corrupt"),
    copilotHookFile: path.join(root, "copilot-session-recovery.json"),
    launchPlanFile: path.join(root, "launch-plan.json"),
    launchPlanLockFile: path.join(root, "launch-plan.lock"),
  };

  await atomicWriteJson(paths.registryFile, registry);
  await saveConfig(paths.configFile, defaultConfig());
  const outputCapture = createOutputCapture(
    overrides.confirm ?? (async () => true),
  );

  return {
    paths,
    output: outputCapture.output,
    directoryExists:
      overrides.directoryExists ??
      (async (cwd) => cwd !== "C:\\missing"),
    outputCapture,
    async readRegistry() {
      return JSON.parse(await readFile(paths.registryFile, "utf8")) as SessionRegistry;
    },
  };
}

function registryWithTwoSessions(): SessionRegistry {
  return createSessionRegistry({
    [firstSessionId]: {
      sessionId: firstSessionId,
      cwd: "C:\\src\\ms-pal",
      launcherProfile: "copilot",
      source: "resume",
      startedAt: "2026-10-05T17:59:00.000Z",
      lastSeenAt: "2026-10-05T18:00:00.000Z",
    },
    [secondSessionId]: {
      sessionId: secondSessionId,
      cwd: "C:\\missing",
      launcherProfile: "agency",
      source: "startup",
      startedAt: "2026-10-05T17:58:00.000Z",
      lastSeenAt: "2026-10-05T18:01:00.000Z",
    },
  });
}

test("parseCliArguments parses management commands and rejects invalid forms", () => {
  assert.deepEqual(parseCliArguments(["list"]), { name: "list" });
  assert.deepEqual(parseCliArguments(["add", firstSessionId]), {
    name: "add",
    options: {
      sessionId: firstSessionId,
    },
  });
  assert.deepEqual(
    parseCliArguments([
      "add",
      firstSessionId,
      "--cwd",
      "C:\\src\\adopted",
      "--profile",
      "agency",
    ]),
    {
      name: "add",
      options: {
        sessionId: firstSessionId,
        cwd: "C:\\src\\adopted",
        profile: "agency",
      },
    },
  );
  assert.deepEqual(parseCliArguments(["remove", "502ed8ca"]), {
    name: "remove",
    prefix: "502ed8ca",
  });
  assert.deepEqual(parseCliArguments(["prune", "--missing-cwd"]), {
    name: "prune",
    options: {
      missingCwd: true,
    },
  });

  assert.throws(
    () => parseCliArguments(["add"]),
    /Command add requires a full session ID\./,
  );
  assert.throws(
    () => parseCliArguments(["add", "502ed8ca"]),
    /Command add requires a full session UUID\./,
  );
  assert.throws(
    () => parseCliArguments(["remove"]),
    /Command remove requires an ID prefix\./,
  );
  assert.throws(
    () => parseCliArguments(["forget", "502ed8ca"]),
    /Unknown command: forget 502ed8ca/,
  );
  assert.throws(
    () => parseCliArguments(["prune"]),
    /Command prune requires --missing-cwd\./,
  );
  assert.throws(
    () => parseCliArguments(["prune", "--wat"]),
    /Unknown option: --wat/,
  );
});

test("add adopts an existing Copilot session with the configured profile", async (t) => {
  const deps = await createManagementTestDependencies(
    t,
    createSessionRegistry({}),
    {
      directoryExists: async (cwd) => cwd === "C:\\src\\adopted",
    },
  );

  assert.equal(
    await addSessionCommand(
      {
        sessionId: firstSessionId,
        cwd: "C:\\src\\adopted",
      },
      {
        ...deps,
        now: () => 1_759_689_000_000,
      },
    ),
    0,
  );

  const savedRegistry = await deps.readRegistry();
  assert.deepEqual(savedRegistry.sessions[firstSessionId], {
    sessionId: firstSessionId,
    cwd: "C:\\src\\adopted",
    launcherProfile: "copilot",
    source: "resume",
    startedAt: "2025-10-05T18:30:00.000Z",
    lastSeenAt: "2025-10-05T18:30:00.000Z",
  });
  assert.match(deps.outputCapture.text(), /Added session 502ed8ca/);
});

test("add rejects an unavailable profile or working directory without mutation", async (t) => {
  const deps = await createManagementTestDependencies(
    t,
    createSessionRegistry({}),
    {
      directoryExists: async () => false,
    },
  );
  const before = await readFile(deps.paths.registryFile);

  assert.equal(
    await addSessionCommand(
      {
        sessionId: firstSessionId,
        cwd: "C:\\missing",
        profile: "unknown",
      },
      deps,
    ),
    1,
  );
  assert.match(deps.outputCapture.errorText(), /Launcher profile unknown does not exist\./);
  assert.deepEqual(await readFile(deps.paths.registryFile), before);
});

test("main defaults add to the current directory", async (t) => {
  const deps = await createManagementTestDependencies(
    t,
    createSessionRegistry({}),
    {
      directoryExists: async (cwd) => cwd === "C:\\src\\current",
    },
  );

  assert.equal(
    await main(["add", firstSessionId], {
      paths: deps.paths,
      output: deps.output,
      directoryExists: deps.directoryExists,
      currentDirectory: () => "C:\\src\\current",
    }),
    0,
  );

  const savedRegistry = await deps.readRegistry();
  assert.equal(savedRegistry.sessions[firstSessionId]?.cwd, "C:\\src\\current");
});

test("list prints recoverable sessions and returns zero", async (t) => {
  const deps = await createManagementTestDependencies(
    t,
    registryWithTwoSessions(),
  );

  assert.equal(await listSessionsCommand(deps), 0);
  assert.match(deps.outputCapture.text(), /502ed8c/);
  assert.match(deps.outputCapture.text(), /95d2d9b/);
  assert.match(deps.outputCapture.text(), /C:\\src\\ms-pal/);
});

test("list prints the exact empty message for an empty registry", async (t) => {
  const deps = await createManagementTestDependencies(
    t,
    createSessionRegistry({}),
  );

  assert.equal(await listSessionsCommand(deps), 0);
  assert.equal(deps.outputCapture.text(), "No recoverable sessions.");
  assert.equal(deps.outputCapture.errorText(), "");
});

test("remove resolves one prefix and removes only that session", async (t) => {
  const deps = await createManagementTestDependencies(
    t,
    registryWithTwoSessions(),
  );

  assert.equal(await removeSessionCommand("502ed8ca", deps), 0);

  const savedRegistry = await deps.readRegistry();
  assert.equal(savedRegistry.sessions[firstSessionId], undefined);
  assert.ok(savedRegistry.sessions[secondSessionId]);
});

test("remove returns one for an unmatched prefix without mutating the registry", async (t) => {
  const deps = await createManagementTestDependencies(
    t,
    registryWithTwoSessions(),
  );

  assert.equal(await removeSessionCommand("deadbeef", deps), 1);
  assert.match(deps.outputCapture.errorText(), /No session matches prefix "deadbeef"\./);

  const savedRegistry = await deps.readRegistry();
  assert.ok(savedRegistry.sessions[firstSessionId]);
  assert.ok(savedRegistry.sessions[secondSessionId]);
});

test("remove rejects malformed prefixes without mutating the registry", async (t) => {
  const invalidPrefixes = [
    "abc123",
    "123456g",
    "12-34-56",
  ];

  for (const prefix of invalidPrefixes) {
    const deps = await createManagementTestDependencies(
      t,
      registryWithTwoSessions(),
    );
    const before = await readFile(deps.paths.registryFile);

    assert.equal(await removeSessionCommand(prefix, deps), 1);
    assert.match(
      deps.outputCapture.errorText(),
      /Session ID prefixes must contain at least seven hexadecimal characters\./,
    );

    const after = await readFile(deps.paths.registryFile);
    assert.deepEqual(after, before);
  }
});

test("remove rejects ambiguous prefixes without mutating the registry", async (t) => {
  const deps = await createManagementTestDependencies(
    t,
    createSessionRegistry({
      [firstSessionId]: {
        sessionId: firstSessionId,
        cwd: "C:\\src\\ms-pal",
        launcherProfile: "copilot",
        source: "resume",
        startedAt: "2026-10-05T17:59:00.000Z",
        lastSeenAt: "2026-10-05T18:00:00.000Z",
      },
      [thirdSessionId]: {
        sessionId: thirdSessionId,
        cwd: "C:\\src\\other",
        launcherProfile: "copilot",
        source: "resume",
        startedAt: "2026-10-05T17:57:00.000Z",
        lastSeenAt: "2026-10-05T18:02:00.000Z",
      },
    }),
  );

  assert.equal(await removeSessionCommand("502ed8c", deps), 1);
  assert.match(deps.outputCapture.errorText(), /ambiguous/i);

  const savedRegistry = await deps.readRegistry();
  assert.ok(savedRegistry.sessions[firstSessionId]);
  assert.ok(savedRegistry.sessions[thirdSessionId]);
});

test("prune previews missing cwd entries and removes only after confirmation", async (t) => {
  const deps = await createManagementTestDependencies(
    t,
    registryWithTwoSessions(),
    {
      directoryExists: async (cwd) => cwd !== "C:\\missing",
      confirm: async () => true,
    },
  );

  assert.equal(await pruneSessionsCommand(deps), 0);
  assert.equal(deps.outputCapture.prompts.length, 1);
  assert.equal(deps.outputCapture.prompts[0], "Remove the listed sessions?");
  assert.match(deps.outputCapture.text(), /Skipped sessions:/);

  const savedRegistry = await deps.readRegistry();
  assert.equal(savedRegistry.sessions[secondSessionId], undefined);
  assert.ok(savedRegistry.sessions[firstSessionId]);
});

test("declining prune leaves the registry unchanged", async (t) => {
  const deps = await createManagementTestDependencies(
    t,
    registryWithTwoSessions(),
    {
      directoryExists: async (cwd) => cwd !== "C:\\missing",
      confirm: async () => false,
    },
  );

  assert.equal(await pruneSessionsCommand(deps), 0);
  assert.match(deps.outputCapture.text(), /Prune cancelled\./);

  const savedRegistry = await deps.readRegistry();
  assert.ok(savedRegistry.sessions[firstSessionId]);
  assert.ok(savedRegistry.sessions[secondSessionId]);
});

test("registry corruption returns one and prints the preserved evidence path", async (t) => {
  const deps = await createManagementTestDependencies(
    t,
    registryWithTwoSessions(),
  );
  await rm(deps.paths.registryFile, { force: true });
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(deps.paths.registryFile, "{not-json"),
  );

  assert.equal(await listSessionsCommand(deps), 1);
  assert.match(deps.outputCapture.errorText(), /Preserved evidence at .*\.json/);
});

test("main wires list through the management command", async (t) => {
  const deps = await createManagementTestDependencies(
    t,
    registryWithTwoSessions(),
  );

  assert.equal(
    await main(["list"], {
      paths: deps.paths,
      output: deps.output,
      directoryExists: deps.directoryExists,
    }),
    0,
  );
  assert.match(deps.outputCapture.text(), /Recoverable sessions:/);
});

test("main wires remove through the management command", async (t) => {
  const deps = await createManagementTestDependencies(
    t,
    registryWithTwoSessions(),
  );

  assert.equal(
    await main(["remove", "502ed8ca"], {
      paths: deps.paths,
      output: deps.output,
      directoryExists: deps.directoryExists,
    }),
    0,
  );

  const savedRegistry = await deps.readRegistry();
  assert.equal(savedRegistry.sessions[firstSessionId], undefined);
  assert.ok(savedRegistry.sessions[secondSessionId]);
  assert.match(deps.outputCapture.text(), /Removed session/);
});

test("main returns one for remove when no session matches the prefix", async (t) => {
  const deps = await createManagementTestDependencies(
    t,
    registryWithTwoSessions(),
  );

  assert.equal(
    await main(["remove", "deadbeef"], {
      paths: deps.paths,
      output: deps.output,
      directoryExists: deps.directoryExists,
    }),
    1,
  );

  const savedRegistry = await deps.readRegistry();
  assert.ok(savedRegistry.sessions[firstSessionId]);
  assert.ok(savedRegistry.sessions[secondSessionId]);
  assert.match(deps.outputCapture.errorText(), /No session matches prefix "deadbeef"\./);
});

test("main wires prune through the management command", async (t) => {
  const deps = await createManagementTestDependencies(
    t,
    registryWithTwoSessions(),
    {
      directoryExists: async (cwd) => cwd !== "C:\\missing",
      confirm: async () => true,
    },
  );

  assert.equal(
    await main(["prune", "--missing-cwd"], {
      paths: deps.paths,
      output: deps.output,
      directoryExists: deps.directoryExists,
    }),
    0,
  );

  const savedRegistry = await deps.readRegistry();
  assert.ok(savedRegistry.sessions[firstSessionId]);
  assert.equal(savedRegistry.sessions[secondSessionId], undefined);
  assert.equal(deps.outputCapture.prompts.length, 1);
  assert.equal(deps.outputCapture.prompts[0], "Remove the listed sessions?");
});
