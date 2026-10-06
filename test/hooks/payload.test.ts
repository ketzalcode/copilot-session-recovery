import assert from "node:assert/strict";
import test from "node:test";

import {
  parseSessionEndPayload,
  parseSessionStartPayload,
} from "../../src/hooks/payload.ts";

test("parses the documented sessionStart payload", () => {
  assert.deepEqual(
    parseSessionStartPayload({
      sessionId: "502ed8ca-ce22-4e92-b6a7-34eaec25c59d",
      timestamp: 1_759_689_000_000,
      cwd: "C:\\src\\ms-pal",
      source: "resume",
    }),
    {
      type: "start",
      sessionId: "502ed8ca-ce22-4e92-b6a7-34eaec25c59d",
      timestamp: 1_759_689_000_000,
      cwd: "C:\\src\\ms-pal",
      source: "resume",
    },
  );
});

test("parses the documented sessionEnd payload", () => {
  assert.equal(
    parseSessionEndPayload({
      sessionId: "502ed8ca-ce22-4e92-b6a7-34eaec25c59d",
      timestamp: 1_759_689_010_000,
      cwd: "C:\\src\\ms-pal",
      reason: "timeout",
    }).reason,
    "timeout",
  );
});

test("rejects unknown sources, reasons, invalid UUIDs, and missing cwd", () => {
  assert.throws(() =>
    parseSessionStartPayload({
      sessionId: "bad",
      timestamp: 1,
      cwd: "",
      source: "other",
    }),
  );
  assert.throws(() =>
    parseSessionEndPayload({
      sessionId: "502ed8ca-ce22-4e92-b6a7-34eaec25c59d",
      timestamp: 1,
      cwd: "C:\\src",
      reason: "killed",
    }),
  );
});
