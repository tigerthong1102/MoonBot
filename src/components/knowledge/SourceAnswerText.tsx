import { Fragment, type ReactNode } from "react";
import { parseSourceLink } from "./source-cache";
import { SourceCitation } from "./SourceCitation";

export function isSourceAnswer(message: { role: string; sendId?: string }) {
  return message.role === "bot" && /^source-[\da-f-]{36}-[\da-f]{16}-a$/i.test(message.sendId ?? "");
}

function plain(text: string) {
  return text.replace(/\\([\\`*_{}[\]()<>#!|~])/g, "$1");
}

function paragraphContent(text: string, threadId?: string) {
  const parts: ReactNode[] = [];
  let start = 0;
  for (const match of text.matchAll(/\[(\d+)\]\((#startupbot-source-[^\s)]+)\)/g)) {
    const citation = parseSourceLink(match[2]!);
    if (!citation) continue;
    parts.push(plain(text.slice(start, match.index)));
    const label = "[" + match[1] + "]";
    parts.push(<Fragment key={match.index}>{threadId
      ? <SourceCitation threadId={threadId} {...citation}>{label}</SourceCitation>
      : label}</Fragment>);
    start = match.index + match[0].length;
  }
  return <>{parts}{plain(text.slice(start))}</>;
}

export function SourceAnswerText({ text, threadId }: { text: string; threadId?: string }) {
  return <div data-look="bot-text" className="chat-md min-w-0 space-y-2 whitespace-pre-wrap [overflow-wrap:anywhere]">
    {text.split(/\n\s*\n/).map((paragraph, index) => <p key={index} dir="auto">{paragraphContent(paragraph, threadId)}</p>)}
  </div>;
}
