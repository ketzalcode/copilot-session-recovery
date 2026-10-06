import path from "node:path";

import type { SkippedSession, RecoveryTab } from "../launch/recovery-plan.ts";

interface TableRow {
  id: string;
  directory: string;
  cwd: string;
  launcher: string;
  lastSeen: string;
}

function sessionPrefix(sessionId: string): string {
  return sessionId.replaceAll("-", "").slice(0, 7);
}

function directoryLabel(cwd: string): string {
  return path.win32.basename(cwd) || "session";
}

function formatAge(lastSeenAt: string, now: number): string {
  const ageMs = Math.max(0, now - Date.parse(lastSeenAt));
  const seconds = Math.floor(ageMs / 1000);

  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  return `${Math.floor(hours / 24)}d ago`;
}

function formatSection(title: string, rows: readonly TableRow[]): string {
  if (rows.length === 0) {
    return "";
  }

  const headers = {
    id: "ID",
    directory: "Directory",
    cwd: "Working directory",
    launcher: "Launcher",
    lastSeen: "Last seen",
  } satisfies TableRow;
  const idWidth = Math.max(headers.id.length, ...rows.map((row) => row.id.length));
  const directoryWidth = Math.max(
    headers.directory.length,
    ...rows.map((row) => row.directory.length),
  );
  const cwdWidth = Math.max(headers.cwd.length, ...rows.map((row) => row.cwd.length));
  const launcherWidth = Math.max(
    headers.launcher.length,
    ...rows.map((row) => row.launcher.length),
  );
  const lastSeenWidth = Math.max(
    headers.lastSeen.length,
    ...rows.map((row) => row.lastSeen.length),
  );

  const renderRow = (row: TableRow) =>
    [
      row.id.padEnd(idWidth),
      row.directory.padEnd(directoryWidth),
      row.cwd.padEnd(cwdWidth),
      row.launcher.padEnd(launcherWidth),
      row.lastSeen.padEnd(lastSeenWidth),
    ].join("  ");

  return [
    `${title}:`,
    renderRow(headers),
    ...rows.map(renderRow),
  ].join("\n");
}

function quoteWindowsArgument(argument: string): string {
  if (argument.length === 0) {
    return '""';
  }

  if (!/[ \t"]/.test(argument)) {
    return argument;
  }

  let result = '"';
  let backslashes = 0;

  for (const character of argument) {
    if (character === "\\") {
      backslashes += 1;
      continue;
    }

    if (character === '"') {
      result += `${"\\".repeat(backslashes * 2 + 1)}"`;
      backslashes = 0;
      continue;
    }

    result += `${"\\".repeat(backslashes)}${character}`;
    backslashes = 0;
  }

  result += `${"\\".repeat(backslashes * 2)}"`;
  return result;
}

export function formatSessionTable(
  tabs: readonly RecoveryTab[],
  skipped: readonly SkippedSession[],
  now = Date.now(),
): string {
  const recoverable = formatSection(
    "Recoverable sessions",
    tabs.map((tab) => ({
      id: sessionPrefix(tab.sessionId),
      directory: directoryLabel(tab.cwd),
      cwd: tab.cwd,
      launcher: tab.launcherProfile,
      lastSeen: formatAge(tab.lastSeenAt, now),
    })),
  );
  const skippedSection = formatSection(
    "Skipped sessions",
    skipped.map((session) => ({
      id: sessionPrefix(session.sessionId),
      directory: directoryLabel(session.cwd),
      cwd: session.cwd,
      launcher: `skipped: ${session.reason}`,
      lastSeen: "-",
    })),
  );

  return [recoverable, skippedSection].filter((section) => section.length > 0).join("\n\n");
}

export function formatDryRunCommand(
  executable: string,
  args: readonly string[],
): string {
  return [executable, ...args].map(quoteWindowsArgument).join(" ");
}
