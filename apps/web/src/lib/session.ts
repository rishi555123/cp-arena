import "server-only";
import { getDb, users, type User } from "@cp-arena/db";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";

/** Current user, re-read from the DB on every request so role/status changes apply immediately. */
export const currentUser = cache(async (): Promise<User | null> => {
  const session = await auth();
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!id) return null;
  const [u] = await getDb().select().from(users).where(eq(users.id, id));
  return u && u.status !== "removed" ? u : null;
});

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) redirect("/signin");
  return u;
}

/** Members-only pages: signed in AND finished onboarding. */
export async function requireMember(): Promise<User> {
  const u = await requireUser();
  if (u.status !== "active") redirect("/onboarding");
  return u;
}

export async function requireAdmin(): Promise<User> {
  const u = await requireMember();
  if (u.role !== "admin") redirect("/leaderboard");
  return u;
}

export const displayName = (u: Pick<User, "name" | "displayName" | "email">) => u.displayName || u.name || u.email.split("@")[0];
