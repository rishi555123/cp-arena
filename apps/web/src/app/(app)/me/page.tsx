import { redirect } from "next/navigation";
import { requireMember } from "@/lib/session";

export default async function Me() {
  const me = await requireMember();
  redirect(`/u/${me.id}`);
}
