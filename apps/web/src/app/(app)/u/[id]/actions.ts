"use server";

import { REFRESH_COOLDOWN_MS, enqueueAccountSync, getDb, platformAccounts, users } from "@cp-arena/db";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/session";

export type RefreshState = { ok: boolean; message: string } | null;

/** "Refresh my data" — enqueues a high-priority sync of the member's real, verified accounts. 15-minute cooldown. */
export async function requestRefresh(): Promise<RefreshState> {
  const me = await requireMember();
  const last = me.lastRefreshRequestedAt?.getTime() ?? 0;
  const wait = last + REFRESH_COOLDOWN_MS - Date.now();
  if (wait > 0) return { ok: false, message: `You can refresh again in ${Math.ceil(wait / 60_000)} min.` };
  const db = getDb();
  const accs = await db
    .select({ id: platformAccounts.id })
    .from(platformAccounts)
    .where(and(eq(platformAccounts.userId, me.id), eq(platformAccounts.verified, true), eq(platformAccounts.synthetic, false)));
  if (accs.length === 0) return { ok: false, message: "No verified real accounts to sync (demo accounts are never synced)." };
  for (const a of accs) await enqueueAccountSync(db, a.id, 5);
  await db.update(users).set({ lastRefreshRequestedAt: new Date() }).where(eq(users.id, me.id));
  revalidatePath(`/u/${me.id}`);
  return { ok: true, message: `Queued ${accs.length} account(s). The worker usually finishes within a couple of minutes.` };
}
