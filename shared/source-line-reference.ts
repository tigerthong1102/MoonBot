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
