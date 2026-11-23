"use server";

import { AdapterError, generateVerifyToken, getAdapters, parseProfileInput, type Platform } from "@cp-arena/adapters";
import { auditLog, enqueueAccountSync, getDb, inviteCodes, platformAccounts, recomputeScores, toDay, users } from "@cp-arena/db";
import { PLATFORMS, PLATFORM_LABEL } from "@cp-arena/scoring";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { requireUser } from "@/lib/session";

/** CONFIG default: all three platforms must be linked to finish onboarding. */
const REQUIRED: Platform[] = PLATFORMS;

const back = (params: Record<string, string>): never => redirect(`/onboarding?${new URLSearchParams(params)}`);

function sourceMessage(platform: Platform, e: unknown): string {
  const label = PLATFORM_LABEL[platform];
  if (e instanceof AdapterError) {
    if (e.kind === "not_found") return `No ${label} user with that handle.`;
    if (e.kind === "blocked" || e.kind === "circuit_open" || e.kind === "rate_limited") return `${label} is blocking or rate-limiting us right now. Please try again in a few minutes.`;
    if (e.kind === "parse") return `We couldn't read the ${label} profile page (its layout may have changed). Admins have been alerted.`;
  }
  return `Couldn't reach ${label} right now. Please try again shortly.`;
}

export async function acceptConsent(formData: FormData) {
  const me = await requireUser();
  const code = String(formData.get("invite") ?? "").trim().toUpperCase();
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  const group = String(formData.get("group") ?? "").trim().slice(0, 30);
  if (formData.get("consent") !== "on") back({ err: "Please accept the data notice to continue." });
  if (!name) back({ err: "Please enter the name members will see." });
  const db = getDb();
  const [invite] = await db.select().from(inviteCodes).where(eq(inviteCodes.code, code));
  const valid = invite && (!invite.expiresAt || invite.expiresAt > new Date()) && (invite.maxUses == null || invite.uses < invite.maxUses);
  if (!valid && !me.consentAt) back({ err: "That invite code isn't valid. Ask an admin for one." });
  if (!me.inviteCode) await db.update(inviteCodes).set({ uses: sql`${inviteCodes.uses} + 1` }).where(eq(inviteCodes.code, code));
  await db
    .update(users)
    .set({ consentAt: me.consentAt ?? new Date(), inviteCode: me.inviteCode ?? code, name, groupTag: group || null })
    .where(eq(users.id, me.id));
  await db.insert(auditLog).values({ actorId: me.id, action: "consent.accepted", target: me.id, meta: { invite: code } });
  back({ msg: "Welcome! Now link your accounts." });
}

export async function linkAccount(formData: FormData) {
  const me = await requireUser();
  if (!me.consentAt) back({ err: "Accept the data notice first." });
  const platform = String(formData.get("platform")) as Platform;
  if (!PLATFORMS.includes(platform)) back({ err: "Unknown platform." });
  const parsed = parseProfileInput(platform, String(formData.get("handle") ?? ""));
  if (!parsed.ok) return back({ err: parsed.error, p: platform });

  // Check the handle exists before saving (live call — onboarding is the one place pages hit a platform).
  let canonical = parsed.handle;
  try {
    canonical = (await getAdapters()[platform].getProfile(parsed.handle)).handle;
  } catch (e) {
    return back({ err: sourceMessage(platform, e), p: platform });
  }

  const db = getDb();
  const [taken] = await db
    .select({ userId: platformAccounts.userId })
    .from(platformAccounts)
    .where(and(eq(platformAccounts.platform, platform), sql`lower(${platformAccounts.handle}) = lower(${canonical})`));
  if (taken && taken.userId !== me.id) return back({ err: `That ${PLATFORM_LABEL[platform]} handle is already claimed by another member. Contact an admin if it's yours.`, p: platform });

  // One handle per platform per member: re-linking replaces the old one.
  await db.delete(platformAccounts).where(and(eq(platformAccounts.userId, me.id), eq(platformAccounts.platform, platform)));
  await db.insert(platformAccounts).values({ userId: me.id, platform, handle: canonical, verifyToken: generateVerifyToken(), tokenIssuedAt: new Date() });
  await db.insert(auditLog).values({ actorId: me.id, action: "account.linked", target: `${platform}:${canonical}` });
  revalidatePath("/onboarding");
  back({ msg: `${PLATFORM_LABEL[platform]} handle ${canonical} saved. Now verify you own it.`, p: platform });
}

