import assert from "node:assert/strict";
import test from "node:test";

import { defaultConfig } from "../../src/config/config.ts";
import { buildRecoveryPlan } from "../../src/launch/recovery-plan.ts";
import type { SessionRecord, SessionRegistry } from "../../src/session/model.ts";

const sessionId = "502ed8ca-ce22-4e92-b6a7-34eaec25c59d";

function sessionRecord(
  overrides: Partial<SessionRecord> = {},
): SessionRecord {
  return {
    sessionId,
    cwd: "C:\\src\\ms-pal",
    launcherProfile: "copilot",
    source: "resume",
    startedAt: "2026-10-05T18:00:00.000Z",
    lastSeenAt: "2026-10-05T18:01:00.000Z",
    ...overrides,
  };
}

function registry(...sessions: SessionRecord[]): SessionRegistry {
  return {
    schemaVersion: 1,
    sessions: Object.fromEntries(
      sessions.map((session) => [session.sessionId, session]),
    ),
  };
}

const registryWithOneSession = registry(sessionRecord());
const registryWithTwoSessions = registry(
  sessionRecord(),
  sessionRecord({
    sessionId: "de305d54-75b4-431b-adb2-eb6b9e546014",
    cwd: "C:\\missing",
    lastSeenAt: "2026-10-05T18:02:00.000Z",
  }),
);

test("builds valid tabs and skips only missing working directories", async () => {
  const plan = await buildRecoveryPlan(
    registryWithTwoSessions,
    defaultConfig(),
    {
      profileOverride: undefined,
      directoryExists: async (cwd) => cwd !== "C:\\missing",
      commandExists: async () => true,
    },
  );

  assert.equal(plan.tabs.length, 1);
  assert.equal(plan.tabs[0]?.title, "ms-pal - 502ed8c");
  assert.equal(plan.skipped[0]?.reason, "working-directory-missing");
});

test("fails before launch when the selected executable is unavailable", async () => {
  await assert.rejects(
    buildRecoveryPlan(registryWithOneSession, defaultConfig(), {
      directoryExists: async () => true,
      commandExists: async () => false,
    }),
    /launcher executable .* was not found/i,
  );
});

test("profile override is recorded for every planned session", async () => {
  const plan = await buildRecoveryPlan(registryWithOneSession, defaultConfig(), {
    profileOverride: "agency",
    directoryExists: async () => true,
    commandExists: async () => true,
  });

  assert.deepEqual(plan.profileUpdates, {
    "502ed8ca-ce22-4e92-b6a7-34eaec25c59d": "agency",
  });
});

test("ties on lastSeenAt are ordered by full sessionId regardless of insertion order", async () => {
  const plan = await buildRecoveryPlan(
    registry(
      sessionRecord({
        sessionId: "de305d54-75b4-431b-adb2-eb6b9e546014",
        cwd: "C:\\src\\zeta",
      }),
      sessionRecord({
        sessionId: "002ed8ca-ce22-4e92-b6a7-34eaec25c59d",
        cwd: "C:\\src\\alpha",
      }),
    ),
    defaultConfig(),
    {
      directoryExists: async () => true,
      commandExists: async () => true,
    },
  );

  assert.deepEqual(
    plan.tabs.map((tab) => tab.sessionId),
    [
      "002ed8ca-ce22-4e92-b6a7-34eaec25c59d",
      "de305d54-75b4-431b-adb2-eb6b9e546014",
    ],
  );
});
