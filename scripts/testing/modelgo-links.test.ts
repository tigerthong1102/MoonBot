import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MODELGO_URL } from "../../shared/modelgo.ts";
import { CREDENTIAL_TARGETS } from "../../shared/credential-request.ts";
import { ModelgoDriver } from "../../server/drivers/modelgo.ts";

const ROOT = new URL("../../", import.meta.url);
const API_BASE = "https://api.modelgo.ai/v1";
const MENTION = /(?:https?:\/\/)?(?:[\w-]+\.)*modelgo\.ai[^\s"'`)\]<>]*/gi;
const lines = (file: string) => readFileSync(new URL(file, ROOT), "utf8").split("\n");
const isComment = (line: string) => /^\s*(?:\/\/|\/?\*)/.test(line) || /^\s*\/\*\*.*\*\/\s*$/.test(line);
const files = (...paths: string[]) => execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", ...paths], { cwd: ROOT, encoding: "utf8" })
  .split("\n").filter((file) => /\.(ts|tsx|mjs|json)$/.test(file) && !file.includes(".test."));
const mentions = (file: string) => lines(file).filter((line) => !isComment(line)).flatMap((line) => line.match(MENTION) ?? []);
function treeMentions(...paths: string[]): Array<[string, string]> {
  const searched = spawnSync("git", ["grep", "-n", "-I", "-i", "-E", "modelgo[.]ai", "--", ...paths], { cwd: ROOT, encoding: "utf8" });
  if (searched.error) throw searched.error;
  if (searched.status !== 0 && searched.status !== 1) throw new Error(searched.stderr || "git grep failed");
  const tracked = searched.stdout.split("\n").flatMap((entry) => {
    const first = entry.indexOf(":");
    const second = entry.indexOf(":", first + 1);
    if (first < 0 || second < 0) return [];
    const file = entry.slice(0, first);
    const line = entry.slice(second + 1);
    if (!/\.(ts|tsx|mjs|json)$/.test(file) || file.includes(".test.") || isComment(line)) return [];
    return (line.match(MENTION) ?? []).map((mention) => [file, mention] as [string, string]);
  });
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", ...paths], { cwd: ROOT, encoding: "utf8" })
    .split("\n").filter((file) => /\.(ts|tsx|mjs|json)$/.test(file) && !file.includes(".test."));
  return [...tracked, ...untracked.flatMap((file) => mentions(file).map((mention) => [file, mention] as [string, string]))];
}

describe("links to ModelGo's site", () => {
  it("uses the provider address without upstream sponsorship tracking", () => {
    expect(MODELGO_URL).toBe("https://modelgo.ai/");
  });

  it("is the only ModelGo address anywhere in src/, shared/ and the phone protocol", () => {
    const found = files("src", "shared", "packages/phone-protocol/src").flatMap((file) => mentions(file).map((mention) => [file, mention]));
    expect(found.filter(([, mention]) => mention !== MODELGO_URL)).toEqual([]);
    expect(found.map(([file]) => file)).toEqual(["packages/phone-protocol/src/modelgo.ts"]);
  });

  it("is the only link the driver and the secret card offer; the server otherwise names only the API base", () => {
    expect(ModelgoDriver.install?.docsUrl).toBe(MODELGO_URL);
    expect(CREDENTIAL_TARGETS.modelgoApiKey.helpUrl).toBe(MODELGO_URL);
    const found = treeMentions("server");
    expect(found.filter(([, mention]) => mention !== API_BASE)).toEqual([]);
  });
});
