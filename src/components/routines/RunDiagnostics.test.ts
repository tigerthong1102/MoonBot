// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { RunDiagnostics, runDiagnostics } from "./RunDiagnostics";
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
it("keeps an unconfirmed delivery distinct from a completed calculation", () => {
  const exported = runDiagnostics({ ...run, status: "completed",
    emailDeliveries: [{ destination: "private@customer.test", messageId: "private", state: "unconfirmed", at: 21 }] });
  expect(exported).toMatchObject({ status: "completed", layer: "delivery", email: [{ state: "unconfirmed", at: 21 }] });
  expect(JSON.stringify(exported)).not.toContain("private");
});

it("opens and closes the linked diagnostics panel and its download", () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  try {
    flushSync(() => root.render(createElement(RunDiagnostics, { run })));
    const toggle = host.querySelector<HTMLButtonElement>("button[aria-controls]")!;
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(panel.querySelector("a[download]")).not.toBeNull();
    expect(panel.hidden).toBe(true);
    for (const expanded of [true, false]) {
      flushSync(() => toggle.click());
      expect(toggle.getAttribute("aria-expanded")).toBe(String(expanded));
      expect(panel.hidden).toBe(!expanded);
    }
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
});
