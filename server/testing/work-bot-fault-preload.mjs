import { existsSync, writeFileSync } from "node:fs";
import { Store } from "../store.ts";

const method = process.env.FAKE_CLAUDE_WORK_BOT_FAULT_METHOD;
const marker = process.env.FAKE_CLAUDE_WORK_BOT_FAULT_MARKER;
if (marker && (method === "setTaskAskedAt" || method === "setTaskActivity")) {
  const original = Store.prototype[method];
  Store.prototype[method] = function (botId, threadId, ...rest) {
    const ownsRequest = this.messagesFor(threadId).some(message => message.workBotRecoveryPending || message.workBotRouting?.state === "dispatching");
    if (process.env.FAKE_CLAUDE_WORK_BOT_CLEANUP_FAIL === "1" && method === "setTaskActivity" && rest[0] === "idle" && existsSync(marker) && ownsRequest) {
      throw new Error("synthetic cleanup failure");
    }
    if (!existsSync(marker) && ownsRequest) {
      if (process.env.FAKE_CLAUDE_WORK_BOT_CLEANUP_FAIL === "1" && method === "setTaskActivity") original.call(this, botId, threadId, ...rest);
      writeFileSync(marker, method);
      if (process.env.FAKE_CLAUDE_WORK_BOT_FAULT_CRASH === "1") process.kill(process.pid, "SIGKILL");
      throw new Error("synthetic work-bot setup failure");
    }
    return original.call(this, botId, threadId, ...rest);
  };
}

const recoveryMarker = process.env.FAKE_CLAUDE_WORK_BOT_FAULT_RECOVERY;
if (recoveryMarker) {
  const original = Store.prototype.patchMessage;
  Store.prototype.patchMessage = function (threadId, messageId, patch) {
    if (patch.workBotExecutionUncertain && !existsSync(recoveryMarker)) {
      writeFileSync(recoveryMarker, "failed");
      throw new Error("synthetic recovery persistence failure");
    }
    return original.call(this, threadId, messageId, patch);
  };
}
