import { accentVar, hueFor } from "@/lib/palette";
import { cn } from "@/lib/utils";

export function ProjectIcon({
  slug,
  title,
  className,
}: {
  slug: string;
  title: string;
  className?: string;
}) {
  const color = accentVar(hueFor(slug));
  const initial = title.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className={cn(
        "glow-ring flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold",
        className
      )}
      style={
        {
          "--glow-color": color,
          backgroundColor: `color-mix(in oklch, ${color} 22%, var(--card))`,
          color,
        } as React.CSSProperties
      }
    >
      {initial}
    </span>
  );
}
