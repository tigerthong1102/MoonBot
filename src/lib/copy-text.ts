import { useCallback, useEffect, useRef, useState } from "react";

import { copyText, type CopyResult } from "./clipboard-write";

export { copyText, WEB_WRITE_TIMEOUT_MS, type CopyResult } from "./clipboard-write";
export type CopyFeedback = "idle" | "copied" | "failed";

export const COPY_FEEDBACK_MS = 1200;

interface CopyFeedbackOptions {
  copy: (text: string) => Promise<CopyResult>;
  onChange: (state: CopyFeedback) => void;
  resetMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export function createCopyFeedback({
  copy,
  onChange,
  resetMs = COPY_FEEDBACK_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: CopyFeedbackOptions) {
  let pending = false;
  let disposed = false;
  let timer: unknown;

  const clear = () => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  };

  return {
    async click(text: string): Promise<CopyResult | "busy"> {
      if (pending) return "busy";
      pending = true;
      let result: CopyResult;
      try {
        result = await copy(text);
      } catch {
        result = "failed";
      } finally {
        pending = false;
      }
      if (disposed || result === "empty") return result;
      clear();
      onChange(result === "copied" ? "copied" : "failed");
      timer = setTimer(() => {
        timer = undefined;
        onChange("idle");
      }, resetMs);
      return result;
    },
    dispose() {
      disposed = true;
      clear();
    },
  };
}

export function useCopyFeedback(text: string, write: (text: string) => Promise<CopyResult> = copyText) {
  const [state, setState] = useState<CopyFeedback>("idle");
  const controller = useRef<ReturnType<typeof createCopyFeedback> | null>(null);
  useEffect(() => {
    const next = createCopyFeedback({ copy: write, onChange: setState });
    controller.current = next;
    return () => {
      next.dispose();
      controller.current = null;
    };
  }, [write]);
  const copy = useCallback(() => void controller.current?.click(text), [text]);
  return { state, copy };
}
