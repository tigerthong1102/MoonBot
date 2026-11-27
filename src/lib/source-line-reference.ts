export interface SourceLineReference {
  threadId: string;
  messageId: string;
  path: string;
  name: string;
  start: number;
  end: number;
  sha256: string;
}

export function isSourceLineReference(raw: unknown): raw is SourceLineReference {
  if (!raw || typeof raw !== "object") return false;
  const ref = raw as Record<string, unknown>;
  return ["threadId", "messageId", "path", "name"].every(key => typeof ref[key] === "string" && ref[key].length > 0 && ref[key].length <= 8192)
    && typeof ref.start === "number" && Number.isSafeInteger(ref.start) && ref.start >= 1
    && typeof ref.end === "number" && Number.isSafeInteger(ref.end) && ref.end >= ref.start && ref.end - ref.start < 120
    && typeof ref.sha256 === "string" && /^[a-f0-9]{64}$/.test(ref.sha256);
}

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
