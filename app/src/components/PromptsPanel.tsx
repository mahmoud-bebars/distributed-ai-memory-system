import { CopyButton } from "@/components/CopyButton";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { seedPrompt, syncPrompt } from "@/lib/prompts";

export function PromptsPanel({ slug }: { slug: string }) {
  return (
    <div className="flex flex-col gap-4 pb-4">
      <Card>
        <CardHeader>
          <CardTitle>Seed this project's memory</CardTitle>
          <CardDescription>
            For a project with no memory yet — paste into Claude Code inside the target repo.
          </CardDescription>
          <CardAction>
            <CopyButton text={seedPrompt(slug)} size="sm" />
          </CardAction>
        </CardHeader>
        <CardContent>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs">
            {seedPrompt(slug)}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sync this project's memory</CardTitle>
          <CardDescription>
            For a project that already has memory — updates it with what's changed instead of
            re-seeding.
          </CardDescription>
          <CardAction>
            <CopyButton text={syncPrompt(slug)} size="sm" />
          </CardAction>
        </CardHeader>
        <CardContent>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs">
            {syncPrompt(slug)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
