import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { createMascotProfile, mascotProfileSchema, type MascotProfile } from "../shared/mascot-profile.ts";
import { writeFileAtomic } from "./atomic.ts";

export function normalizeStoredMascotProfile(
  profile: unknown,
  legacyBody: Parameters<typeof createMascotProfile>[0],
  onInvalidProfile: () => void,
): { profile: MascotProfile; changed: boolean } {
  const parsed = mascotProfileSchema.safeParse(profile);
  if (parsed.success) return { profile: parsed.data, changed: false };
  if (profile !== undefined) onInvalidProfile();
  return { profile: createMascotProfile(legacyBody), changed: true };
}

function ensureRecoveryMode(path: string, mode: number): void {
  if (process.platform === "win32") return;
  if ((lstatSync(path).mode & 0o777) !== mode) chmodSync(path, mode);
  if ((lstatSync(path).mode & 0o777) !== mode) throw new Error("Mascot profile recovery permissions could not be secured.");
}

export function preserveInvalidMascotProfileRegistry(file: string, botId: string): void {
  const registry = readFileSync(file);
  const recoveryDirectory = join(dirname(file), "mascot-profile-recovery");
  mkdirSync(recoveryDirectory, { recursive: true, mode: 0o700 });
  const directoryStat = lstatSync(recoveryDirectory);
  if (!directoryStat.isDirectory()) throw new Error("Mascot profile recovery path is not a directory.");
  ensureRecoveryMode(recoveryDirectory, 0o700);

  const digest = createHash("sha256").update(registry).digest("hex");
  const recoveryFile = join(recoveryDirectory, `bots-mascot-profile-${digest}.json`);
  let existingStat: ReturnType<typeof lstatSync> | undefined;
  try {
    existingStat = lstatSync(recoveryFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (existingStat) {
    if (!existingStat.isFile() || !readFileSync(recoveryFile).equals(registry)) {
      throw new Error("Mascot profile recovery file does not match the source registry.");
    }
    ensureRecoveryMode(recoveryFile, 0o600);
  } else {
    writeFileAtomic(recoveryFile, registry, { mode: 0o600 });
    const writtenStat = lstatSync(recoveryFile);
    if (!writtenStat.isFile() || !readFileSync(recoveryFile).equals(registry)) {
      throw new Error("Mascot profile recovery file does not match the source registry.");
    }
    ensureRecoveryMode(recoveryFile, 0o600);
  }

  console.warn(`[mascot-profile] invalid profile for bot ${botId}; preserved registry at ${recoveryFile}`);
}
