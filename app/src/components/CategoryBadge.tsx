import { Badge } from "@/components/ui/badge";
import { CATEGORY_COLORS, type EntityCategory } from "@/lib/memory";

export function CategoryBadge({ category }: { category: EntityCategory }) {
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span
        className="inline-block size-2 shrink-0 rounded-full"
        style={{ backgroundColor: CATEGORY_COLORS[category] }}
      />
      {category}
    </Badge>
  );
}
