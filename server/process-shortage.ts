import { engineFailureKind } from "./drivers/engine-errors.ts";
import { classifyError } from "./drivers/retry.ts";
import { hostFaultOf } from "./host-fault.ts";

/** spawn(2)/fork(2) failures that mean "no room now": EAGAIN (the pids limit or RLIMIT_NPROC), EMFILE and ENFILE (open
 * files), ENOMEM. */
const SHORTAGE_CODES: ReadonlySet<string> = new Set(["EAGAIN", "EMFILE", "ENFILE", "ENOMEM"]);
export type ShortageCode = "EAGAIN" | "EMFILE" | "ENFILE" | "ENOMEM";

export function shortageCode(error: unknown): ShortageCode | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && SHORTAGE_CODES.has(code) ? (code as ShortageCode) : null;
}

const NO_ROOM_NOTICE = /^There is no room to start another program \((?:EAGAIN|EMFILE|ENFILE|ENOMEM)\)/;
const SPAWN_REFUSED = /^(?:Error: )?(?:spawn failed: )?(?:posix_)?spawn(?:Sync)?\b[^\n]*\b(?:EAGAIN|EMFILE|ENFILE|ENOMEM)\b/;

export const outOfProcesses = (cause: string): boolean => NO_ROOM_NOTICE.test(cause) || SPAWN_REFUSED.test(cause);

const OWN_CAUSES: ReadonlySet<string> = new Set(["auth", "quota", "unknown_model", "provider_safety"]);

export function namesOwnCause(failure: string): boolean {
  if (engineFailureKind(failure) !== null || OWN_CAUSES.has(classifyError({ text: failure }).reason)) return true;
  const fault = hostFaultOf(failure);
  return fault === "signed_out" || fault === "tool_server" || fault === "disk_full";
}
