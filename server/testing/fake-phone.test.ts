import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { afterEach, expect, it, vi } from "vitest";
import { fakePhone } from "./fake-phone.ts";

vi.mock("node:fs", async (original) => ({
  ...await original<typeof import("node:fs")>(),
  watch: vi.fn(() => ({ close() {} })),
}));

const folders: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

it("observes complete control bytes when filesystem change notifications are unavailable", async () => {
  const home = mkdtempSync(join(tmpdir(), "omb-phone-control-"));
  folders.push(home);
  const phone = fakePhone({ under: home });
  const received = phone.control(2);
  writeFileSync(join(phone.dir, "control.hex"), "aa");
  const finish = setTimeout(() => writeFileSync(join(phone.dir, "control.hex"), "aabb"), 30);
  try {
    expect(await received).toBe("aabb");
  } finally {
    clearTimeout(finish);
  }
}, 2_000);

it("bounds a missing control write and reports the expected and received byte counts", async () => {
  const home = mkdtempSync(join(tmpdir(), "omb-phone-control-"));
  folders.push(home);
  const phone = fakePhone({ under: home });
  writeFileSync(join(phone.dir, "control.hex"), "aa");
  await expect(phone.control(2, 50)).rejects.toThrow("expected 2 control bytes, received 1");
}, 2_000);

it("observes real phone IO while the hold timeout clock is paused", async () => {
  const home = mkdtempSync(join(tmpdir(), "omb-phone-control-"));
  folders.push(home);
  const phone = fakePhone({ under: home });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const written = wait(30).then(() => writeFileSync(join(phone.dir, "control.hex"), "aabb"));
  expect(await phone.control(2)).toBe("aabb");
  expect(vi.isFakeTimers()).toBe(true);
  await written;
}, 2_000);
