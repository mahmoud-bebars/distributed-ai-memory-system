import { Badge } from "@/components/ui/badge";
import { CATEGORY_ICONS, categoryColor, type EntityCategory } from "@/lib/memory";

export function CategoryBadge({ category }: { category: EntityCategory }) {
  const Icon = CATEGORY_ICONS[category];
  const color = categoryColor(category);
  return (
    <Badge
      variant="outline"
      className="gap-1.5 font-normal"
      style={{ borderColor: `color-mix(in oklch, ${color} 45%, transparent)`, color }}
    >
      <Icon className="size-3" style={{ color }} />
      <span className="text-foreground">{category}</span>
    </Badge>
  );
}
