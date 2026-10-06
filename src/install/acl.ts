import {
  runProcess,
  type ProcessRunner,
} from "../launch/process-runner.ts";

export interface AclResult {
  protected: boolean;
  detail: string;
}

function failure(detail: string): AclResult {
  return {
    protected: false,
    detail,
  };
}

function processErrorDetail(
  action: string,
  exitCode: number,
  stderr: string,
  stdout: string,
): string {
  const detail = stderr.trim() || stdout.trim() || `exit code ${exitCode}`;
  return `${action} failed: ${detail}`;
}

function parseCsvFields(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    const next = line[index + 1];

    if (quoted && char === '"' && next === '"') {
      field += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (!quoted && char === ",") {
      fields.push(field);
      field = "";
      continue;
    }

    field += char;
  }

  fields.push(field);
  return fields;
}

async function currentUserSid(runner: ProcessRunner): Promise<string | AclResult> {
  const result = await runner({
    executable: "whoami.exe",
    args: ["/user", "/fo", "csv", "/nh"],
  });

  if (result.exitCode !== 0) {
    return failure(
      processErrorDetail("Resolving current user SID", result.exitCode, result.stderr, result.stdout),
    );
  }

  const line = result.stdout.trim().split(/\r?\n/u)[0];
  if (line === undefined || line.length === 0) {
    return failure("Resolving current user SID failed: empty output");
  }

  const sid = parseCsvFields(line)[1];
  if (sid === undefined || sid.trim().length === 0) {
    return failure("Resolving current user SID failed: malformed whoami output");
  }

  return sid.trim();
}

function thrownDetail(action: string, error: unknown): string {
  return `${action} failed: ${error instanceof Error ? error.message : String(error)}`;
}

export async function protectStateDirectory(
  appDir: string,
  runner: ProcessRunner = runProcess,
): Promise<AclResult> {
  try {
    const sid = await currentUserSid(runner);
    if (typeof sid !== "string") {
      return sid;
    }

    const result = await runner({
      executable: "icacls.exe",
      args: [
        appDir,
        "/inheritance:r",
        "/grant:r",
        `*${sid}:F`,
        `*${sid}:(OI)(CI)F`,
        "/T",
        "/C",
      ],
    });

    if (result.exitCode !== 0) {
      return failure(
        processErrorDetail("Protecting state directory", result.exitCode, result.stderr, result.stdout),
      );
    }

    return {
      protected: true,
      detail: "State directory is protected for the current user.",
    };
  } catch (error) {
    return failure(thrownDetail("Protecting state directory", error));
  }
}

export async function checkStateDirectoryProtection(
  appDir: string,
  runner: ProcessRunner = runProcess,
): Promise<AclResult> {
  try {
    const sid = await currentUserSid(runner);
    if (typeof sid !== "string") {
      return sid;
    }

    const result = await runner({
      executable: "icacls.exe",
      args: [appDir],
    });

    if (result.exitCode !== 0) {
      return failure(
        processErrorDetail("Inspecting state directory ACL", result.exitCode, result.stderr, result.stdout),
      );
    }

    const normalized = result.stdout.replace(/\s+/gu, " ");
    if (
      normalized.includes(sid) &&
      (normalized.includes(":(OI)(CI)(F)") || normalized.includes(":(F)"))
    ) {
      return {
        protected: true,
        detail: "State directory is protected for the current user.",
      };
    }

    return failure("State directory ACL does not show current-user full control.");
  } catch (error) {
    return failure(thrownDetail("Inspecting state directory ACL", error));
  }
}
