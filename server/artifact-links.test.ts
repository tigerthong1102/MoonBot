import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { ArtifactLinks } from "./artifact-links.ts";
import type { RequestAuth } from "./request-auth.ts";
import type { SessionRecord } from "./sessions.ts";

const session = (id: string): RequestAuth => ({ kind: "session", session: { id } as SessionRecord, via: "cookie", scopes: ["client"] });

it("expires a conversation attachment link and allows only its issuer to revoke it", () => {
  let now = 10;
  const links = new ArtifactLinks(() => now);
  const get = () => links.issue("a", "m", "/work/report.md", session("owner"));
  const first = get();
  expect(get()).toEqual(first);
  expect(links.read(first.id, "b", "m")).toBeNull();
  links.revoke(first.id, "a", "m", session("reader"));
  expect(links.read(first.id, "a", "m")).toBe("/work/report.md");
  links.revoke(first.id, "a", "m", session("owner"));
  expect(links.read(first.id, "a", "m")).toBeNull();
  const second = get();
  expect(second.id).not.toBe(first.id);
  now = second.expiresAt;
  expect(links.read(second.id, "a", "m")).toBeNull();
});


it("keeps scoped grants through restart and shares revocation with other server processes", () => {
  const dir = mkdtempSync(join(tmpdir(), "startupbot-artifacts-"));
  const file = join(dir, "links.sqlite");
  const first = new ArtifactLinks(Date.now,file), second = new ArtifactLinks(Date.now,file);
  try {
    const link = first.issue("thread","message","report.md",session("owner"));
    first.close();
    expect(second.issue("thread","message","report.md",session("owner"))).toEqual(link);
    second.revoke(link.id,"thread","message",session("reader"));
    expect(first.read(link.id,"thread","message")).toBe("report.md");
    second.revoke(link.id,"thread","message",session("owner"));
    expect(first.read(link.id,"thread","message")).toBeNull();
  } finally { first.close(); second.close(); rmSync(dir,{recursive:true,force:true}); }
});
