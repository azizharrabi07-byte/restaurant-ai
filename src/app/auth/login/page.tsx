import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getOwnerSessionForRsc } from "@/lib/owner-auth";

export const metadata = { title: "Sign in — Sufra" };

export default async function LoginPage() {
  const session = await getOwnerSessionForRsc();
  if (session) redirect("/dashboard");

  return <AuthForm mode="login" />;
}