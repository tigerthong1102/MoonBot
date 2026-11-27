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
