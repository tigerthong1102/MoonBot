import { expect, it, vi } from "vitest";
import { BitwardenLogins } from "./bitwarden.ts";
import { linkedCandidates } from "./providers.ts";
import type { RouteContext } from "../routes/table.ts";

it("checks the actor, the exact form host, sharing bots and grant revocation during a fill", async () => {
  const id = "64d9d34d-a179-42bb-a745-3703b313240f", session = "synthetic-session";
  const item = { id, type: 1 as const, login: { username: "fixture", password: "synthetic-password", uris: [{ uri: "https://example.com/login" }] } };
  const get = vi.fn(async () => item);
  const provider = new BitwardenLogins("/bin/fake", get), route = provider.routes(id => id === "a");
  const request = async (method: string, body: object, admin = true) => {
    const json = vi.fn();
    await route({ req: { headers: { "content-type": "application/json" } }, res: { setHeader() {} },
      auth: { kind: "loopback", scopes: admin ? ["admin"] : ["client"] }, method, path: "/api/vault/bitwarden",
      json, readBody: async () => body } as unknown as RouteContext);
    return json.mock.calls[0]!.slice(1);
  };
  const grant = { item: id, session, host: "example.com", bots: ["a"] };
  expect((await request("POST", grant, false))[0]).toBe(403);
  expect(get).not.toHaveBeenCalled();
  expect((await request("POST", grant))[0]).toBe(200);
  expect(JSON.stringify(await request("GET", {}))).not.toContain("synthetic-");
  expect(linkedCandidates(provider, "other.example.com", "a")).toEqual([]);
  expect(linkedCandidates(provider, "example.com", ["a","b"])).toEqual([]);
  const candidate = linkedCandidates(provider, "example.com", "a")[0]!;
  expect((await candidate.secrets()).password).toBe(item.login.password);
  get.mockImplementationOnce(async () => { await request("DELETE", { item: id }); return item; });
  await expect(candidate.secrets()).rejects.toThrow(/changed/);
  expect(provider.items()).toEqual([]);
  expect((await request("POST", { ...grant, host: "other.example.com" }))[0]).toBe(422);
});
