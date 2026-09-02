import { Fragment, type ReactNode } from "react";

// A deliberately small markdown subset for chat answers — bold, inline
// code, headings, and bullet lists cover what the model actually produces
// (see ChatService's system prompt). Not a general-purpose renderer: no
// links, tables, or nested lists. Renders to React elements rather than
// dangerouslySetInnerHTML since the text is model-generated.

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|`(.+?)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    if (match[1] !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-b-${i}`}>{match[1]}</strong>);
    } else if (match[2] !== undefined) {
      nodes.push(
        <code
          key={`${keyPrefix}-c-${i}`}
          className="rounded bg-black/10 px-1 py-0.5 font-mono text-[0.85em] dark:bg-white/10"
        >
          {match[2]}
        </code>
      );
    }
    lastIndex = pattern.lastIndex;
    i++;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export function renderMarkdown(text: string): ReactNode {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let listItems: string[] = [];
  let key = 0;

  function flushList() {
    if (listItems.length === 0) return;
    const items = listItems;
    listItems = [];
    blocks.push(
      <ul key={`ul-${key++}`} className="list-disc space-y-0.5 pl-5">
        {items.map((item, i) => (
          <li key={i}>{renderInline(item, `li-${key}-${i}`)}</li>
        ))}
      </ul>
    );
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      flushList();
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      listItems.push(bulletMatch[1] ?? "");
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      flushList();
      const level = (headingMatch[1] ?? "#").length;
      const content = renderInline(headingMatch[2] ?? "", `h-${key}`);
      blocks.push(
        <Fragment key={`h-${key++}`}>
          {level === 1 ? (
            <h3 className="mt-1 text-base font-semibold first:mt-0">{content}</h3>
          ) : level === 2 ? (
            <h4 className="mt-1 text-sm font-semibold first:mt-0">{content}</h4>
          ) : (
            <h5 className="mt-1 text-sm font-semibold first:mt-0">{content}</h5>
          )}
        </Fragment>
      );
      continue;
    }

    flushList();
    blocks.push(<p key={`p-${key++}`}>{renderInline(trimmed, `p-${key}`)}</p>);
  }
  flushList();

  return <div className="space-y-1.5">{blocks}</div>;
}
