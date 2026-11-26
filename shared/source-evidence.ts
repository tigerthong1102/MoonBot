/** Identifies a passage in the signed-in viewer's local document index. Excerpts are never chat commands. */
export interface SourceEvidence {
  path: string; digest: string; start: number; page: number; paragraph: number; text: string;
}

export function encodedSourcePath(path: string) {
  return encodeURIComponent(path).replace(/[!'()*]/g, char => "%" + char.charCodeAt(0).toString(16));
}

export function sourceLink(digest: string, start: number, path: string) {
  return "#startupbot-source-" + digest + "-" + start + "/" + encodedSourcePath(path);
}

/** Released clients serialized retrieval as numbered source links followed by literal excerpts in an ordinary send. */
export function legacySourceRequest(text: string): boolean {
  return /\n\n\[1\]\(#startupbot-source-[a-f0-9]{64}-\d{1,9}\/[^\s)#]+\) · [^\n]+\n[\s\S]/u.test(text);
}
