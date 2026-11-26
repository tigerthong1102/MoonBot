import { existsSync, writeFileSync } from "node:fs";
import { TeamSetupRequestService } from "../team-setup-requests.ts";

const marker = process.env.FAKE_CLAUDE_WORK_BOT_CHOICE_MARKER;
const gate = process.env.FAKE_CLAUDE_WORK_BOT_CHOICE_GATE;
const phase = process.env.FAKE_CLAUDE_WORK_BOT_CHOICE_PHASE;
if (marker && gate && (phase === "before" || phase === "after")) {
  const original = TeamSetupRequestService.prototype.apply;
  TeamSetupRequestService.prototype.apply = async function (...args) {
    if (phase === "before") {
      writeFileSync(marker, "before");
      while (!existsSync(gate)) await new Promise(resolve => setTimeout(resolve, 20));
    }
    const result = await original.apply(this, args);
    if (phase === "after") {
      writeFileSync(marker, "after");
      while (!existsSync(gate)) await new Promise(resolve => setTimeout(resolve, 20));
    }
    return result;
  };
}
