import path from "node:path";

import type { AppConfig } from "../config/config.ts";
import type { SessionRecord, SessionRegistry } from "../session/model.ts";
import { expandProfile } from "./profile.ts";
import type { ProcessSpec } from "./process-runner.ts";

export interface RecoveryTab {
  sessionId: string;
  cwd: string;
  title: string;
  launcherProfile: string;
  process: ProcessSpec;
  lastSeenAt: string;
}

export interface SkippedSession {
  sessionId: string;
  cwd: string;
  reason: "working-directory-missing";
}

export interface RecoveryPlan {
  tabs: RecoveryTab[];
  skipped: SkippedSession[];
  profileUpdates: Record<string, string>;
}

interface RecoveryPlanDependencies {
  profileOverride?: string | undefined;
  directoryExists: (cwd: string) => Promise<boolean>;
  commandExists: (executable: string) => Promise<boolean>;
}

function titleFor(session: SessionRecord): string {
  const directory = path.win32.basename(session.cwd) || "session";
  const prefix = session.sessionId.replaceAll("-", "").slice(0, 7);

  return `${directory.slice(0, 48)} - ${prefix}`;
}

export async function buildRecoveryPlan(
  registry: SessionRegistry,
  config: AppConfig,
  deps: RecoveryPlanDependencies,
): Promise<RecoveryPlan> {
  const tabs: RecoveryTab[] = [];
  const skipped: SkippedSession[] = [];
  const profileUpdates: Record<string, string> = {};
  const commandAvailability = new Map<string, boolean>();

  for (const session of Object.values(registry.sessions).sort((a, b) =>
    a.lastSeenAt.localeCompare(b.lastSeenAt) ||
    a.sessionId.localeCompare(b.sessionId),
  )) {
    if (!(await deps.directoryExists(session.cwd))) {
      skipped.push({
        sessionId: session.sessionId,
        cwd: session.cwd,
        reason: "working-directory-missing",
      });
      continue;
    }

    const profileName = deps.profileOverride ?? session.launcherProfile;
    const profile = config.profiles[profileName];
    if (!profile) {
      throw new Error(`Launcher profile ${profileName} does not exist.`);
    }

    let available = commandAvailability.get(profile.executable);
    if (available === undefined) {
      available = await deps.commandExists(profile.executable);
      commandAvailability.set(profile.executable, available);
    }

    if (!available) {
      throw new Error(
        `Launcher executable ${profile.executable} was not found.`,
      );
    }

    profileUpdates[session.sessionId] = profileName;
    tabs.push({
      sessionId: session.sessionId,
      cwd: session.cwd,
      title: titleFor(session),
      launcherProfile: profileName,
      process: expandProfile(profile, session),
      lastSeenAt: session.lastSeenAt,
    });
  }

  return { tabs, skipped, profileUpdates };
}
