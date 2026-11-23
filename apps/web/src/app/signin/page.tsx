import { getDb, users } from "@cp-arena/db";
import { and, asc, eq, like } from "drizzle-orm";
import { redirect } from "next/navigation";
import { devLoginEnabled, googleEnabled, signIn } from "@/auth";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Select } from "@/components/ui";
import { currentUser } from "@/lib/session";

export const metadata = { title: "Sign in" };

export default async function SignInPage() {
  if (await currentUser()) redirect("/");
  const seeded = devLoginEnabled
    ? await getDb()
        .select({ email: users.email, name: users.name, role: users.role })
        .from(users)
        .where(and(like(users.email, "%@seed.cparena.local"), eq(users.status, "active")))
        .orderBy(asc(users.role), asc(users.name))
    : [];

  async function google() {
    "use server";
    await signIn("google", { redirectTo: "/" });
  }
  async function dev(formData: FormData) {
    "use server";
    const email = String(formData.get("email") || formData.get("seeded") || "");
    await signIn("dev", { email, redirectTo: "/" });
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-bold">CP Arena</h1>
        <p className="text-sm text-muted-foreground">One fair leaderboard across LeetCode, Codeforces and CodeChef. Members only.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>New here? You&apos;ll need an invite code after signing in.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {googleEnabled ? (
            <form action={google}>
              <Button className="w-full" type="submit">
                Continue with Google
              </Button>
            </form>
          ) : (
            <p className="text-xs text-muted-foreground">Google sign-in isn&apos;t configured (set AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET).</p>
          )}
          <p className="text-xs text-muted-foreground">Email magic link: coming soon.</p>
        </CardContent>
      </Card>

      {devLoginEnabled && (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Dev login</CardTitle>
            <CardDescription>Local development only — disabled in production. No password, no verification.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={dev} className="flex flex-col gap-3">
              {seeded.length > 0 && (
                <label className="flex flex-col gap-1 text-xs">
                  Sign in as a seeded member
                  <Select name="seeded" defaultValue="" aria-label="Seeded member">
                    <option value="">— pick one —</option>
                    {seeded.map((u) => (
                      <option key={u.email} value={u.email}>
                        {u.name}
                        {u.role === "admin" ? " (admin)" : ""}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              <label className="flex flex-col gap-1 text-xs">
                …or any email (creates a new member who goes through onboarding)
                <Input name="email" type="email" placeholder="you@example.com" />
              </label>
              <Button type="submit" variant="secondary">
                Dev sign in
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
