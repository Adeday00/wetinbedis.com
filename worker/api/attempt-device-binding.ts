import { PlayIntegrityError } from "./google-play-integrity.ts";

/** The first verified platform owns the attempt and its immutable clock origin. */
export async function claimAttemptDeviceBinding(db: D1Database, attemptId: string, playerId: string,
  platform: "ios-app-attest" | "android-play-integrity", registeredAt: number): Promise<number> {
  await db.prepare(`INSERT OR IGNORE INTO attempt_device_bindings (attempt_id, player_id, platform, registered_at)
    SELECT id, player_id, ?3, ?4 FROM attempts WHERE id = ?1 AND player_id = ?2 AND status = 'started'`)
    .bind(attemptId, playerId, platform, registeredAt).run();
  const row = await db.prepare("SELECT player_id, platform, registered_at FROM attempt_device_bindings WHERE attempt_id = ?1")
    .bind(attemptId).first<{ player_id: string; platform: string; registered_at: number }>();
  if (!row || row.player_id !== playerId || row.platform !== platform) {
    throw new PlayIntegrityError("attempt_device_platform_mismatch", 409, "This attempt is already bound to another verified platform.");
  }
  return row.registered_at;
}
