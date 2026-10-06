import assert from "node:assert/strict";
import test from "node:test";

import {
  applyLifecycleEvent,
  emptyRegistry,
} from "../../src/session/lifecycle.ts";
import type {
  SessionEndEvent,
  SessionStartEvent,
} from "../../src/session/model.ts";

const sessionId = "502ed8ca-ce22-4e92-b6a7-34eaec25c59d";
const startedAt = Date.parse("2026-10-05T18:10:00.000Z");

function startEvent(
  overrides: Partial<Pick<SessionStartEvent, "cwd" | "source" | "timestamp">> = {},
) {
  return {
    type: "start" as const,
    sessionId,
    cwd: "C:\\src\\ms-pal",
    source: "new" as const,
    timestamp: startedAt,
    ...overrides,
  } satisfies SessionStartEvent;
}

function endEvent(
  reason: "complete" | "error" | "abort" | "timeout" | "user_exit",
  overrides: Partial<Pick<SessionEndEvent, "cwd" | "timestamp">> = {},
) {
  return {
    type: "end" as const,
    sessionId,
    cwd: "C:\\src\\ms-pal",
    reason,
    timestamp: startedAt + 10_000,
    ...overrides,
  } satisfies SessionEndEvent;
}

test("sessionStart creates a recoverable session", () => {
  const actual = applyLifecycleEvent(
    emptyRegistry(),
    startEvent(),
    "copilot",
  );

  assert.deepEqual(actual.sessions[sessionId], {
    sessionId,
    cwd: "C:\\src\\ms-pal",
    launcherProfile: "copilot",
    source: "new",
    startedAt: "2026-10-05T18:10:00.000Z",
    lastSeenAt: "2026-10-05T18:10:00.000Z",
  });
});

test("clean sessionEnd removes the session", () => {
  const started = applyLifecycleEvent(
    emptyRegistry(),
    startEvent(),
    "copilot",
  );

  const actual = applyLifecycleEvent(started, endEvent("user_exit"), "copilot");

  assert.equal(actual.sessions[sessionId], undefined);
});

test("abnormal sessionEnd keeps the session", () => {
  const started = applyLifecycleEvent(
    emptyRegistry(),
    startEvent(),
    "copilot",
  );

  const actual = applyLifecycleEvent(started, endEvent("error"), "copilot");

  assert.deepEqual(actual, started);
});

for (const reason of ["complete", "user_exit"] as const) {
  test(`${reason} is a clean end`, () => {
    const started = applyLifecycleEvent(
      emptyRegistry(),
      startEvent(),
      "copilot",
    );
    const actual = applyLifecycleEvent(started, endEvent(reason), "copilot");
    assert.equal(actual.sessions[sessionId], undefined);
  });
}

for (const reason of ["error", "abort", "timeout"] as const) {
  test(`${reason} remains recoverable`, () => {
    const started = applyLifecycleEvent(
      emptyRegistry(),
      startEvent(),
      "copilot",
    );
    const actual = applyLifecycleEvent(started, endEvent(reason), "copilot");
    assert.deepEqual(actual, started);
  });
}

test("repeated start refreshes cwd and source but keeps the first start details", () => {
  const started = applyLifecycleEvent(
    emptyRegistry(),
    startEvent({
      cwd: "C:\\src\\ms-pal",
      source: "startup",
      timestamp: startedAt,
    }),
    "copilot",
  );

  const actual = applyLifecycleEvent(
    started,
    startEvent({
      cwd: "C:\\src\\copilot-auto-save",
      source: "resume",
      timestamp: startedAt + 30_000,
    }),
    "another-profile",
  );

  assert.deepEqual(actual.sessions[sessionId], {
    sessionId,
    cwd: "C:\\src\\copilot-auto-save",
    launcherProfile: "copilot",
    source: "resume",
    startedAt: "2026-10-05T18:10:00.000Z",
    lastSeenAt: "2026-10-05T18:10:30.000Z",
  });
});

test("start and clean end leave the input registry unchanged", () => {
  const original = emptyRegistry();
  const originalSnapshot = structuredClone(original);

  const started = applyLifecycleEvent(original, startEvent(), "copilot");

  assert.deepEqual(original, originalSnapshot);

  const startedSnapshot = structuredClone(started);
  const ended = applyLifecycleEvent(started, endEvent("complete"), "copilot");

  assert.deepEqual(started, startedSnapshot);
  assert.equal(ended.sessions[sessionId], undefined);
});
