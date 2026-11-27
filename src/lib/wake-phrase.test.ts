import { afterEach, expect, it, vi } from "vitest";
import { createPhraseDetector, listenForWakePhrase } from "./wake-phrase";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("requires two matching enrollments and ignores different words and long ambient speech", () => {
  const events: string[] = [];
  const detect = createPhraseDetector(state => events.push(state), () => events.push("wake"));
  const say = (syllables: number[]) => {
    for (const syllable of syllables) for (let i = 0; i < 10; i++) detect(() => Float32Array.from({ length: 24 }, (_, n) => Number(n === syllable)), 0.05);
    for (let i = 0; i < 12; i++) detect(() => new Float32Array(24), 0);
  };
  say([1, 2, 3]); say([4, 5, 6]);
  expect(events).toEqual(["repeat", "mismatch"]);
  say([1, 2, 3]); say([1, 2, 3]); say([2, 3, 6]); say(Array.from({ length: 15 }, () => 1));
  expect(events.at(-1)).toBe("listening");
  say([1, 2, 3]); expect(events.at(-1)).toBe("wake");
});
it("releases the microphone when a permission prompt resolves after cancellation", async () => {
  const stop = vi.fn();
  let answer!: (stream: MediaStream) => void;
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => new Promise(resolve => { answer = resolve; }) } });
  const controller = new AbortController(), state = vi.fn(), wake = vi.fn();
  const pending = listenForWakePhrase(controller.signal, state, wake, vi.fn());
  controller.abort(); answer({ getTracks: () => [{ stop }] } as unknown as MediaStream);
  await pending; expect(stop).toHaveBeenCalledOnce(); expect(state).not.toHaveBeenCalled(); expect(wake).not.toHaveBeenCalled();
});
