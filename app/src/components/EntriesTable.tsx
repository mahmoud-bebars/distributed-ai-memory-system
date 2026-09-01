import { Fragment, useMemo, useState } from "react";
import type { MemoryEntry } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type TypeFilter = "all" | MemoryEntry["type"];

const TYPE_BADGE_VARIANT: Record<MemoryEntry["type"], "default" | "secondary" | "outline"> = {
  entity: "default",
  relation: "secondary",
  observation: "outline",
};

function preview(entry: MemoryEntry): string {
  const text = JSON.stringify(entry.content);
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

export function EntriesTable({ entries }: { entries: MemoryEntry[] }) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (typeFilter !== "all" && entry.type !== typeFilter) return false;
      if (!q) return true;
      return JSON.stringify(entry).toLowerCase().includes(q);
    });
  }, [entries, typeFilter, query]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex gap-2">
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
        <p className="ml-auto self-center text-xs text-muted-foreground">
          {filtered.length} of {entries.length} entries
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Type</TableHead>
              <TableHead>Preview</TableHead>
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
                return (
                  <Fragment key={entry.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                    >
                      <TableCell>
                        <Badge variant={TYPE_BADGE_VARIANT[entry.type]}>{entry.type}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {preview(entry)}
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
