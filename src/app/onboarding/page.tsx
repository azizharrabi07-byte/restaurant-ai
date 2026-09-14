import { redirect } from "next/navigation";
import { getOwnerSessionForRsc } from "@/lib/owner-auth";
import { WizardInner } from "./wizard";

export const metadata = { title: "Build your menu — Sufra" };

/**
 * The onboarding wizard writes to the owner's restaurant via `PUT /api/menu`,
 * so it requires an owner session: an anonymous visitor who walks the whole
 * wizard would otherwise build a menu that can never leave the browser
 * (FE-01). `next` sends them straight back here after signing up.
 */
export default async function OnboardingPage() {
  const session = await getOwnerSessionForRsc();
  if (!session) redirect("/auth/signup?next=/onboarding");

  return <WizardInner />;
}
