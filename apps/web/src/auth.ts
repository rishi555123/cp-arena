import { getDb, users } from "@cp-arena/db";
import { eq } from "drizzle-orm";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

const isProd = process.env.NODE_ENV === "production";
export const devLoginEnabled = process.env.AUTH_DEV_LOGIN ? process.env.AUTH_DEV_LOGIN === "true" : !isProd;
export const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

async function upsertUser(email: string, name?: string | null, image?: string | null) {
  const db = getDb();
  const normalized = email.trim().toLowerCase();
  const [existing] = await db.select().from(users).where(eq(users.email, normalized));
  if (existing) return existing;
  const [created] = await db.insert(users).values({ email: normalized, name: name ?? null, image: image ?? null }).returning();
  return created;
}

const providers: NextAuthConfig["providers"] = [];
if (googleEnabled) providers.push(Google);
// TODO(checkpoint 6): email magic link (Auth.js Nodemailer/Resend provider) once email sending is set up.
if (devLoginEnabled) {
  providers.push(
    Credentials({
      id: "dev",
      name: "Dev login",
      credentials: { email: { label: "Email", type: "email" } },
      async authorize(creds) {
        const email = String(creds?.email ?? "").trim();
        if (!/^[^@\s]+@[^@\s]+$/.test(email)) return null;
        const u = await upsertUser(email);
        return { id: u.id, email: u.email, name: u.name };
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  // JWT sessions: works with the dev Credentials provider and needs no adapter tables.
  session: { strategy: "jwt" },
  // `||` not `??`: .env.example ships `AUTH_SECRET=` (empty), which must still fall back in dev.
  secret: process.env.AUTH_SECRET || (isProd ? undefined : "dev-insecure-secret-change-me"),
  trustHost: true,
  pages: { signIn: "/signin" },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        if (!user.email) return false;
        const u = await upsertUser(user.email, user.name, user.image);
        if (u.status === "removed") return false;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user?.email) {
        const [u] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, user.email.toLowerCase()));
        if (u) token.uid = u.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid && session.user) (session.user as { id?: string }).id = token.uid as string;
      return session;
    },
  },
});
