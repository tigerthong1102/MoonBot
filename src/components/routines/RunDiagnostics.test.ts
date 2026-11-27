import { expect, it } from "vitest";
import { runDiagnostics } from "./RunDiagnostics";
import type { RoutineRun } from "@/lib/routines";

const run: RoutineRun = { id: "run-1", routineId: "routine", botId: "bot", runOn: "maus",
  target: "bot", routineName: "private", prompt: "private", error: "private", output: "private",
  errorParams: { name: "private" }, repairApp: "private", status: "failed", manual: false, scheduledFor: 17, createdAt: 18 };
it.each([["computer", "host"], ["connection", "connector"], ["model", "engine"]] as const)(
  "exports only structured evidence for %s", (blockedBy, layer) => {
    const value = runDiagnostics({ ...run, blockedBy });
    expect(value).toMatchObject({ runId: run.id, layer, scheduledFor: 17 });
    expect(JSON.stringify(value)).not.toContain("private");
  });
