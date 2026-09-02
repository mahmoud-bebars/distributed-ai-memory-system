import { Fragment, useMemo, useState } from "react";
import type { MemoryEntry } from "@/api";
import { CategoryBadge } from "@/components/CategoryBadge";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  categoryOf,
  currentEntities,
  observationText,
  relationLabel,
  TYPE_BADGE_VARIANT,
} from "@/lib/memory";

type TypeFilter = "all" | MemoryEntry["type"];

function jsonPreview(entry: MemoryEntry): string {
  const text = JSON.stringify(entry.content);
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

function Summary({ entry }: { entry: MemoryEntry }) {
  if (entry.type === "entity") {
    const name = entry.content.name;
    if (typeof name !== "string") {
      return <span className="font-mono text-xs text-muted-foreground">{jsonPreview(entry)}</span>;
    }
    return (
      <div className="flex items-center gap-2">
        <span className="font-medium">{name}</span>
        <CategoryBadge category={categoryOf(entry)} />
      </div>
    );
  }

  if (entry.type === "relation") {
    const source = entry.content.source;
    const target = entry.content.target;
    if (typeof source !== "string" || typeof target !== "string") {
      return <span className="font-mono text-xs text-muted-foreground">{jsonPreview(entry)}</span>;
    }
    const label = relationLabel(entry);
    return (
      <div>
        <div className="font-medium">
          {source} → {target}
        </div>
        {label && <div className="text-xs text-muted-foreground">{label}</div>}
      </div>
    );
  }

  // observation
  const text = entry.content.text;
  if (typeof text !== "string") {
    return <span className="font-mono text-xs text-muted-foreground">{jsonPreview(entry)}</span>;
  }
  const preview = observationText(entry);
  return <span>{preview.length > 100 ? `${preview.slice(0, 100)}…` : preview}</span>;
}

export function EntriesTable({ entries }: { entries: MemoryEntry[] }) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showSuperseded, setShowSuperseded] = useState(false);

  const currentEntityIds = useMemo(() => new Set(currentEntities(entries).map((e) => e.id)), [
    entries,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (typeFilter !== "all" && entry.type !== typeFilter) return false;
      if (!showSuperseded && entry.type === "entity" && !currentEntityIds.has(entry.id)) {
        return false;
      }
      if (!q) return true;
      return JSON.stringify(entry).toLowerCase().includes(q);
    });
  }, [entries, typeFilter, query, showSuperseded, currentEntityIds]);

  const supersededCount = entries.filter(
    (e) => e.type === "entity" && !currentEntityIds.has(e.id)
  ).length;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <Input
          placeholder="Search entries…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="entity">Entity</SelectItem>
            <SelectItem value="relation">Relation</SelectItem>
            <SelectItem value="observation">Observation</SelectItem>
          </SelectContent>
        </Select>
        {supersededCount > 0 && (
          <div className="flex items-center gap-2">
            <Switch
              id="show-superseded"
              checked={showSuperseded}
              onCheckedChange={setShowSuperseded}
            />
            <Label htmlFor="show-superseded" className="text-sm font-normal text-muted-foreground">
              Show superseded entity revisions ({supersededCount})
            </Label>
          </div>
        )}
        <p className="ml-auto self-center text-xs text-muted-foreground">
          {filtered.length} of {entries.length} entries
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Type</TableHead>
              <TableHead>Summary</TableHead>
              <TableHead className="w-44">Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                  No entries match.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((entry) => {
                const isExpanded = expandedId === entry.id;
                const isSuperseded = entry.type === "entity" && !currentEntityIds.has(entry.id);
                return (
                  <Fragment key={entry.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                    >
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant={TYPE_BADGE_VARIANT[entry.type]}>{entry.type}</Badge>
                          {isSuperseded && <Badge variant="outline">superseded</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        <Summary entry={entry} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {entry.created_at ?? "—"}
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={3} className="bg-muted/30">
                          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">
                            {JSON.stringify(entry, null, 2)}
                          </pre>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
