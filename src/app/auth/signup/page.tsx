import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getOwnerSessionForRsc } from "@/lib/owner-auth";

export const metadata = { title: "Create account — Sufra" };

export default async function SignupPage() {
  const session = await getOwnerSessionForRsc();
  if (session) redirect("/dashboard");

  return <AuthForm mode="signup" />;
}