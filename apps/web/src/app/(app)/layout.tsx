import { getDb, platformAccounts } from "@cp-arena/db";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { signOut } from "@/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { displayName, requireMember } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await requireMember();
  const [demo] = await getDb().select({ id: platformAccounts.id }).from(platformAccounts).where(eq(platformAccounts.synthetic, true)).limit(1);

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/signin" });
  }

  const links = [
    { href: "/leaderboard", label: "Leaderboard" },
    { href: "/me", label: "My dashboard" },
    { href: "/contests", label: "Contests" },
    { href: "/scoring", label: "Scoring" },
    { href: "/onboarding", label: "Accounts" },
    ...(me.role === "admin" ? [{ href: "/admin/sync-health", label: "Sync health" }] : []),
  ];

  return (
    <div className="min-h-dvh">
      {demo && (
        <div className="bg-primary/15 px-4 py-1 text-center text-xs" role="note">
          Demo data: the seeded members and their histories are fake. Real accounts sync from the platforms.
        </div>
      )}
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2">
          <Link href="/leaderboard" className="font-bold">
            CP Arena
          </Link>
          <nav className="flex flex-1 gap-1 overflow-x-auto text-sm" aria-label="Main">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="shrink-0 rounded-md px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                {l.label}
              </Link>
            ))}
          </nav>
          <ThemeToggle />
          <form action={logout}>
            <button className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent" title={`Signed in as ${displayName(me)}`}>
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
