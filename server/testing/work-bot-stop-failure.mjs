import { existsSync, rmSync } from "node:fs";
import { Store } from "../store.ts";

const marker = process.env.FAKE_CLAUDE_STOP_REWIND_FAILURE;
if (marker) {
  const original = Store.prototype.patchTask;
  Store.prototype.patchTask = function (botId, threadId, patch, ...rest) {
    if (patch?.rewound === true && existsSync(marker)) {
      rmSync(marker);
      throw new Error("Synthetic registry write failure");
    }
    return original.call(this, botId, threadId, patch, ...rest);
  };
}

const messageMarker = process.env.FAKE_CLAUDE_STOP_MESSAGE_FAILURE;
if (messageMarker) {
  const original = Store.prototype.patchMessage;
  Store.prototype.patchMessage = function (threadId, messageId, patch, ...rest) {
    if (patch?.requestCancelled === true && existsSync(messageMarker)) {
      rmSync(messageMarker);
      throw new Error("Synthetic message write failure");
    }
    return original.call(this, threadId, messageId, patch, ...rest);
  };
}
