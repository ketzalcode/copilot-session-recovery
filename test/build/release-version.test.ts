import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assertReleaseVersion } from "../../scripts/check-release-version.mjs";

test("assertReleaseVersion accepts an exact v-prefixed package version", () => {
  assert.doesNotThrow(() => {
    assertReleaseVersion("v0.1.0", "0.1.0");
  });
});

test("assertReleaseVersion rejects a tag without the v prefix", () => {
  assert.throws(
    () => {
      assertReleaseVersion("0.1.0", "0.1.0");
    },
    {
      message: "Release tag 0.1.0 does not match package version v0.1.0.",
    },
  );
});

test("assertReleaseVersion rejects a mismatched package version", () => {
  assert.throws(
    () => {
      assertReleaseVersion("v0.2.0", "0.1.0");
    },
    {
      message: "Release tag v0.2.0 does not match package version v0.1.0.",
    },
  );
});

test("CI workflow verifies both supported platforms without artifact uploads", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");

  assert.match(
    workflow,
    /strategy:\s*\r?\n\s*fail-fast:\s*false\s*\r?\n\s*matrix:\s*\r?\n\s*os:\s*\[windows-latest,\s*macos-latest\]/u,
  );
  assert.match(workflow, /runs-on:\s*\$\{\{\s*matrix\.os\s*\}\}/u);
  assert.match(
    workflow,
    /name:\s*Commit metadata guard self-test\s*\r?\n\s*if:\s*\$\{\{\s*matrix\.os == 'windows-latest'\s*\}\}/u,
  );
  assert.match(
    workflow,
    /name:\s*Reject non-noreply maintainer commit metadata[\s\S]*?if:\s*\$\{\{\s*matrix\.os == 'windows-latest'\s*\}\}/u,
  );
  assert.match(workflow, /- run:\s*npm ci/u);
  assert.match(workflow, /- run:\s*npm run verify/u);
  assert.doesNotMatch(workflow, /upload-artifact|\.exe|\.sha256/u);
});

test("release workflow verifies both platforms before trusted npm publish", async () => {
  const workflow = await readFile(".github/workflows/release.yml", "utf8");

  assert.match(
    workflow,
    /on:\s*\r?\n\s*push:\s*\r?\n\s*tags:\s*\["v\*"\]/u,
  );
  assert.doesNotMatch(workflow, /pull_request:|workflow_dispatch:|release:/u);
  assert.match(
    workflow,
    /permissions:\s*\r?\n\s*contents:\s*read\s*\r?\n\s*id-token:\s*write\s*\r?\n/u,
  );
  assert.doesNotMatch(workflow, /contents:\s*write|attestations:|NPM_TOKEN/u);
  assert.match(
    workflow,
    /verify-windows:[\s\S]*?runs-on:\s*windows-latest[\s\S]*?- run:\s*npm ci[\s\S]*?- run:\s*npm run verify/u,
  );
  assert.match(
    workflow,
    /verify-macos:[\s\S]*?runs-on:\s*macos-latest[\s\S]*?- run:\s*npm ci[\s\S]*?- run:\s*npm run verify/u,
  );
  assert.match(
    workflow,
    /publish:[\s\S]*?needs:\s*\[\s*verify-windows,\s*verify-macos\s*\][\s\S]*?runs-on:\s*windows-latest/u,
  );
  assert.match(
    workflow,
    /registry-url:\s*https:\/\/registry\.npmjs\.org/u,
  );
  assert.match(
    workflow,
    /node scripts\/check-release-version\.mjs "\$env:GITHUB_REF_NAME"/u,
  );
  assert.match(workflow, /- run:\s*npm publish/u);
  assert.doesNotMatch(
    workflow,
    /upload-artifact|\.exe|\.sha256|sbom-action|attest-build-provenance|action-gh-release/u,
  );
});
