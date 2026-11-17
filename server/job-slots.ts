export interface SlotOptions {
  signal?: AbortSignal;
  urgent?: () => boolean;
  interactive?: boolean;
  onWait?: () => void;
}

export interface JobSlots {
  run<T>(job: () => Promise<T>, options?: SlotOptions): Promise<T>;
  readonly limit: number;
  readonly running: number;
  readonly waiting: number;
}

export function createJobSlots(limit: number): JobSlots {
  let running = 0;
  const waiting: Array<{ start: () => void; interactive: boolean }> = [];
  const release = () => {
    running -= 1;
    if (running < limit) {
      const next = waiting.shift();
      if (next) { running += 1; next.start(); }
    }
  };
  const slot = ({ signal, urgent, interactive = false, onWait }: SlotOptions): Promise<void> => {
    signal?.throwIfAborted();
    if (running < limit || urgent?.()) {
      running += 1;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      let poll: ReturnType<typeof setInterval> | undefined;
      const unwait = () => {
        clearInterval(poll);
        signal?.removeEventListener("abort", leave);
        const at = waiting.indexOf(entry);
        if (at >= 0) waiting.splice(at, 1);
      };
      const entry = { interactive, start: () => { unwait(); resolve(); } };
      const leave = () => {
        unwait();
        reject(signal!.reason instanceof Error ? signal!.reason : new Error("stopped while waiting for a free slot"));
      };
      const behind = interactive ? waiting.findIndex((other) => !other.interactive) : -1;
      waiting.splice(behind < 0 ? waiting.length : behind, 0, entry);
      signal?.addEventListener("abort", leave, { once: true });
      if (urgent) {
        poll = setInterval(() => {
          if (!urgent()) return;
          unwait();
          running += 1;
          resolve();
        }, 250);
        poll.unref?.();
      }
      onWait?.();
    });
  };
  return {
    async run(job, options = {}) {
      await slot(options);
      try {
        return await job();
      } finally {
        release();
      }
    },
    limit,
    get running() { return running; },
    get waiting() { return waiting.length; },
  };
}

export function slotLimit(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isInteger(parsed) && parsed >= 1 && parsed <= 64 ? parsed : fallback;
}

/** OMB_BACKGROUND_TEXT_MAX sets the concurrency of background text calls across all bots. */
export const backgroundTextSlots = createJobSlots(slotLimit(process.env.OMB_BACKGROUND_TEXT_MAX, 3));

/** OMB_CHECKPOINT_GIT_MAX sets checkpoint git concurrency. */
export const checkpointGitSlots = createJobSlots(slotLimit(process.env.OMB_CHECKPOINT_GIT_MAX, 4));
