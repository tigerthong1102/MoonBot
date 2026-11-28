import { randomUUID, sign } from "node:crypto";
import { exactGrantMessage, exactPostMessage } from "./twin-exact-message.mjs";

const unavailable = () => Error("exact_reply_unavailable");
export async function readExactStatus(inbox, me, localId) {
  if (!me.exactAnswer) return { available: false };
  const { owner, grant } = await inbox("twin-exact");
  if (me.id !== owner) throw unavailable();
  const remote = grant ? { id: grant.id, enabled: grant.enabled, expires: grant.expires } : null;
  return { available: true, owner, local: Boolean(remote && localId === remote.id), remote };
}
export async function recoverExact({ journal, origin, inbox, keep }) {
  if (!journal) throw unavailable();
  const me = await inbox("me");
  for (const ref of journal.list(me.id, origin)) {
    if (ref.id === keep?.()) continue;
    const receipt = await inbox("twin-exact", { action: "revoke", owner: ref.owner, id: ref.id });
    if (receipt.id !== ref.id || receipt.revoked !== true) throw unavailable();
    journal.remove(ref);
  }
  return me;
}
export function createOnlineExact({
  state,
  check,
  profile,
  inbox,
  origin,
  journal,
  approve,
  monotonic = () => performance.now(),
}) {
  let active,
    working = false,
    epoch = 0;
  function stopLocal() {
    epoch++;
    active = undefined;
  }
  const recover = () => recoverExact({ journal, origin, inbox, keep: () => active?.id });
  async function selections() {
    const key = state();
    if (!key?.key) throw unavailable();
    await check(key);
    const [view, account] = await Promise.all([profile(), inbox("twin-exact?rooms=1")]);
    if (
      view.twin?.id !== key.twin ||
      view.twin.revision !== key.revision ||
      view.twin.paused ||
      account.owner !== key.owner
    )
      throw unavailable();
    return { key, lessons: (view.lessons ?? []).filter((l) => l.origin === "manual"), rooms: account.rooms };
  }
  async function checkLesson(grant) {
    const view = await profile(),
      lesson = view.lessons?.find((l) => l.id === grant.lesson && l.origin === "manual");
    if (
      view.twin?.id !== grant.twin ||
      view.twin.revision !== grant.revision ||
      view.twin.paused ||
      lesson?.question !== grant.question ||
      lesson.answer !== grant.answer
    )
      throw unavailable();
  }
  async function offer(lessonId, selected) {
    if (
      !journal ||
      !approve ||
      active ||
      working ||
      !Array.isArray(selected) ||
      !selected.length ||
      selected.length > 100
    )
      throw unavailable();
    working = true;
    const started = epoch;
    try {
      await recover();
      const { key, lessons, rooms } = await selections();
      const lesson = lessons.find((l) => l.id === lessonId),
        refs = [...new Set(selected)].sort();
      const all = refs.length === 1 && refs[0] === "*";
      const chosen = all ? [] : refs.map((ref) => rooms.find((r) => r.ref === ref && r.title));
      if (!lesson || chosen.some((r) => !r) || refs.length !== selected.length) throw unavailable();
      const grant = {
        id: randomUUID(),
        pairing: key.id,
        owner: key.owner,
        twin: key.twin,
        revision: key.revision,
        origin,
        lesson: lesson.id,
        question: lesson.question,
        answer: lesson.answer,
        rooms: refs,
        expires: key.expires,
      };
      if (epoch !== started || state() !== key) throw unavailable();
      if (!(await approve({ grant, all, chosen }))) return false;
      await check(key);
      await checkLesson(grant);
      if (active || epoch !== started || state() !== key) throw unavailable();
      journal.add(grant);
      active = grant;
      const proof = sign(null, Buffer.from(exactGrantMessage(grant)), key.key).toString("hex");
      try {
        const result = await inbox("twin-exact", {
          action: "offer",
          owner: grant.owner,
          id: grant.id,
          pairing: grant.pairing,
          lesson: grant.lesson,
          question: grant.question,
          answer: grant.answer,
          rooms: grant.rooms,
          expires: grant.expires,
          signature: proof,
        });
        if (result.id !== grant.id || result.offered !== true || active !== grant || state() !== key)
          throw unavailable();
      } catch (error) {
        stopLocal();
        await recover().catch(() => {});
        throw error;
      }
      return true;
    } finally {
      working = false;
    }
  }
  async function tick() {
    if (working || !active) return;
    working = true;
    const grant = active,
      key = state();
    try {
      if (!key || key.id !== grant.pairing) throw unavailable();
      await check(key);
      const started = monotonic();
      const result = await inbox("twin-exact", { action: "claim", owner: grant.owner, id: grant.id });
      if (!result.challenge) return;
      const job = result.challenge;
      const deadline = started + Math.min(4000, job.expires - result.now);
      if (
        !Number.isSafeInteger(job.source) ||
        job.source < 1 ||
        typeof job.room !== "string" ||
        typeof job.nonce !== "string" ||
        !Number.isSafeInteger(job.expires) ||
        !Number.isSafeInteger(result.now) ||
        deadline <= monotonic()
      )
        throw unavailable();
      await check(key);
      await checkLesson(grant);
      if (active !== grant || state() !== key || !Number.isSafeInteger(result.now) || deadline <= monotonic())
        throw unavailable();
      const signature = sign(null, Buffer.from(exactPostMessage({ ...grant, ...job })), key.key).toString("hex");
      const finish = await inbox("twin-exact", {
        action: "finish",
        owner: grant.owner,
        id: grant.id,
        source: job.source,
        nonce: job.nonce,
        signature,
      });
      if (finish.published !== true || finish.source !== job.source) throw unavailable();
    } catch {
      stopLocal();
      await recover().catch(() => {});
    } finally {
      working = false;
    }
  }
  return {
    reset: stopLocal,
    recover,
    tick,
    offer,
    async stop() {
      stopLocal();
      await recover();
    },
    async choices() {
      const { rooms, lessons } = await selections();
      return { rooms, lessons: lessons.map(({ id, question }) => ({ id, question })) };
    },
    async status() {
      const me = await recover();
      return readExactStatus(inbox, me, active?.id);
    },
  };
}
