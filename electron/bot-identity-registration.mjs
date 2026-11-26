import { createHash } from "node:crypto";

export function createBotIdentityRegistration({ identityStoreFor, loadIdentity, commitIdentity, currentAccount, validateTarget, challenge, invite }) {
  const inFlight = new Map();
  async function register({ workspaceId, localBotId, bindingId, owner, room, origin, name }) {
    const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
    if (typeof workspaceId !== "string" || !workspaceId || workspaceId.length > 512 || typeof localBotId !== "string" || !localBotId || localBotId.length > 512 || !uuid.test(bindingId) || !uuid.test(room) || typeof owner !== "string" || !owner || owner.length > 128 || typeof name !== "string" || !name.trim() || name.length > 80) throw new Error("invalid_bot_claim");
    let parsed;
    try { parsed = new URL(origin); } catch { throw new Error("invalid_bot_claim"); }
    if (parsed.protocol !== "https:" || parsed.origin !== origin) throw new Error("invalid_bot_claim");
    const scope = Object.freeze({ workspaceId, localBotId, bindingId, owner, room, origin });
    const checkOwner = async () => {
      if ((await currentAccount()) !== owner) throw new Error("account_changed");
      if (!(await validateTarget(scope))) throw new Error("target_changed");
    };
    await checkOwner();
    const identityStore = await identityStoreFor(scope);
    const loaded = await loadIdentity(scope);
    const state = loaded && { kind: loaded.kind, username: loaded.username };
    if (!state || (state.kind !== "new" && state.kind !== "existing")) throw new Error("identity_state_unavailable");
    const found = await identityStore.identity(localBotId, state);
    const identity = { username: found.username, publicKey: found.publicKey };
    if (!/^[a-f0-9]{64}$/.test(identity.publicKey ?? "") || identity.username !== `bot_k${createHash("sha256").update(Buffer.from(identity.publicKey, "hex")).digest("hex")}` || (state.kind === "existing" && state.username !== identity.username)) throw new Error("identity_changed");
    await checkOwner();
    const saved = await commitIdentity(scope, state, identity);
    const committed = saved && { kind: saved.kind, username: saved.username };
    if (!committed || committed.kind !== "existing" || committed.username !== identity.username) throw new Error("identity_changed");
    await checkOwner();
    const { nonce } = await challenge({ owner, bot: bindingId, room });
    if (!uuid.test(nonce)) throw new Error("invalid_bot_claim");
    const signed = await identityStore.signClaim(localBotId, committed, { origin, owner, bot: bindingId, room, nonce });
    if (signed.username !== committed.username || signed.publicKey !== identity.publicKey || !/^[a-f0-9]{128}$/.test(signed.signature ?? "")) throw new Error("identity_changed");
    await checkOwner();
    await invite({ action: "invite", owner, bot: bindingId, room, name, username: signed.username,
      proof: { nonce, publicKey: signed.publicKey, signature: signed.signature } });
    return { username: signed.username };
  }
  return {
    register(input) {
      const key = JSON.stringify([input.workspaceId, input.origin, input.owner, input.localBotId, input.bindingId, input.room]);
      const existing = inFlight.get(key);
      if (existing) return existing;
      const pending = register({ ...input }).finally(() => { if (inFlight.get(key) === pending) inFlight.delete(key); });
      inFlight.set(key, pending);
      return pending;
    },
  };
}
