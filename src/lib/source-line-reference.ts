import { isSourceLineReference, type SourceLineReference } from "../../shared/source-line-reference.ts";
export type { SourceLineReference } from "../../shared/source-line-reference.ts";

export async function fetchSourceLines(ref: Omit<SourceLineReference, "sha256"> & { sha256?: string }, threadId: string) {
  if (ref.threadId !== threadId) throw new Error("Choose a file in the current conversation.");
  const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(ref.messageId)}/file`, {
    method: "POST", cache: "no-store", headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: ref.path, sourceLines: { start: ref.start, end: ref.end, sha256: ref.sha256 } }),
  });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "The source file is unavailable.");
  if (typeof result.text !== "string" || !isSourceLineReference({ ...ref, sha256: result.sha256 }) || (ref.sha256 && result.sha256 !== ref.sha256)) throw new Error("The source revision is unavailable.");
  return { text: result.text as string, sha256: result.sha256 as string };
}
