import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseCliArguments } from "../../src/cli/arguments.ts";
import {
  addProfileCommand,
  setDefaultProfileCommand,
  showConfigCommand,
} from "../../src/cli/commands.ts";
import { main } from "../../src/cli/main.ts";
import {
  defaultConfig,
  loadConfig,
  saveConfig,
  type AppConfig,
} from "../../src/config/config.ts";
import type { AppPaths } from "../../src/storage/paths.ts";

interface OutputCapture {
  output: {
    out(message: string): void;
    error(message: string): void;
    confirm(message: string): Promise<boolean>;
  };
  text(): string;
  errorText(): string;
}

interface ConfigTestDependencies {
  paths: AppPaths;
  output: OutputCapture["output"];
  outputCapture: OutputCapture;
  readConfig(): Promise<AppConfig>;
}

function createOutputCapture(): OutputCapture {
  const lines: string[] = [];
  const errors: string[] = [];

  return {
    output: {
      out(message) {
        lines.push(message);
      },
      error(message) {
        errors.push(message);
      },
      async confirm() {
        return true;
      },
    },
    text() {
      return lines.join("\n");
    },
    errorText() {
      return errors.join("\n");
    },
  };
}

async function createConfigTestDependencies(
  t: test.TestContext,
  config: AppConfig,
): Promise<ConfigTestDependencies> {
  const root = await mkdtemp(path.join(os.tmpdir(), "copilot-auto-save-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const paths: AppPaths = {
    appDir: root,
    binDir: path.join(root, "bin"),
    installedExecutable: path.join(root, "bin", "copilot-auto-save.exe"),
    configFile: path.join(root, "config.json"),
    registryFile: path.join(root, "sessions.json"),
    lockFile: path.join(root, "sessions.lock"),
    diagnosticsDir: path.join(root, "diagnostics"),
    corruptDir: path.join(root, "corrupt"),
    copilotHookFile: path.join(root, "copilot-auto-save.json"),
  };

  await saveConfig(paths.configFile, config);
  const outputCapture = createOutputCapture();

  return {
    paths,
    output: outputCapture.output,
    outputCapture,
    readConfig() {
      return loadConfig(paths.configFile);
    },
  };
}

test("parseCliArguments parses config commands and rejects invalid forms", () => {
  assert.deepEqual(parseCliArguments(["config", "show"]), {
    name: "config",
    action: {
      name: "show",
    },
  });
  assert.deepEqual(
    parseCliArguments(["config", "set", "default-profile", "agency"]),
    {
      name: "config",
      action: {
        name: "set-default-profile",
        profileName: "agency",
      },
    },
  );
  assert.deepEqual(
    parseCliArguments([
      "config",
      "profile",
      "add",
      "corp",
      "--executable",
      "corp-cli",
      "--arg",
      "copilot",
      "--arg",
      "--resume={sessionId}",
      "--replace",
    ]),
    {
      name: "config",
      action: {
        name: "add-profile",
        profileName: "corp",
        executable: "corp-cli",
        args: ["copilot", "--resume={sessionId}"],
        replace: true,
      },
    },
  );

  assert.throws(
    () => parseCliArguments(["config", "set", "default-profile"]),
    /config set default-profile requires a profile name\./i,
  );
  assert.throws(
    () => parseCliArguments(["config", "profile", "add", "corp", "--executable", "corp-cli"]),
    /requires at least one --arg/i,
  );
  assert.throws(
    () => parseCliArguments(["config", "profile", "add", "corp", "--arg", "copilot"]),
    /requires --executable/i,
  );
});

test("show prints formatted JSON", async (t) => {
  const deps = await createConfigTestDependencies(t, defaultConfig());

  assert.equal(await showConfigCommand(deps), 0);
  assert.equal(
    deps.outputCapture.text(),
    JSON.stringify(defaultConfig(), null, 2),
  );
});

test("sets the default profile only when it exists", async (t) => {
  const deps = await createConfigTestDependencies(t, defaultConfig());

  assert.equal(await setDefaultProfileCommand("agency", deps), 0);
  assert.equal((await deps.readConfig()).defaultProfile, "agency");
  assert.equal(await setDefaultProfileCommand("missing", deps), 1);
});

test("adds a structured profile without evaluating a shell", async (t) => {
  const deps = await createConfigTestDependencies(t, defaultConfig());

  assert.equal(
    await addProfileCommand(
      "corp",
      "corp-cli",
      ["copilot", "--resume={sessionId}"],
      false,
      deps,
    ),
    0,
  );
  assert.deepEqual((await deps.readConfig()).profiles.corp, {
    executable: "corp-cli",
    args: ["copilot", "--resume={sessionId}"],
  });
});

test("duplicate profile names require --replace", async (t) => {
  const deps = await createConfigTestDependencies(t, defaultConfig());

  assert.equal(
    await addProfileCommand(
      "agency",
      "agency",
      ["copilot", "--resume={sessionId}"],
      false,
      deps,
    ),
    1,
  );
  assert.match(deps.outputCapture.errorText(), /already exists/i);

  assert.equal(
    await addProfileCommand(
      "agency",
      "agency-cli",
      ["copilot", "--resume={sessionId}"],
      true,
      deps,
    ),
    0,
  );
  assert.deepEqual((await deps.readConfig()).profiles.agency, {
    executable: "agency-cli",
    args: ["copilot", "--resume={sessionId}"],
  });
});

test("main wires config show through the config command", async (t) => {
  const deps = await createConfigTestDependencies(t, defaultConfig());

  assert.equal(
    await main(["config", "show"], {
      paths: deps.paths,
      output: deps.output,
    }),
    0,
  );
  assert.match(deps.outputCapture.text(), /"defaultProfile": "copilot"/);
});

test("main wires config set default-profile through the config command", async (t) => {
  const deps = await createConfigTestDependencies(t, defaultConfig());

  assert.equal(
    await main(["config", "set", "default-profile", "agency"], {
      paths: deps.paths,
      output: deps.output,
    }),
    0,
  );
  assert.equal((await deps.readConfig()).defaultProfile, "agency");
  assert.match(deps.outputCapture.text(), /Default profile set to agency\./);
});

test("main wires config profile add through the config command", async (t) => {
  const deps = await createConfigTestDependencies(t, defaultConfig());

  assert.equal(
    await main(
      [
        "config",
        "profile",
        "add",
        "corp",
        "--executable",
        "corp-cli",
        "--arg",
        "copilot",
        "--arg",
        "--resume={sessionId}",
      ],
      {
        paths: deps.paths,
        output: deps.output,
      },
    ),
    0,
  );
  assert.deepEqual((await deps.readConfig()).profiles.corp, {
    executable: "corp-cli",
    args: ["copilot", "--resume={sessionId}"],
  });
  assert.match(deps.outputCapture.text(), /Saved launcher profile corp\./);
});
