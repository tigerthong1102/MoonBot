import { createHash, randomUUID, sign } from "node:crypto";
import { generatedGrantMessage, generatedPostMessage } from "./twin-generated-message.mjs";

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
  const { owner, grant } = await inbox("twin-generated");
  if (me.id !== owner) throw unavailable();
  return { available: true, owner, local: Boolean(grant && grant.id === localId),
    remote: grant ? { id: grant.id, enabled: grant.enabled, expires: grant.expires, count: grant.count } : null };
}

export function createOnlineGenerated({ state, check, profile, generate, inbox, approve, journal, origin, monotonic = () => performance.now() }) {
  let active, busy = false, epoch = 0;
  function reset() {
    epoch++;
    active?.abort.abort();
    active = undefined;
  }
  const recover = () => recoverGenerated({ journal, inbox, origin, keep: () => active?.grant.id });
  async function provider(key) {
    await check(key);
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
  async function offer(expected, refs) {
    if (!approve || !journal || busy || active || !Array.isArray(refs) || !refs.length || refs.length > 100 ||
        new Set(refs).size !== refs.length || refs.includes("*")) throw unavailable();
    const key = state(), version = epoch;
    busy = true;
    try {
      await recover();
      const selected = await choices();
      if (state() !== key || version !== epoch || !sameProvider(expected, selected.provider)) throw unavailable();
      const rooms = [...refs].sort();
      const chosen = rooms.map(ref => selected.rooms.find(room => room.ref === ref && room.title && room.id));
      if (chosen.some(room => !room)) throw unavailable();
      const grant = { id: randomUUID(), owner: key.owner, pairing: key.id, origin, twin: key.twin, revision: key.revision,
        provider: { ...selected.provider }, rooms, expires: key.expires };
      if (!await approve({ grant, chosen })) return false;
      if (!sameProvider(grant.provider, await provider(key)) || epoch !== version) throw unavailable();
      const signature = sign(null, Buffer.from(generatedGrantMessage(grant)), key.key).toString("hex");
      journal.add(grant);
      const session = { grant, key, roomIds: new Set(chosen.map(room => room.id)), used: new Set(), abort: new AbortController() };
      active = session;
      try {
        const result = await inbox("twin-generated", { action: "offer", id: grant.id, owner: grant.owner,
          pairing: grant.pairing, provider: grant.provider, rooms, expires: grant.expires, signature });
        if (result.id !== grant.id || result.offered !== true || active !== session || state() !== key) throw unavailable();
      } catch (error) {
        reset();
        await recover().catch(() => {});
        throw error;
      }
      return true;
    } finally { busy = false; }
  }
  async function tick() {
    if (!active || busy) return;
    const session = active, { grant, key, abort, used } = session;
    busy = true;
    const post = (action, extra = {}) => inbox("twin-generated", { action, id: grant.id, owner: grant.owner, ...extra });
    function live(deadline) {
      if (active !== session || state() !== key || monotonic() >= deadline || abort.signal.aborted) throw unavailable();
    }
    try {
      await check(key);
      live(key.deadline);
      const started = monotonic(), result = await post("claim"), job = result.challenge;
      if (!job) return;
      if (!Number.isSafeInteger(result.now) || !Number.isSafeInteger(job.expires) || !Number.isSafeInteger(job.source) ||
          job.source <= 0 || !uuid.test(job.nonce) || !session.roomIds.has(job.room) || job.expires > grant.expires ||
          job.expires - result.now > 60000 || used.has(job.source) || used.size >= 5) throw unavailable();
      const deadline = Math.min(key.deadline, started + job.expires - result.now);
      const ref = { source: job.source, nonce: job.nonce };
      if (!sameProvider(grant.provider, await provider(key))) throw unavailable();
      live(deadline);
      used.add(job.source);
      const input = await post("dispatch", ref);
      if (typeof input.question !== "string" || !input.question.trim() || input.question.length > 1000 ||
          createHash("sha256").update(input.question).digest("hex") !== input.inputHash) throw unavailable();
      if (!sameProvider(grant.provider, await provider(key)) || (await post("check", ref)).active !== true) throw unavailable();
      live(deadline);
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(Math.max(1, Math.ceil(deadline - monotonic())))]);
      const { answer } = await generate({ id: grant.twin, revision: grant.revision, key: grant.provider.key,
        question: input.question, job: job.nonce, useProvider: true }, signal);
      if (typeof answer !== "string" || !answer.trim() || answer.length > 750 ||
          !sameProvider(grant.provider, await provider(key)) || (await post("check", ref)).active !== true) throw unavailable();
      live(deadline);
      const signature = sign(null, Buffer.from(generatedPostMessage({ ...grant, ...job, inputHash: input.inputHash, answer })), key.key).toString("hex");
      const receipt = await post("finish", { ...ref, answer, signature });
      if (receipt.published !== true || receipt.source !== job.source) throw unavailable();
    } catch {
      if (active === session) reset();
      await recover().catch(() => {});
    } finally { busy = false; }
  }
  return { reset, recover, choices, offer, tick, async status() {
    return generatedStatus(inbox, await recover(), active?.grant.id);
  } };
}
