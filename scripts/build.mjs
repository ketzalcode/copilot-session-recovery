import { spawn } from "node:child_process";
import { build } from "esbuild";
import {
  copyFile,
  mkdir,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";

const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:0";

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: options.stdio ?? "inherit",
      windowsHide: true,
      ...options,
    });

    let stdout = "";
    let stderr = "";

    if (child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
    }

    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} exited ${code}${
            stderr.trim().length > 0 ? `: ${stderr.trim()}` : ""
          }`,
        ),
      );
    });
  });
}

async function nodeSupportsBuildSea() {
  const result = await run(process.execPath, ["--help"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  return result.stdout.includes("--build-sea") ||
    result.stderr.includes("--build-sea");
}

async function flipSeaFuse(executable) {
  const bytes = await readFile(executable);
  const fuse = Buffer.from(SEA_FUSE);
  const index = bytes.indexOf(fuse);

  if (index === -1) {
    throw new Error(`SEA fuse marker was not found in ${executable}.`);
  }

  bytes[index + fuse.length - 1] = "1".charCodeAt(0);
  await writeFile(executable, bytes);
}

async function injectSeaResource(executable, blob) {
  const scriptPath = "dist/inject-sea-resource.ps1";
  await writeFile(
    scriptPath,
    String.raw`
param(
  [Parameter(Mandatory = $true)][string]$Executable,
  [Parameter(Mandatory = $true)][string]$Blob
)

$ErrorActionPreference = 'Stop'

$source = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class ResourceUpdater {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  private static extern IntPtr BeginUpdateResourceW(string pFileName, bool bDeleteExistingResources);

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  private static extern bool UpdateResourceW(IntPtr hUpdate, IntPtr lpType, string lpName, ushort wLanguage, byte[] lpData, uint cbData);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool EndUpdateResourceW(IntPtr hUpdate, bool fDiscard);

  public static void AddRCDATA(string exePath, string resourceName, byte[] data) {
    IntPtr handle = BeginUpdateResourceW(exePath, false);
    if (handle == IntPtr.Zero) {
      throw new Win32Exception(Marshal.GetLastWin32Error(), "BeginUpdateResourceW failed");
    }

    bool committed = false;
    try {
      if (!UpdateResourceW(handle, new IntPtr(10), resourceName, 0, data, (uint)data.Length)) {
        throw new Win32Exception(Marshal.GetLastWin32Error(), "UpdateResourceW failed");
      }

      if (!EndUpdateResourceW(handle, false)) {
        throw new Win32Exception(Marshal.GetLastWin32Error(), "EndUpdateResourceW failed");
      }

      committed = true;
    } finally {
      if (!committed) {
        EndUpdateResourceW(handle, true);
      }
    }
  }
}
'@

Add-Type -TypeDefinition $source
[ResourceUpdater]::AddRCDATA($Executable, 'NODE_SEA_BLOB', [IO.File]::ReadAllBytes($Blob))
`,
    "utf8",
  );

  try {
    await run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      executable,
      blob,
    ]);
  } finally {
    await rm(scriptPath, { force: true });
  }
}

async function buildSeaCompatibleBundle(packageJson) {
  await build({
    stdin: {
      contents: `
import { main } from "./src/cli/main.ts";

void main(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    process.stderr.write(
      \`\${error instanceof Error ? error.stack ?? error.message : String(error)}\\n\`,
    );
    process.exitCode = 1;
  });
`,
      loader: "ts",
      resolveDir: process.cwd(),
      sourcefile: "dist/sea-entry.ts",
    },
    outfile: "dist/copilot-session-recovery-sea.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    sourcemap: false,
    minify: false,
    logOverride: {
      "empty-import-meta": "silent",
    },
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version),
    },
  });
}

async function buildLegacyWindowsSea(config) {
  if (process.platform !== "win32") {
    throw new Error(
      "This Node.js version requires Windows resource injection for SEA builds.",
    );
  }

  const blob = "dist/copilot-session-recovery.blob";
  const legacyConfig = "dist/sea-blob-config.json";
  const seaMain = "dist/copilot-session-recovery-sea.cjs";
  await writeFile(
    legacyConfig,
    `${JSON.stringify(
      {
        main: seaMain,
        output: blob,
        disableExperimentalSEAWarning: config.disableExperimentalSEAWarning,
        useSnapshot: config.useSnapshot,
        useCodeCache: config.useCodeCache,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  try {
    await run(process.execPath, ["--experimental-sea-config", legacyConfig]);
    await copyFile(process.execPath, config.output);
    await flipSeaFuse(config.output);
    await injectSeaResource(config.output, blob);
  } finally {
    await unlink(blob).catch(() => undefined);
    await unlink(legacyConfig).catch(() => undefined);
  }
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const seaConfig = JSON.parse(await readFile("sea-config.json", "utf8"));

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

await build({
  entryPoints: ["src/cli/main.ts"],
  outfile: "dist/copilot-session-recovery.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: "linked",
  minify: false,
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
});

if (await nodeSupportsBuildSea()) {
  await run(process.execPath, ["--build-sea", "sea-config.json"]);
} else {
  await buildSeaCompatibleBundle(packageJson);
  await buildLegacyWindowsSea(seaConfig);
}
