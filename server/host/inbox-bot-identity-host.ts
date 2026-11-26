import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { createBotWorkspaceIdHost } from "../bot-workspace-id-host.ts";
import type { WorkspaceBackupMaintenance } from "../workspace-backup-maintenance.ts";

export function createInboxBotIdentityHost(options: {
  directory: string; maintenance: WorkspaceBackupMaintenance; bots(): ReadonlyArray<object>;
  token(): string | undefined; assertTurns(): void;
  setIdentity(id: string, identity: { username: string; publicKey: string }): unknown;
}) {
  const workspace = createBotWorkspaceIdHost(options);
  return {
    workspaceId: () => workspace.loadOrCreate(),
    identityOwner: (req: IncomingMessage) => {
      if (req.headers.origin || req.headers["sec-fetch-site"]) return false;
      const supplied = Buffer.from(String(req.headers["x-openmausbot-desktop-owner"] ?? "")), expected = Buffer.from(options.token() ?? "");
      return expected.length >= 32 && supplied.length === expected.length && timingSafeEqual(supplied, expected);
    },
    acquireWorkspace: (workspaceId: string) => {
      options.assertTurns();
      const release = options.maintenance.request();
      try { if (workspace.loadOrCreate() === workspaceId) return release; }
      catch (error) { release(); throw error; }
      release(); return null;
    },
    saveIdentity: (id: string, workspaceId: string, identity: { username: string; publicKey: string }) => {
      options.assertTurns();
      const release = options.maintenance.request();
      try { return workspace.loadOrCreate() === workspaceId && Boolean(options.setIdentity(id, identity)); }
      finally { release(); }
    },
  };
}
