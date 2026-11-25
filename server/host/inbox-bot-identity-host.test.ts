import type { IncomingMessage } from "node:http";
import { expect, it } from "vitest";
import { WorkspaceBackupMaintenance } from "../workspace-backup-maintenance.ts";
import { createInboxBotIdentityHost } from "./inbox-bot-identity-host.ts";

it("only accepts a native desktop capability for identity anchoring", () => {
  const token = "fixture-owner-token-".repeat(3);
  const host = createInboxBotIdentityHost({ directory: "/fixture", maintenance: new WorkspaceBackupMaintenance(), bots: () => [], token: () => token, assertTurns: () => {}, setIdentity: () => true });
  const request = (headers: Record<string, string>) => ({ headers }) as IncomingMessage;
  expect(host.identityOwner(request({}))).toBe(false);
  expect(host.identityOwner(request({ "x-openmausbot-desktop-owner": "wrong" }))).toBe(false);
  expect(host.identityOwner(request({ "x-openmausbot-desktop-owner": token, origin: "http://127.0.0.1" }))).toBe(false);
  expect(host.identityOwner(request({ "x-openmausbot-desktop-owner": token, "sec-fetch-site": "same-origin" }))).toBe(false);
  expect(host.identityOwner(request({ "x-openmausbot-desktop-owner": token }))).toBe(true);
});
