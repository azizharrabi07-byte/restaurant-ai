import { redirect } from "next/navigation";
import { getOwnerSessionForRsc } from "@/lib/owner-auth";
import { ForgotForm } from "@/components/forgot-form";

export const metadata = { title: "Forgot password — Sufra" };

export default async function ForgotPage() {
  const session = await getOwnerSessionForRsc();
  if (session) redirect("/dashboard");

  return <ForgotForm />;
}