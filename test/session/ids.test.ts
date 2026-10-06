import assert from "node:assert/strict";
import test from "node:test";

import {
  isSessionId,
  resolveSessionIdPrefix,
} from "../../src/session/ids.ts";

const first = "502ed8ca-ce22-4e92-b6a7-34eaec25c59d";
const second = "502ed8cb-1111-4222-8333-444444444444";
const mixedCase = "AbCdEf01-2345-4aBc-8dEf-0123456789ab";

test("accepts a full lowercase or uppercase UUID", () => {
  assert.equal(isSessionId(first), true);
  assert.equal(isSessionId(first.toUpperCase()), true);
  assert.equal(isSessionId("not-a-session"), false);
});

test("resolves an unambiguous prefix with at least seven hex characters", () => {
  assert.equal(resolveSessionIdPrefix([first, second], "502ed8ca"), first);
  assert.equal(resolveSessionIdPrefix([first, second], first), first);
});

test("preserves the stored session ID casing when matching a case-insensitive prefix", () => {
  assert.equal(
    resolveSessionIdPrefix([mixedCase], "abcdef01"),
    mixedCase,
  );
});

test("rejects short and ambiguous prefixes", () => {
  assert.throws(() => resolveSessionIdPrefix([first], "502ed8"));
  assert.throws(() => resolveSessionIdPrefix([first, second], "502ed8c"));
});
