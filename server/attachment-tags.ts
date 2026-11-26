import { fromMarkdown } from "mdast-util-from-markdown";
import { decodeAttachmentAttribute } from "./message-file.ts";

type MarkdownNode = {
  type: string;
  children?: MarkdownNode[];
  value?: string;
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
};

export type TagCandidate = { start: number; end: number; kind: "image" | "file"; path: string };

const ATTACHMENT_TAG =
  /^<attached-(image|file)[\t ]+path="([^"\r\n]*)"(?:[\t ]+name="([^"\r\n]*)")?[\t ]*\/>$/;

function walk(node: MarkdownNode, visit: (node: MarkdownNode) => void): void {
  const pending = [node];
  while (pending.length > 0) {
    const current = pending.pop()!;
    visit(current);
    const children = current.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]!);
  }
}

/** Standalone tags only: prose that contains a tag literal must not become an attachment capability. */
export function attachmentTagCandidates(text: string): TagCandidate[] {
  const candidates: TagCandidate[] = [];
  walk(fromMarkdown(text) as MarkdownNode, (node) => {
    if (node.type !== "html" || !node.value || !node.position) return;
    const start = node.position.start.offset;
    const end = node.position.end.offset;
    if (start === undefined || end === undefined) return;
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const nextLine = text.indexOf("\n", end);
    const lineEnd = nextLine < 0 ? text.length : nextLine;
    if (text.slice(lineStart, start).trim() || text.slice(end, lineEnd).trim()) return;
    const match = ATTACHMENT_TAG.exec(node.value);
    if (!match) return;
    candidates.push({ start, end, kind: match[1] === "file" ? "file" : "image", path: decodeAttachmentAttribute(match[2]!) });
  });
  return candidates;
}
