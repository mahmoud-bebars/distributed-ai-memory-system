import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Full CommonMark + GFM rendering (tables, task lists, strikethrough,
// fenced code) for project doc files — distinct from lib/markdown.tsx's
// deliberately tiny subset for chat answers. Renders to a React tree, never
// dangerouslySetInnerHTML, so model- or user-authored doc content can't
// inject arbitrary HTML/scripts.
export function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
