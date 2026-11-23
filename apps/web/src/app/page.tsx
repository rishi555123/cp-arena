import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";

export default async function Home() {
  const u = await currentUser();
  redirect(!u ? "/signin" : u.status === "active" ? "/leaderboard" : "/onboarding");
}
