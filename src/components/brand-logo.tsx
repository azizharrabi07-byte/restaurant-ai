import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden
      className={cn("h-full w-full", className)}
    >
      {/* Plate ring — the laid table */}
      <circle
        cx="24"
        cy="24"
        r="16.5"
        stroke="currentColor"
        strokeWidth="3.5"
      />
      {/* QR finder corners (scan motif) at TL, TR, BL */}
      <rect
        x="6.5"
        y="6.5"
        width="9.5"
        height="9.5"
        stroke="currentColor"
        strokeWidth="2.75"
      />
      <circle cx="11.25" cy="11.25" r="1.9" fill="currentColor" />
      <rect
        x="32"
        y="6.5"
        width="9.5"
        height="9.5"
        stroke="currentColor"
        strokeWidth="2.75"
      />
      <circle cx="36.75" cy="11.25" r="1.9" fill="currentColor" />
      <rect
        x="6.5"
        y="32"
        width="9.5"
        height="9.5"
        stroke="currentColor"
        strokeWidth="2.75"
      />
      <circle cx="11.25" cy="36.75" r="1.9" fill="currentColor" />
      {/* The order — warm accent at the center of the table */}
      <circle cx="24" cy="24" r="3.1" fill="#D97706" />
    </svg>
  );
}

export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "text-lg font-serif italic tracking-tight text-white",
        className,
      )}
    >
      Sufra
    </span>
  );
}