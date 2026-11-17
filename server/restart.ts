// The exit code a server uses to ask its launcher for a fresh start (after a restore commits).
export const RESTART_EXIT_CODE = 75;
export const CRASH_EXIT_CODE = 70;
export const MAX_RESTARTS = 5;
export const STABLE_RUN_MS = 60_000;
export const CRASH_BACKOFF_MS = [1_000, 2_000, 5_000, 15_000, 30_000] as const;

/** Killed by the system rather than asked to stop: out of memory (SIGKILL, SIGABRT), or a fault. Shells and
 * containers report these as 128 + the signal's number. */
const CRASH_SIGNALS = new Set(["SIGKILL", "SIGABRT", "SIGSEGV", "SIGBUS", "SIGILL", "SIGFPE"]);
const CRASH_CODES = new Set([CRASH_EXIT_CODE, 134, 135, 136, 137, 139]);

export const crashed = (code: number | null, signal?: NodeJS.Signals | null): boolean =>
  code === null ? Boolean(signal && CRASH_SIGNALS.has(signal)) : CRASH_CODES.has(code);

export function restartPolicy(now: () => number = Date.now) {
  let restarts = 0, crashes = 0, startedAt = now(), delay = 0;
  return {
    again(code: number | null, stopping = false, signal?: NodeJS.Signals | null): boolean {
      if (now() - startedAt >= STABLE_RUN_MS) { restarts = 0; crashes = 0; }
      delay = 0;
      if (stopping) return false;
      if (code === RESTART_EXIT_CODE) {
        if (restarts >= MAX_RESTARTS) return false;
        restarts++;
      } else if (crashed(code, signal)) {
        if (crashes >= CRASH_BACKOFF_MS.length) return false;
        delay = CRASH_BACKOFF_MS[crashes++]!;
      } else return false;
      startedAt = now() + delay;
      return true;
    },
    delayMs: (): number => delay,
  };
}

export const restartLine = (code: number | null, delayMs: number): string => code === RESTART_EXIT_CODE
  ? "OpenMausBot is starting again to finish installing a copy from the desktop app…"
  : `OpenMausBot stopped unexpectedly (${code ?? "killed"}); starting it again in ${Math.round(delayMs / 1000)} s…`;
