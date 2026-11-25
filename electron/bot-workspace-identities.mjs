import { createHash } from "node:crypto";
import { join } from "node:path";
import { createBotIdentityStore } from "./bot-identity-store.mjs";
import { createBotPublicIdentityStore } from "./bot-public-identity-store.mjs";

export function createBotWorkspaceIdentities({ workspaceId, namespace = workspaceId, publicDirectory, privateDirectory, encryption, current }) {
  if (typeof workspaceId !== "string" || !workspaceId || workspaceId.length > 512) throw new Error("identity_state_unavailable");
  if (typeof namespace !== "string" || !namespace || namespace.length > 512) throw new Error("identity_state_unavailable");
  const key = createHash("sha256").update(JSON.stringify(["startupbot-workspace-identity-v1", namespace]), "utf8").digest("hex");
  const privateStore = createBotIdentityStore({ directory: join(privateDirectory, key), encryption });
  const publicStore = createBotPublicIdentityStore({ directory: publicDirectory, workspaceId: namespace, current: scope => current({ ...scope, workspaceId }) });
  const publicScope = scope => {
    if (scope?.workspaceId !== workspaceId || current(scope) !== true) throw new Error("target_changed");
    return { ...scope, workspaceId: namespace };
  };
  return {
    identityStoreFor: async scope => {
      if (scope?.workspaceId !== workspaceId || current(scope) !== true) throw new Error("target_changed");
      return privateStore;
    },
    loadIdentity: scope => publicStore.load(publicScope(scope)),
    commitIdentity: (scope, expected, identity) => publicStore.commit(publicScope(scope), expected, identity),
  };
}
