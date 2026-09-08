import { cn } from "@/lib/utils";

interface RestaurantLogoProps {
  logo: string | null;
  name: string;
  brandColor: string;
  size?: number;
  className?: string;
}

export function RestaurantLogo({
  logo,
  name,
  brandColor,
  size = 40,
  className,
}: RestaurantLogoProps) {
  if (logo) {
    return (
      <img
        src={logo}
        alt={name}
        width={size}
        height={size}
        className={cn(
          "object-cover rounded-xl border border-white/10 shrink-0",
          className,
        )}
        style={{ width: size, height: size }}
      />
    );
  }

  const initial = (name || "T").trim().charAt(0).toUpperCase() || "T";

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-xl shrink-0 shadow-sm",
        className,
      )}
      style={{ width: size, height: size, backgroundColor: brandColor }}
    >
      <span
        className="font-serif italic font-bold text-black leading-none"
        style={{ fontSize: size * 0.42 }}
      >
        {initial}
      </span>
    </div>
  );
}