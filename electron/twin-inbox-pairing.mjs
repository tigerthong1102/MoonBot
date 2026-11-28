import { createOnlineGenerated } from "./twin-online-generated.mjs";
import { createOnlineExact } from "./twin-online-exact.mjs";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { twinPairingMessage } from "./twin-pairing-message.mjs";

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const unavailable = () => Error("pairing_unavailable");

export function createTwinInboxPairing({
  current,
  profile,
  exactProfile,
  generatedProfile,
  generate,
  generatedJournal,
  approveGenerated,
  inbox,
  origin,
  approve,
  exactJournal,
  approveExact,
  now = Date.now,
  monotonic = () => performance.now(),
}) {
  let pending;
  const reset = () => {
    pending = undefined;
    exact.reset();
    generated.reset();
  };
  async function liveTwin() {
    if (!current()) throw unavailable();
    const twin = (await profile())?.twin;
    if (
      !current() ||
      !twin ||
      twin.paused ||
      !uuid.test(twin.id) ||
      !Number.isSafeInteger(twin.revision) ||
      twin.revision < 1
    )
      throw unavailable();
    return twin;
  }
  async function checkIdentity(state, renewable = false) {
    const me = await inbox("me");
    const twin = await liveTwin();
    if (
      !current() ||
      pending !== state ||
      (renewable && me.generatedAnswer !== true) ||
      twin.id !== state.twin ||
      twin.revision !== state.revision ||
      me.id !== state.owner
    )
      throw unavailable();
  }
  async function check(state) {
    await checkIdentity(state);
    if (state.deadline <= monotonic()) throw unavailable();
  }
  const exact = createOnlineExact({
    state: () => pending,
    check,
    profile: exactProfile,
    inbox,
    origin,
    journal: exactJournal,
    approve: approveExact,
    monotonic,
  });
  const generated = createOnlineGenerated({ state: () => pending, check, checkOnline: state => checkIdentity(state, true), profile: generatedProfile, generate, inbox,
    approve: approveGenerated, journal: generatedJournal, origin, monotonic });
  return {
    exact, generated,
    reset,
    async start() {
      const state = {};
      pending = state;
      const twin = await liveTwin(),
        me = await inbox("me");
      if (!current() || pending !== state || typeof me.id !== "string" || !me.id) throw unavailable();
      const keys = generateKeyPairSync("ed25519");
      const raw = Buffer.from(keys.publicKey.export({ format: "jwk" }).x, "base64url");
      const publicKey = raw.toString("hex");
      const fingerprint = createHash("sha256").update(raw).digest("hex");
      const started = monotonic();
      const receipt = await inbox("twin-pairing", {
        action: "start",
        owner: me.id,
        publicKey,
        twin: twin.id,
        revision: twin.revision,
      });
      if (
        !uuid.test(receipt.id) ||
        receipt.owner !== me.id ||
        receipt.fingerprint !== fingerprint ||
        !Number.isSafeInteger(receipt.expires)
      )
        throw unavailable();
      Object.assign(state, {
        origin,
        owner: me.id,
        id: receipt.id,
        publicKey,
        twin: twin.id,
        revision: twin.revision,
        expires: receipt.expires,
        deadline:
          started + Math.min(600000, receipt.expires - (Number.isSafeInteger(receipt.now) ? receipt.now : now())),
        fingerprint,
        key: keys.privateKey,
      });
      await check(state);
      return {
        id: state.id,
        fingerprint,
        origin,
        expires: state.expires,
        exactAvailable: me.exactAnswer === true,
        ...(me.generatedAnswer === true && { generatedAvailable: true }),
      };
    },
    async confirm() {
      const state = pending;
      if (!state?.key || state.confirming) throw unavailable();
      state.confirming = true;
      try {
        await check(state);
        const ready = await inbox("twin-pairing", { action: "ready", owner: state.owner, id: state.id });
        if (ready.id !== state.id || !ready.ready) throw unavailable();
        await check(state);
        if (!(await approve({ origin, fingerprint: state.fingerprint, owner: state.owner, twin: state.twin })))
          return false;
        await check(state);
        const signature = sign(null, Buffer.from(twinPairingMessage(state)), state.key).toString("hex");
        const result = await inbox("twin-pairing", {
          action: "sign",
          owner: state.owner,
          id: state.id,
          signature,
        });
        return result.id === state.id && result.signed === true;
      } finally {
        state.confirming = false;
      }
    },
  };
}