export async function verifyAccount(formData: FormData) {
  const me = await requireUser();
  const id = String(formData.get("accountId"));
  const db = getDb();
  const [acc] = await db.select().from(platformAccounts).where(and(eq(platformAccounts.id, id), eq(platformAccounts.userId, me.id)));
  if (!acc || !acc.verifyToken) return back({ err: "Nothing to verify." });
  let ok = false;
  let fields: string[] = [];
  try {
    const r = await getAdapters()[acc.platform].verifyToken(acc.handle, acc.verifyToken);
    ok = r.ok;
    fields = r.checkedFields;
  } catch (e) {
    return back({ err: sourceMessage(acc.platform, e), p: acc.platform });
  }
  if (!ok) return back({ err: `Token ${acc.verifyToken} not found in your ${PLATFORM_LABEL[acc.platform]} ${fields.join(" / ")}. Changes can take a minute to show — try again.`, p: acc.platform });

  await db.update(platformAccounts).set({ verified: true, verifiedAt: new Date(), verifyToken: null }).where(eq(platformAccounts.id, acc.id));
  await db.insert(auditLog).values({ actorId: me.id, action: "account.verified", target: `${acc.platform}:${acc.handle}` });
  // First sync runs immediately (high priority in the worker queue).
  await enqueueAccountSync(db, acc.id, 10);
  revalidatePath("/onboarding");
  back({ msg: `Verified! You can now remove the token from your ${PLATFORM_LABEL[acc.platform]} profile. First sync started.`, p: acc.platform });
}

export async function unlinkAccount(formData: FormData) {
  const me = await requireUser();
  const id = String(formData.get("accountId"));
  const db = getDb();
  const [acc] = await db.delete(platformAccounts).where(and(eq(platformAccounts.id, id), eq(platformAccounts.userId, me.id))).returning();
  if (acc) {
    await db.insert(auditLog).values({ actorId: me.id, action: "account.unlinked", target: `${acc.platform}:${acc.handle}` });
    if (me.status === "active") await recomputeScores(db, [toDay(new Date())]);
  }
  revalidatePath("/onboarding");
  back({ msg: "Account unlinked. Its synced data was deleted." });
}

export async function finishOnboarding() {
  const me = await requireUser();
  const db = getDb();
  const accs = await db.select().from(platformAccounts).where(eq(platformAccounts.userId, me.id));
  const missing = REQUIRED.filter((p) => !accs.some((a) => a.platform === p));
  if (missing.length) return back({ err: `Link ${missing.map((p) => PLATFORM_LABEL[p]).join(", ")} to finish.` });
  await db.update(users).set({ status: "active" }).where(eq(users.id, me.id));
  if (accs.some((a) => a.verified)) await recomputeScores(db, [toDay(new Date())]);
  redirect("/me");
}

/** Privacy: hard-delete the member and everything linked to them (FK cascades). */
export async function deleteMyAccount(formData: FormData) {
  const me = await requireUser();
  if (String(formData.get("confirm")) !== "DELETE") return back({ err: 'Type DELETE to confirm account deletion.' });
  const db = getDb();
  await db.insert(auditLog).values({ actorId: null, action: "user.deleted", target: me.id });
  await db.delete(users).where(eq(users.id, me.id));
  await recomputeScores(db, [toDay(new Date())]);
  await signOut({ redirectTo: "/signin" });
}
