import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function hexToRgba(hex: string, alpha: number): string {
  let clean = hex.trim().replace(/^#/, "");
  // Expand the 3-digit short form (#abc -> #aabbcc) so a valid short colour is
  // honoured instead of silently rendering white.
  if (/^[0-9a-fA-F]{3}$/.test(clean)) {
    clean = clean
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return `rgba(255, 255, 255, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "my-cafe"
  );
}

export function makeToken(prefix: string): string {
  // Cryptographically secure (server mints real invite tokens; this is only
  // the offline/demo fallback, but it must still be unpredictable).
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  // Hex keeps all 8 bytes: 16 characters, the full 64 bits of entropy.
  const rand = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}-${rand}`;
}

/**
 * Canonical base URL for links the product hands out (QR codes, invites,
 * password recovery).
 *
 * `NEXT_PUBLIC_APP_URL` is inlined into both bundles, so the server-rendered
 * HTML and the hydrated client resolve the same value (no hydration mismatch)
 * and printed links follow the deployer's canonical domain even behind a
 * reverse proxy or a preview alias. Server callers without a configured URL
 * pass the request origin as `serverFallback`.
 */
export function appBaseUrl(serverFallback = ""): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  if (typeof window !== "undefined") return window.location.origin;
  // No configured origin and no browser: the request origin (or a relative URL)
  // beats a hardcoded domain the product does not own.
  return serverFallback.replace(/\/+$/, "");
}