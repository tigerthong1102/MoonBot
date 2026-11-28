import { createHash, randomUUID, sign } from "node:crypto";
import { generatedGrantMessage, generatedPostMessage, generatedRenewalMessage, generatedRoomLimit, generatedRoomKinds } from "./twin-generated-message.mjs";

const unavailable = () => Error("generated_reply_unavailable");
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

function sameProvider(a, b) {
  return a && b && ["key", "name", "model", "destination"].every(k => typeof a[k] === "string" && a[k] && a[k] === b[k]);
}

export async function recoverGenerated({ journal, origin, inbox, keep }) {
  const me = await inbox("me");
  for (const ref of journal.list(me.id, origin)) {
    if (ref.id === keep?.()) continue;
    const receipt = await inbox("twin-generated", { action: "revoke", owner: ref.owner, id: ref.id });
    if (receipt.id !== ref.id || receipt.revoked !== true) throw unavailable();
    journal.remove(ref);
  }
  return me;
}

export async function generatedStatus(inbox, me, localId) {
  if (!me.generatedAnswer) return { available: false };
  const { owner, grant, now } = await inbox("twin-generated");
  if (me.id !== owner) throw unavailable();
  return { available: true, owner, local: Boolean(grant && grant.id === localId),
    remote: grant ? { id: grant.id, enabled: grant.enabled, expires: grant.expires, count: grant.count, ...(grant.dailyLimit !== undefined && { dailyLimit: grant.dailyLimit, authorizedUntil: grant.authorizedUntil, leaseActive: Number.isSafeInteger(now) && grant.expires > now }) } : null };
}

