"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Supabase implicit-grant links land as a URL fragment
 * (#access_token=…&refresh_token=…) on whichever URL GoTrue redirects to —
 * the allowlisted redirect target when configured, otherwise the site root.
 * Fragments never reach the server, so when one lands anywhere other than
 * the reset page, forward it there with the fragment preserved.
 */
export function AuthHashForwarder() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (pathname === "/auth/reset" || pathname === "/auth/callback") return;
    const hash = window.location.hash;
    if (!hash || !/(^|[#&])access_token=/.test(hash)) return;
    router.replace(`/auth/reset${hash}`);
  }, [router, pathname]);

  return null;
}