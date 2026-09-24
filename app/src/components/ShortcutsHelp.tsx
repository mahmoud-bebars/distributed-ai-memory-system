import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: "⌘K", description: "Focus project search" },
  { keys: "⌘/", description: "Show this shortcuts overlay" },
  { keys: "G then L", description: "Toggle graph / list view in the current project" },
  { keys: "⌘⏎", description: "Send the current chat message" },
  { keys: "Esc", description: "Close dialogs, panels, and overlays" },
];

export function ShortcutsHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Works anywhere in the app.</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2 py-1">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center justify-between gap-4 text-sm">
              <span className="text-muted-foreground">{s.description}</span>
              <kbd className="shrink-0 rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs font-medium">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