export function createOnlineGenerated({ state, check, checkOnline, profile, generate, inbox, approve, journal, origin, monotonic = () => performance.now() }) {
  let active, busy = false, epoch = 0;
  function reset() {
    epoch++;
    active?.abort.abort();
    active = undefined;
  }
  const recover = () => recoverGenerated({ journal, inbox, origin, keep: () => active?.grant.id });
  async function provider(key, renew = false) {
    await (renew ? checkOnline(key) : check(key));
    const view = await profile();
    if (state() !== key || view.twin?.id !== key.twin || view.twin.revision !== key.revision || view.twin.paused ||
        !sameProvider(view.provider, view.provider)) throw unavailable();
    return view.provider;
  }
  async function choices() {
    const key = state();
    if (!key?.key) throw unavailable();
    const [selected, account] = await Promise.all([provider(key), inbox("twin-generated?rooms=1")]);
    if (state() !== key || account.owner !== key.owner || !Array.isArray(account.rooms)) throw unavailable();
    return { provider: selected, rooms: account.rooms };
  }
  async function offer(expected, refs, dailyLimit) {
    if (dailyLimit !== undefined && (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 720 || !checkOnline)) throw unavailable();
    if (!approve || !journal || busy || active || !Array.isArray(refs) || !refs.length || refs.length > generatedRoomLimit ||
        new Set(refs).size !== refs.length || refs.includes("*")) throw unavailable();
    const key = state(), version = epoch;
    busy = true;
    try {
      await recover();
      const selected = await choices();
      if (state() !== key || version !== epoch || !sameProvider(expected, selected.provider)) throw unavailable();
      const rooms = [...refs].sort();
      const kinds = generatedRoomKinds(rooms);
      const chosen = kinds.length ? [] : rooms.map(ref => selected.rooms.find(room => room.ref === ref && room.title && room.id));
      if (chosen.some(room => !room)) throw unavailable();
      const grant = { id: randomUUID(), owner: key.owner, pairing: key.id, origin, twin: key.twin, revision: key.revision,
        provider: { ...selected.provider }, rooms, expires: key.expires, ...(dailyLimit !== undefined && { dailyLimit }) };
      if (!await approve({ grant, chosen, kinds })) return false;
      if (!sameProvider(grant.provider, await provider(key)) || epoch !== version) throw unavailable();
      const signature = sign(null, Buffer.from(generatedGrantMessage(grant)), key.key).toString("hex");
      journal.add(grant);
      const session = { grant, key, kinds, roomIds: new Set(chosen.map(room => room.id)), used: new Map(), expires: key.expires, deadline: key.deadline, abort: new AbortController() };
      active = session;
      try {
        const result = await inbox("twin-generated", { action: "offer", id: grant.id, owner: grant.owner,
          pairing: grant.pairing, provider: grant.provider, rooms, expires: grant.expires, ...(dailyLimit !== undefined && {dailyLimit}), signature });
        if (result.id !== grant.id || result.offered !== true || active !== session || state() !== key) throw unavailable();
      } catch (error) {
        reset();
        await recover().catch(() => {});
        throw error;
      }
      return true;
    } finally { busy = false; }
  }
  async function renewLease(session, post, assertCurrent) {
    const { grant, key } = session;
    const started = monotonic();
    if (session.deadline - started > 75000) return;
    const proposal = await post("lease");
    if (proposal.id !== grant.id || !Number.isSafeInteger(proposal.now) || !Number.isSafeInteger(proposal.expires) ||
        proposal.expires <= proposal.now || proposal.expires > proposal.now + 600000) throw unavailable();
    if (proposal.enabled === false && !proposal.nonce) return;
    if (!Number.isSafeInteger(proposal.authorizedUntil) || proposal.expires > proposal.authorizedUntil ||
        (session.authorizedUntil && session.authorizedUntil !== proposal.authorizedUntil)) throw unavailable();
    if (!sameProvider(grant.provider, await provider(key, true))) throw unavailable();
    assertCurrent();
    let receipt = proposal;
    if (proposal.nonce) {
      if (!uuid.test(proposal.nonce)) throw unavailable();
      const signature = sign(null, Buffer.from(generatedRenewalMessage({ ...grant, nonce: proposal.nonce, expires: proposal.expires })), key.key).toString("hex");
      receipt = await post("renew", { nonce: proposal.nonce, expires: proposal.expires, signature });
    }
    assertCurrent();
    if (receipt.id !== grant.id || receipt.expires !== proposal.expires || receipt.authorizedUntil !== proposal.authorizedUntil ||
        !Number.isSafeInteger(receipt.now) || receipt.now < proposal.now || receipt.expires <= receipt.now) throw unavailable();
    session.authorizedUntil = receipt.authorizedUntil;
    session.expires = receipt.expires;
    session.deadline = started + receipt.expires - receipt.now;
  }

  async function tick() {
    if (!active || busy) return;
    const session = active, { grant, key, abort, used } = session;
    busy = true;
    const post = (action, extra = {}) => inbox("twin-generated", { action, id: grant.id, owner: grant.owner, ...extra });
    const renew = grant.dailyLimit !== undefined;
    function assertCurrent() {
      if (active !== session || state() !== key || abort.signal.aborted) throw unavailable();
    }
    function live(deadline) {
      assertCurrent();
      if (monotonic() >= deadline) throw unavailable();
    }
    try {
      if (renew) {
        if (!sameProvider(grant.provider, await provider(key, true))) throw unavailable();
        assertCurrent();
        await renewLease(session, post, assertCurrent);
        for (const [source, at] of used) if (monotonic() - at >= 86400000) used.delete(source);
      } else {
        await check(key);
      }
      live(session.deadline);
      if (renew && (used.size >= grant.dailyLimit || [...used.values()].filter(at => monotonic() - at < 600000).length >= 5)) {
        const status = await inbox("twin-generated");
        if (status.owner !== grant.owner || status.grant?.id !== grant.id || !status.grant.enabled) throw unavailable();
        return;
      }
      const started = monotonic(), result = await post("claim"), job = result.challenge;
      if (renew && (result.revoked === true || (job && result.enabled !== true))) throw unavailable();
      if (!job) return;
      if (!Number.isSafeInteger(result.now) || !Number.isSafeInteger(job.expires) || !Number.isSafeInteger(job.source) ||
          job.source <= 0 || !uuid.test(job.nonce) || (!uuid.test(job.room) || !(session.kinds.length ? session.kinds.includes(job.kind) : session.roomIds.has(job.room))) || job.expires > session.expires ||
          job.expires - result.now > 60000 || used.has(job.source) || (!renew && used.size >= 5)) throw unavailable();
      const deadline = Math.min(session.deadline, started + job.expires - result.now);
      const ref = { source: job.source, nonce: job.nonce };
      if (!sameProvider(grant.provider, await provider(key, renew))) throw unavailable();
      live(deadline);
      used.set(job.source, monotonic());
      const input = await post("dispatch", ref);
      if (typeof input.question !== "string" || !input.question.trim() || input.question.length > 1000 ||
          createHash("sha256").update(input.question).digest("hex") !== input.inputHash) throw unavailable();
      if (!sameProvider(grant.provider, await provider(key, renew)) || (await post("check", ref)).active !== true) throw unavailable();
      live(deadline);
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(Math.max(1, Math.ceil(deadline - monotonic())))]);
      const { answer } = await generate({ id: grant.twin, revision: grant.revision, key: grant.provider.key,
        question: input.question, job: job.nonce, useProvider: true }, signal);
      if (typeof answer !== "string" || !answer.trim() || answer.length > 750 ||
          !sameProvider(grant.provider, await provider(key, renew)) || (await post("check", ref)).active !== true) throw unavailable();
      live(deadline);
      const signature = sign(null, Buffer.from(generatedPostMessage({ ...grant, ...job, inputHash: input.inputHash, answer })), key.key).toString("hex");
      const receipt = await post("finish", { ...ref, answer, signature });
      if (receipt.published !== true || receipt.source !== job.source) throw unavailable();
    } catch (error) {
      if (renew && active === session && error?.code === "INBOX_NETWORK_UNAVAILABLE") return;
      if (active === session) reset();
      await recover().catch(() => {});
    } finally { busy = false; }
  }
  return { reset, recover, choices, offer, tick, whileOpen: () => active?.grant.dailyLimit !== undefined, async status() {
    return generatedStatus(inbox, await recover(), active?.grant.id);
  } };
}
